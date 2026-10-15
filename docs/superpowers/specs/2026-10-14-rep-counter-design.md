# Rep Counter — Design

Date: 2026-10-14

## Purpose

A local website that counts exercise reps by listening for one loud
exhale per rep through a Bluetooth headset microphone. The user enters a
target rep count, clicks **Start set**, and the count rises by one for
each exhale. When the target is reached, the site plays a chime and
stops listening.

## Environment and constraints

- Runs on a Linux laptop in Chrome, served by the Vite dev server at
  `http://localhost:5173` (a secure context, so `getUserMedia` works
  without HTTPS). The port is fixed with `strictPort: true`.
- Chrome only. No fallbacks, polyfills or testing for other browsers,
  and Chrome behaviour may be relied on.
- Input is a Bluetooth headset microphone in HFP mode: mono, 8 kHz
  (narrowband) or 16 kHz (mSBC wideband). Detection may only rely on
  content below 4 kHz.
- Present during a set: the user's exhales and inhales, grunts, and
  weights clanking. Not present: music, talking.
- By default no audio plays during a set; the only sound is a chime when
  the set completes. An optional **Ding on each rep** checkbox (off by
  default, not saved) plays a short 1320 Hz tone for each detected rep
  except the last, which gets the chime. The ding plays in the
  headphones, so the mic barely hears it; any leak is tonal and inside
  the 600 ms gap, so the detector rejects it.

## Stack

- TypeScript, Vite, no UI framework.
- Vitest for tests.
- `fft.js` for the FFT inside the AudioWorklet.

## Audio pipeline

1. `getUserMedia({ audio: { deviceId, echoCancellation: false,
   noiseSuppression: false, autoGainControl: false } })`. These browser
   effects attenuate breath noise or move the levels the thresholds
   depend on.
2. The stream feeds an `AudioWorkletNode` (`features-worklet.ts`). The
   worklet runs on the audio thread, so background-tab timer throttling
   cannot drop frames.
3. The worklet buffers samples into non-overlapping frames of about
   21 ms (1024 samples at 48 kHz; the nearest power of two at other
   sample rates), applies a Hann window, runs an FFT, and posts one
   `Frame` per frame:

   ```ts
   interface Frame {
     t: number;          // ms since this mic session started (sample count)
     db: number;         // RMS level in dBFS
     flatness: number;   // spectral flatness 0..1 (1 = white noise)
     highRatio: number;  // energy above 1 kHz / total energy, 0..1
   }
   ```

   Flatness and highRatio are computed over 100 Hz – 4 kHz, the band a
   narrowband headset can deliver.

## Detector (`detector.ts`)

Pure TypeScript, no browser APIs. Consumes `Frame`s, emits events:

```ts
type DetectorEvent =
  | { kind: "rep"; t: number; durationMs: number }
  | { kind: "rejected"; t: number; reason: string };
```

Hysteresis state machine:

- **Idle → Active** when `db >= onDb`.
- While **Active**, accumulate duration, mean flatness, mean highRatio
  and peak dB.
- **Active → Idle** when `db < offDb`. Then classify the event in this
  order:
  1. duration < `minDurationMs` (150) → rejected "too short"
  1a. time within 10 dB of the event's own peak < `minHeldMs` (200) →
     rejected "spike". A clap or a weight's dink spikes and fades, and
     its echo can keep it above `offDb` past 150 ms; an exhale holds
     near its peak.
  2. duration > `maxDurationMs` (2000) → rejected "too long"
  3. mean flatness < `minFlatness` → rejected "tonal"
  4. mean highRatio < `minHighRatio` → rejected "low-frequency"
  5. less than `minGapMs` (600) since the last rep → rejected "too soon"
  6. otherwise → rep
- An Active event exceeding `maxDurationMs` is rejected as soon as it
  passes the limit. The detector then waits for `db < offDb` before it
  can open again.

The rep is emitted when the exhale ends, roughly 0.3–1 s after it
starts.

## Calibration (`calibration.ts`)

Pure functions that turn calibration recordings into thresholds.

Flow, run once per microphone:

