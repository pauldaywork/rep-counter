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
- No audio plays during a set. The only sound is a chime when the set
  completes.

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
  2. duration > `maxDurationMs` (1500) → rejected "too long"
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

1. **Quiet** — 3 s of silence. `noiseFloorDb` = median frame dB.
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
     retry. Every segment opens at `noiseFloorDb + 10 dB`, so
     `span ≥ 10 dB` holds by construction and needs no separate check.
   - `onDb = noiseFloorDb + 0.5 × span`
   - `offDb = noiseFloorDb + 0.3 × span`
   - `minFlatness = 0.7 × min(exhale mean flatness)`
   - `minHighRatio = 0.7 × min(exhale mean highRatio)`

Stored thresholds are relative to the noise floor (`onOffsetDb`,
`offOffsetDb`) so they can be re-based.

**Per-set re-base:** each set starts with a 2 s quiet check. The new
noise floor is used for that set only (it is not saved), and
`onDb`/`offDb` are recomputed from the stored offsets.

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
- `PUT /api/calibration` → validates the JSON body and writes it to a
  temporary file, then renames it over `data/calibration.json` so a
  failed write cannot corrupt it.
- `POST /api/fixtures` → writes a set recording to
  `test/fixtures/<timestamp>.json`.

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
  - When the list refreshes, the previous selection is kept by label if
    that mic is still present. Otherwise `lastMic` is used.
  - If the active mic disappears during a set, or its track ends, the
    set stops and an error names the lost mic.
- **Set controls:** target reps input, **Start set**, large `n / target`
  counter, **+1 / −1** correction buttons and **Stop** during a set.
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
| `src/chime.ts` | Completion sound |
| `vite-plugin-store.ts` | File-backed API |

## Testing

- **`features.ts`:** a pure sine has flatness below 0.01; white noise
  has flatness above 0.4 (a single-frame periodogram of white noise
  scores about 0.56, not 1); a 200 Hz hum has highRatio below 0.01.
- **`detector.ts`** (synthetic frame sequences):
  - a clean exhale counts
  - a clank (80 ms) is rejected as too short
  - a grunt (low flatness) is rejected as tonal
  - a quiet inhale never opens the gate
  - two exhales 400 ms apart count once
  - an exhale that wobbles around `onDb` counts once
  - a 2 s sustained noise is rejected as too long
- **`calibration.ts`:**
  - correct thresholds from a known recording
  - retry when fewer than 3 exhales are found (including breaths too
    quiet to reach `noiseFloorDb + 10 dB`)
  - re-basing moves `onDb`/`offDb` by the noise-floor delta
- **Fixture regression:** each saved `test/fixtures/*.json` is replayed
  through the detector, and the test asserts that the detected count
  equals the recorded actual count.
- **Store plugin:** a read/write round trip against a temp directory.

## Out of scope

- An ML classifier (Teachable Machine / TF.js). It can be added later
  as a second stage on top of the gate if the rules prove inaccurate.
- Phone support, workout history, audio during reps, and deployment
  anywhere other than the local dev server.
