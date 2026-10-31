# Design: labelling every sound for a clean classifier dataset

Status: approved on 2026-10-31. The decisions are at the end.

## The problem

In two sets on 2026-10-31 (`2026-10-31T04-55-25-957Z` and
`2026-10-31T04-57-20-334Z`) the detector counted an inhale as a rep, then
rejected the real exhale straight after it:

| Set | Inhale counted as a rep | Real exhale rejected |
|---|---|---|
| `04-55-25` | 43.7 s (747 ms) | 45.0 s, "too soon (533 ms after the last rep)" |
| `04-57-20` | 50.9 s (768 ms) | 52.3 s, "too soon (491 ms after the last rep)" |

One wrong count and one miss cancel out, so the total is right and the
count-only fixture test can't see it. The only record of which sounds
were wrong today is the `SETUP` and `MISSED` lists typed into
`test/experiments/rep-template.test.ts` and
`test/experiments/rep-classifier/yam.py`, which no test reads.

## Approach, and why not an existing tool

- **[Label Studio](https://labelstud.io/tags/audio)** is the established
  open-source labelling tool. It shows audio regions with labels and a
  spectrogram, and can [import pre-made regions](https://labelstud.io/guide/predictions).
  But it needs its own Python server, plus scripts to convert logs into
  its tasks and its export back. It shows a whole file with all its
  regions at once rather than one sound at a time, and it can't check
  labels against what was entered after the set.
- **[Prodigy](https://prodi.gy/docs/audio-video)** is paid. Its main idea
  is worth copying: one quick decision per item, made from the keyboard,
  which is faster than drawing regions.
- **Audacity label tracks** work, but every label is typed by hand.

Chosen: a Review page inside the app, using
**[wavesurfer.js](https://wavesurfer.xyz/docs/plugins/)** (BSD-3 licence)
for the waveform, highlighted regions and spectrogram. Our own code only
covers the review queue, the keys, saving, and the checks against the
post-set numbers. Everything it needs is already in the repo: the logs,
the audio, the detector and the store server.

## 1. After each set: two new numbers

The save form gets two fields next to "Reps you actually did":

- **Missed**: breaths out that weren't counted
- **Wrongly counted**: counts that weren't a breath out

Rules:

- **Blank means "didn't check"; 0 means "checked, none".** The data needs
  to tell those apart.
- **The form checks the sums**, using the detector's count before any
  −1/+1 presses: "detected 15 − 1 wrong + 1 missed = 15 ✓".
  It warns if that doesn't match the actual count entered.
- **Where they're saved:** both go into the set log as `missedCount` and
  `wrongCount`, `null` when left blank.
- **What they do later:**
  - give a quick error tally across all sets, with no review needed
  - put flagged sets first on the Review page
  - act as a cross-check once a set has been reviewed (section 5)

The two sets above would be "missed 1, wrong 1, actual 15". Today that set
reads as perfect.

## 2. What gets reviewed: every sound, not just the counted ones

Reviewing only counted sounds finds the wrong counts but never the misses.
The classifier needs both:

- clean examples of breaths out, including the ones the detector rejected
- clean examples of everything else

The current experiment (`clf.py`) trains "counted" against "rejected".
That makes the 43.7 s inhale a positive example and the real exhale at
45.0 s a negative one, which is exactly backwards.

So each set's review covers:

1. **Every sound the gate opened on that lasts 150 ms or more**, counted
   or rejected: about 27 sounds per set. Shorter ones can never become
   reps, so they're skipped.
2. **Missed breaths the gate never opened on**, marked by dragging a
   region on the set's waveform. Only needed when the "missed" number
   isn't explained by rejected sounds labelled as breaths out.

Labels go on the **gate's own segments**, not on redrawn boundaries. A
classifier would run on exactly those segments, so that's what it must
learn from. Hand-drawn regions are only for sounds the gate never opened
on.

## 3. The labels: one key per sound

| Key | Label | Saved as | Meaning |
|---|---|---|---|
| 1 | **Rep breath out** | `rep` | the exhale of a rep |
| 2 | **Other breath out** | `exhale` | an exhale that isn't a rep: setup breath, recovery breath, sigh |
| 3 | **Breath in** | `inhale` | |
| 4 | **Voice** | `voice` | grunt, groan, hum, speech, cough |
| 5 | **Knock** | `knock` | clank, thud, tap, click, weight |
| 6 | **Rustle** | `rustle` | clothes, mat, shuffling, movement |
| 7 | **Other** | `other` | anything else, such as the app's own ding or a noise outside |
| 0 | **Can't tell** | `unclear` | left out of training and tests |

Two flags can be added to any sound:

- **M = mixed** (`"mixed": true`): the segment holds two different sounds, for example an
  inhale running straight into an exhale. Left out of training on sound
  type, but kept in the counting tests.
- **S = same breath as the one before** (`"sameBreath": true`): the gate split one exhale into
  two pieces, such as a tail rejected as "too soon". Both pieces still
  count as breath-out audio for the classifier, but they're one rep.

Splitting breaths out into "rep" and "other" separates two questions:

- **Is it a breath out?** That's about the sound alone, and it's what the
  MFCC classifier should learn. Keys 1 and 2 together are its positives.
- **Was it a rep?** That depends on context, the setup-breath problem.
  Key 1 alone is the truth for counting.

`docs/ideas/compare-sounds-to-reps.md` already found that setup breaths
sound like reps. Mixing the two questions would teach the classifier
something the sound alone can't tell it.

## 4. The Review page

A page of its own, opened whenever there's time to review, usually after
a few workouts. It never runs during a set.

**Set list.** Sets are grouped by day and show:

- the mic and activity
- the post-set numbers
- whether the set has MFCCs
- a status: **not reviewed**, **in progress**, **needs a check** (a
  mismatch, see section 5) or **done**

Sets flagged with missed or wrong counts come first. A set is reviewed all
the way through, so a "done" set is fully labelled and can be scored sound
by sound.

**One sound at a time, in order.** Each set is reviewed from start to
finish, because hearing the sounds either side is how you tell a breath in
from a breath out.

- **What's on screen:** a strip of waveform and spectrogram about ±3 s
  around the sound, with the sound highlighted.
- **Playback:** each sound plays automatically with 0.5 s before and after
  it. Space replays it with that context, and Shift+Space plays the
  segment alone.
- **Half speed:** an option that keeps the pitch, if breath in and breath
  out are hard to tell apart.
- **Keys:** 0 to 7 label the sound and move on, M and S set the flags,
  ←/→ go back and forward, and Z undoes.

**The detector's verdict stays hidden until the sound is labelled.**
Studies of pre-filled labels show people tend to accept the suggestion
even when it's wrong ([Beck et al. 2025](https://arxiv.org/html/2509.08514v1);
[opinion-mining study](https://arxiv.org/pdf/2105.12980)). After the
keypress the page briefly shows "detector: counted" or "rejected: too
soon", so a caught error shows straight away without steering the label.

**At the end of a set** the page shows its summary and the checks in
section 5.

## 5. Keeping the labels honest

1. **A labelling guide** in `docs/labelling-guide.md` that defines each
   label and settles edge cases. Examples:
   - an exhale with a grunt over it is **Voice** if the voice is loudest,
     otherwise **mixed**
   - a breath out before the first rep is **Other breath out**

   Each definition links one or two real example sounds by set id and
   time. The guide has a version number, and every label records the
   version it was made under, so labels made before a definition changed
   can be found.
2. **Checks against the post-set numbers.** When a set's review ends, the
   page compares:
   - rep breaths out (not counting same-breath pieces) against the actual
     count
   - counted sounds labelled as something else against "wrongly counted"
   - breaths out the detector rejected or missed against "missed"

   On a mismatch the page shows which side disagrees, and the labels are
   either fixed or accepted. The review is the truth, but the post-set
   numbers stay saved as entered.
3. **Repeat checks.** During each review session the page slips in about
   1 in 20 sounds labelled in earlier sessions, with no hint they're
   repeats and the earlier answer hidden. The answers are saved separately, and
   the page reports self-agreement per label. If breath in vs breath out
   comes out at 85% agreement, those labels are only that reliable, and
   so is any classifier trained on them: a sign the guide needs
   sharpening. The repeated sounds change each session so they aren't
   recognised. (Guides on [checking labels](https://www.koji.so/docs/data-annotation-quality-guide)
   recommend checking about 5% of items and rotating which ones.)
4. **Later, once there's a classifier: a second-look queue.**
   [cleanlab](https://cleanlab.ai/blog/label-errors-audio-datasets) uses a
   model's held-out predictions to rank the labels most likely to be
   wrong. Those sounds go back on the Review page, blind again.

## 6. Where labels are saved

One file per set, next to the logs: `data/labels/sets/<set-id>.json`, and
`data-routine/labels/sets/` for the routine page. Labels are written by a
person and logs by the app, so they stay apart.

```json
{
  "kind": "set-labels", "setId": "2026-10-31T04-55-25-957Z", "guide": 1,
  "status": "done",
  "sounds": [
    { "start": 42.92, "end": 43.67, "source": "gate", "label": "inhale", "at": "…" },
    { "start": 44.46, "end": 44.99, "source": "gate", "label": "rep", "at": "…" },
    { "start": 60.1,  "end": 61.0,  "source": "added", "label": "rep", "at": "…" }
  ],
  "check": { "result": "matched" }
}
```

The times in the example are illustrative. Sounds are keyed by time, not
by position in the list, so if the gate's rules change later a label still
matches its sound by overlap. Repeat-check answers go in
`data/labels/repeats.json`.

New code this needs:

- **A segmenting module:** one shared function that replays a log through
  the gate and detector and returns each sound's start, end and verdict.
  `test/experiments/rep-classifier/dump.ts` does this today. The page, the
  tests and the export would all use it.
- **New store routes:** list sets with their review status, read a log and
  its audio, and read and write labels.

## 7. What the labels are used for

1. **Tests that check each sound, not just the total.** For every reviewed
   set, replay the detector and match counted sounds to rep labels. A
   wrong count with a matching miss then fails the test, where today they
   cancel out. Sets the detector still gets wrong are listed as expected
   failures by set and time, as now. `npm run report` would show precision
   and recall per mic.
2. **A dataset export, `npm run dataset`.** One row per labelled sound,
   with:
   - set, mic, activity and day
   - start and end
   - label and flags
   - the detector's verdict
   - the **live per-frame MFCCs from the log**

   Training on the logged live features means the classifier learns from
   exactly what it will see at runtime; re-extracting them from the
   compressed recording wouldn't give that. The export also prints counts
   per label and per mic.
3. **The experiments read the labels.** The `SETUP` and `MISSED` lists in
   `rep-template.test.ts` and `yam.py` move into label files, so they're
   kept in one place.
4. **How the classifier gets tested:** with whole days held out, as
   `clf.py` already does. Sounds from the same day would otherwise make it
   look better than it is.

## 8. The backlog

92 logged sets hold about 2,400 sounds of 150 ms or more, roughly 2–3
hours at about 3 s each. A new set takes about 1.5–2 minutes. Suggested
order:

1. Every new set from now on, ideally the same day while it's remembered.
2. The 38 sets that have MFCCs, about an hour. Only these can train a
   classifier on live features.
3. The older sets, only if needed. They have no live MFCCs, but could
   still be useful from their recordings.

## 9. Build order

Each step works on its own and gets its own implementation plan:

1. **The post-set fields** and their sum check. Small, and they start
   collecting data straight away.
2. **The segmenting module, the label file format and the store routes.**
3. **The Review page:** set list, labelling one sound at a time, playback
   and spectrogram, adding missed breaths, and the post-set checks.
4. **The labelling guide and repeat checks.**
5. **Tests that check each sound, the dataset export, and moving the
   experiments' lists into label files.**
6. **Later:** the classifier itself and the cleanlab second-look queue.

## Decisions

Agreed on 2026-10-31:

1. **The label set in section 3** as written, with breaths out split into
   "rep" and "other".
2. **Rejected sounds are reviewed too**, not just counted ones.
3. **The detector's verdict stays hidden** until each sound is labelled.

4. **Repeat checks are kept** (section 5, point 3). They happen only on the
   Review page, about 1 in 20 sounds, and also help clarify earlier
   choices.

Also agreed: labelling is a separate process, done later on its own page.
Nothing in it runs or prompts during a workout. The only change to the
workout pages is the two optional post-set fields in section 1.

## Sources

- [Label Studio Audio tag](https://labelstud.io/tags/audio)
- [Label Studio pre-annotations](https://labelstud.io/guide/predictions)
- [Prodigy audio docs](https://prodi.gy/docs/audio-video)
- [wavesurfer.js plugins](https://wavesurfer.xyz/docs/plugins/)
- [Beck et al., "Bias in the Loop"](https://arxiv.org/html/2509.08514v1)
- [Label suggestions in opinion mining](https://arxiv.org/pdf/2105.12980)
- [Annotation quality guide](https://www.koji.so/docs/data-annotation-quality-guide)
- [Best practices for annotation projects](https://arxiv.org/pdf/2009.11654)
- [cleanlab on audio label errors](https://cleanlab.ai/blog/label-errors-audio-datasets)
- [Crowdsourcing strong labels for sound event detection](https://arxiv.org/pdf/2107.12089)
