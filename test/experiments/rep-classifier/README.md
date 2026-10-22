# Experiment: classify sounds from the saved audio

Tests whether a classifier on the recorded audio can tell reps from setup
noises and other sounds better than the detector's hand-tuned checks. Run
on 2026-10-22, offline, against the `.webm` recordings in the set logs. See
`docs/ideas/compare-sounds-to-reps.md` for the problem it targets.

## Result (2026-10-22)

1,092 gate-opened sounds: 119 reps from sets whose count matched the one
entered, the 6 known setup noises, 3 likely missed reps (guessed partly
from rhythm) and about 500 rejected sounds. Each classifier was trained on
reps against rejected sounds and scored on sets it hadn't seen.

| Features | Setup noises | Missed reps | Real reps lost |
|---|---|---|---|
| YAMNet "Breathing" score alone | all 0.03 or lower | 0.00 to 0.06 | 32% at a cutoff that rejects all six setups |
| YAMNet's 521 scores + logistic regression | 5 of 6 low, 1 at 0.95 | 2 of 3 | 24% |
| MFCC + logistic regression | all 0.18 or lower | 0.90 to 0.98 | none of 119 below the highest setup noise |

The MFCC result held across C = 0.01, 0.1 and 1, and when a whole day
(17, 21 or 22 October, both earbud mics) was held out. YAMNet labels the
exhales as Breathing, Hiss, Tools, Snort or Speech, so it doesn't suit
them. Caveats: only 6 setup noises and 3 guessed missed reps, and the
audio is compressed, not the live mic signal.

## Files

- `dump.ts`: lists every gate-opened sound of 150 ms or more in the logs,
  with the current detector's verdict.
- `align.py`: checks a log's frame times against its audio. Offsets were
  within 0.06 s.
- `yam.py`: labels each sound (`SETUP` and `MISSED` hold the known ones, by
  set id and end time) and scores it with YAMNet. Writes `yam.json`, which
  `clf.py` reads.
- `clf.py`: trains and scores the classifiers, holding out one set, then
  one day, at a time.

## Running it

Work in a scratch directory outside the repo, `$S` below, run from the
repo root:

```sh
S=/path/to/scratch
mkdir -p $S/wav $S/yamnet

# The sounds, with the detector's verdicts
npx tsx test/experiments/rep-classifier/dump.ts $S/sounds.json data/logs/sets/*.json data-routine/logs/sets/*.json

# The audio as 16 kHz mono WAV
for f in data/logs/sets/*.webm data-routine/logs/sets/*.webm; do
  ffmpeg -v error -i $f -ac 1 -ar 16000 $S/wav/$(basename $f .webm).wav
done

# YAMNet and its class names
curl -sSL -o $S/yamnet/yamnet.tflite 'https://tfhub.dev/google/lite-model/yamnet/classification/tflite/1?lite-format=tflite'
curl -sSL -o $S/yamnet/yamnet_class_map.csv https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv

# Python 3.12 with ai-edge-litert, librosa, numpy and scikit-learn
uv venv $S/venv
uv pip install --python $S/venv/bin/python ai-edge-litert librosa numpy scikit-learn

$S/venv/bin/python test/experiments/rep-classifier/yam.py $S $S/yamnet/yamnet.tflite $S/yamnet/yamnet_class_map.csv
$S/venv/bin/python test/experiments/rep-classifier/clf.py $S $S/yamnet/yamnet.tflite
```

`align.py` takes a log and its WAV:
`$S/venv/bin/python test/experiments/rep-classifier/align.py data/logs/sets/<id>.json $S/wav/<id>.wav`.

Versions used: Python 3.12, ai-edge-litert 2.3.0, librosa 1.0.0, numpy
2.5.4, scikit-learn 1.9.1.