1. **Quiet** — 3 s of silence, captured after a 400 ms warm-up
   (`WARMUP_MS`), so 3.4 s of audio is recorded. `noiseFloorDb` =
   median frame dB, ignoring the warm-up frames and any frame below
   −150 dB (`DIGITAL_SILENCE_DB`): Bluetooth headsets often send digital
   zeros just after the mic opens. If nothing else remains, calibration
   fails with "The microphone sent only silence" and a hint to check
   HFP mode.
2. **Exhales** — the user breathes out hard 3 times when prompted.
   Exhales are segmented with a provisional gate that opens at
   `noiseFloorDb + 10 dB` and closes below `noiseFloorDb + 6 dB`.
   Segments shorter than 150 ms are dropped, and if more than 3
   remain, the 3 loudest are kept. For each, record its peak dB, mean
   flatness and mean highRatio. The phase ends 600 ms after the third
   exhale ends, or after 10 s.
3. **Derive:**
   - `span = min(exhale peak dB) − noiseFloorDb`
   - if fewer than 3 exhales were found → fail and ask the user to
     retry.
   - if `span < 15 dB` (`MIN_SPAN_DB`) → fail and ask the user to
     breathe out harder or closer to the mic. A smaller span leaves
     `offDb` only about 3 dB above the floor, where ordinary noise
     keeps the gate open.
   - `onDb = noiseFloorDb + 0.5 × span`
   - `offDb = noiseFloorDb + 0.3 × span`
   - `minFlatness = 0.7 × min(exhale mean flatness)`
   - `minHighRatio = 0.7 × min(exhale mean highRatio)`

Stored thresholds are relative to the noise floor (`onOffsetDb`,
`offOffsetDb`) so they can be re-based.

**Per-set re-base:** each set starts with a 2 s quiet check (2.4 s of
audio, after the same 400 ms warm-up). The new noise floor is clamped
to within ±10 dB (`MAX_REBASE_DB`) of the calibrated one, so starting
while still panting cannot lift the thresholds far. It is used for that
set only (it is not saved), and `onDb`/`offDb` are recomputed from the
stored offsets.

Inhales are rejected mainly because they are quieter than `onDb`. The
600 ms gap rejects any that get through. Inhaling through the nose
helps.

## Persistence

Calibrations are stored on disk in the project at
`data/calibration.json`, never in browser storage, so clearing the
browser cache cannot lose them. The file is committed to git as a
backup.

A Vite plugin (`vite-plugin-store.ts`, using the `configureServer`
hook) adds:

- `GET /api/calibration` → the file contents, or `{"mics":{}}` if it
  does not exist.
- `PUT /api/calibration` → requires a JSON content type, validates the body and writes it to a
  temporary file, then renames it over `data/calibration.json` so a
  failed write cannot corrupt it.
- `POST /api/fixtures` → writes a set recording to
  `test/fixtures/<timestamp>.json`.

- `PUT /api/logs/sets/<id>` and `PUT /api/logs/calibrations/<id>` →
  write a log to `data/logs/<kind>/<id>.json`. The id is the start time
  (e.g. `2026-10-15T05-00-00-000Z`), may only hold letters, digits and
  dashes, and must match the body's `id`.

**Logs.** Every set and every calibration attempt is logged
automatically, so detection can be reviewed later:

- A **set log** is written when the set ends: completed, stopped, or
  ended by an error such as a lost mic. It holds the target, outcome,
  ding setting, the calibration used, this set's measured background
  level and thresholds, the timing rules, every detector event (reps and
  rejections with reasons), each +1/−1 press with its time, the detected
  and final counts, and all frames. **Save set data** rewrites it with
  the actual count, and still writes the test fixture.
- A **calibration log** is written for each attempt, successful or not:
  the quiet and exhale frames, the sounds found, the background level,
  and the result or the failure reason.
- A failed log save shows an error but never ends a set or calibration.
- `npm run report` prints a summary of all logs: each calibration's
  result, each set's counts and rejection reasons, and the total missed
  and extra reps across sets with an actual count.

The file holds one calibration per microphone, keyed by device
**label** (e.g. `"WH-1000XM4 (Bluetooth)"`). Chrome's `deviceId` is
not used as the key because Chrome resets it when site data is
cleared. The last-selected mic label is stored too.

