# How rep detection works

The app listens to the microphone and counts each exhale as a rep. Audio is
split into frames about 20 ms apart. Each frame gives three numbers, measured
over 100 Hz to 4 kHz, since a Bluetooth headset sends nothing higher:

- **level** (`db`): how loud the frame is
- **flatness**: how noise-like the sound is, rather than a clear tone; breath
  is noisy, a grunt or hum is tonal
- **high ratio** (`highRatio`): the share of the sound's energy above 1 kHz;
  breath is hissy, a thud is low

## Calibration

Calibration takes a few seconds of quiet, then three exhales, per microphone:

- **Background level**: the median level of the quiet audio.
- **Gate offsets**: the gate opens at background + 50% and closes at
  background + 30% of the gap between the background and the softest of the
  three breaths' loudest points. Breaths must peak at least 15 dB above the
  background.
- **Minimum flatness and high ratio**: 70% of the lowest average across the
  three breaths.

Each set starts with a short quiet check and re-measures its own background
from the quietest 10% of those frames, since the median is pushed up by heavy
breathing between sets. The new background is kept within 10 dB of the
calibrated one, and the gate moves with it.

## Finding a sound

A hysteresis gate: a sound starts when the level reaches the **on** level and
ends when it drops below the **off** level. Each sound is then checked in the
order below, and the first failure rejects it with the reason shown on the
page and in the logs.

## Checks on each sound

| Check | Rule | Rejects |
|---|---|---|
| Too long | lasts no more than 3 s (checked while the sound goes on) | sustained noise |
| Too short | lasts at least 150 ms | clicks, clanks |
| Spike | stays within 10 dB of its own peak for at least 200 ms, unless it lasts 1 s or more and is smooth (level changes by under 2.2 dB per frame on average) | claps and weight dinks that spike and fade |
| Too quiet | peaks at -30 dB or louder, unless it lasts 1 s or more | soft shuffles and inhales the gate lets in when the room is quiet |
| Tonal | average flatness at least the calibrated minimum, or 0.02 if that is lower | grunts, hums |
| Low-frequency | average high ratio at least the calibrated minimum | thuds |
| Too soon | starts at least 600 ms after the last rep ended | the tail of the same breath |

The flatness cap is there because reps get less hissy as a set goes on. A
calibration from three fresh breaths can set a minimum that late reps fall
below, while grunts and hums sit at 0.01 or less.

The -30 dB cutoff is an absolute level, chosen for the Powerbeats Pro, so
another microphone may need a different value.

## Checking changes against real sets

Every set is logged with its frames and audio under `data/logs/` (the
single-set page) or `data-routine/logs/` (the routine page). `npm run report`
summarises the single-set logs, and `npm run report -- data-routine` the
routine ones.

Sets saved with **Save set data** become fixtures, in `test/fixtures/` or
`data-routine/fixtures/`. `npm test` replays each one through the current
detector and checks it finds the count entered after the set. Sets whose
count was a guess are left out, and sets the detector still gets wrong are
listed in `test/fixtures.test.ts` as expected failures, so fixing one fails
the test until it is taken off the list. Entering the actual count after each
set is what makes these tests useful.