```json
{
  "lastMic": "WH-1000XM4 (Bluetooth)",
  "mics": {
    "WH-1000XM4 (Bluetooth)": {
      "calibratedAt": "2026-10-14T05:00:00Z",
      "noiseFloorDb": -62.1,
      "onOffsetDb": 14.3,
      "offOffsetDb": 8.6,
      "minFlatness": 0.31,
      "minHighRatio": 0.22
    }
  }
}
```

If the API is unreachable or a save fails, the UI shows an error. It
does not continue as if the save succeeded.

## UI

One page:

- **Header:** mic dropdown (labels from `enumerateDevices` after mic
  permission), **Recalibrate** button, and a "Calibrated ✓ /
  Not calibrated" status for the selected mic.
  - The dropdown refreshes on the `navigator.mediaDevices`
    `devicechange` event, so a headset that connects or switches to
    headset (HFP) mode appears without a page reload.
  - When the list refreshes, the last mic the user chose (`lastMic`) is
    selected whenever it is present; otherwise the current selection is
    kept, else the first mic.
  - If the active mic disappears during a set, or its track ends, the
    set stops and an error names the lost mic.
- **Set controls:** target reps input, **Start set**, large `n / target`
  counter, **+1 / −1** correction buttons and **Stop** during a set,
  and the **Ding on each rep** checkbox.
  Starting a set on an uncalibrated mic runs calibration first.
- **Completion:** when the count reaches the target, stop listening,
  release the mic, play a short chime (synthesised oscillator tones, no
  audio file), and show "Set complete".
- **Tuning panel** (collapsible):
  - a scrolling 10 s dB trace with `onDb`/`offDb` lines
  - green markers for reps and red markers for rejections
  - a list of recent rejections with their reasons
  - a **Save set data** button that POSTs the set's frames,
    thresholds, the detected count and a user-entered actual count to
    `/api/fixtures`

## Files

| File | Responsibility |
|---|---|
| `src/features-worklet.ts` | Framing, FFT and features in the AudioWorklet |
| `src/features.ts` | Pure feature maths (dB, flatness, highRatio), shared with tests |
| `src/audio.ts` | Mic capture, worklet wiring, emitting `Frame`s |
| `src/detector.ts` | Hysteresis state machine |
| `src/calibration.ts` | Calibration maths and noise-floor re-base |
| `src/store.ts` | Client for the `/api` endpoints |
| `src/ui.ts` | Page state and DOM |
| `src/meter.ts` | Canvas dB trace |
| `src/chime.ts` | Completion chime and per-rep ding |
| `vite-plugin-store.ts` | File-backed API |

## Testing

- **`features.ts`:** a pure sine has flatness below 0.01; white noise
  has flatness above 0.4 (a single-frame periodogram of white noise
  scores about 0.56, not 1); a 200 Hz hum has highRatio below 0.01.
- **`detector.ts`** (synthetic frame sequences):
  - a clean exhale counts
  - a clank (80 ms) is rejected as too short
  - a clap whose fading echo lasts 280 ms is rejected as a spike
  - an exhale with a loud first burst that then holds lower counts
  - a grunt (low flatness) is rejected as tonal
  - a quiet inhale never opens the gate
  - two exhales 400 ms apart count once
  - an exhale that wobbles around `onDb` counts once
  - a 2 s sustained noise is rejected as too long
- **`calibration.ts`:**
  - correct thresholds from a known recording
  - retry when fewer than 3 exhales are found (including breaths too
    quiet to reach `noiseFloorDb + 10 dB`)
  - retry when the breaths are under 15 dB above the noise floor
  - the noise floor ignores the warm-up and digital silence, and fails
    when only silence remains
  - the per-set floor is clamped to ±10 dB of the calibrated one
  - re-basing moves `onDb`/`offDb` by the noise-floor delta
- **Fixture regression:** each saved `test/fixtures/*.json` is replayed
  through the detector, and the test asserts that the detected count
  equals the recorded actual count.
- **Store plugin:** a read/write round trip against a temp directory, and
  a 400 for a body not sent as JSON.

## Out of scope

- An ML classifier (Teachable Machine / TF.js). It can be added later
  as a second stage on top of the gate if the rules prove inaccurate.
- Phone support, workout history, and deployment
  anywhere other than the local dev server.
