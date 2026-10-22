# Idea: compare each sound to the user's own reps

Status: tried on 2026-10-17's data, checked again on 2026-10-22, and not
built. Come back to it once more workouts are logged with their actual
counts entered.

## The problem it would solve

After the checks added on 2026-10-17 (the -30 dB cutoff, soft reps held 1 s
or more, the 3 s length limit and the smooth-breath exception to the spike
check), the remaining known errors are setup breaths: sounds made while
getting into position before the first rep, which pass every check and are
counted. The two fixtures marked as expected failures in
`test/fixtures.test.ts` are both this.

Rhythm-based rules, such as not counting until reps fall into a steady
beat, are ruled out: the user doesn't always keep a rhythm.

## The idea

Judge a borderline sound by how much it sounds like this user's reps of the
same activity:

1. Describe each sound with a few numbers, all from the frames already
   logged: length, peak level, mean flatness, mean high ratio, jitter (mean
   change in level per frame), where the peak falls, and the level curve
   resampled to 10 points relative to its own peak.
2. Build a template per activity and mic from the reps of earlier sets: the
   median of each number and its spread (median absolute deviation). The
   routine page knows each set's activity, and using earlier sets means the
   template exists before the first rep of a set, which is when setup
   breaths happen.
3. Score a sound by how many spreads each number is from the template,
   combined into one distance.
4. Use the score only for borderline calls: reject a sound that passes
   every check but is very unlike a rep, and count one that fails only
   "too quiet" or "spike" but is very rep-like.

## What the test found (2026-10-17 data)

12 routine sets: 8 hip thrust (75 counted reps) and 4 rows (62). Each sound
was scored against the same activity's reps in the other sets.

| Sound | Scoring with loudness | Without loudness |
|---|---|---|
| Hip thrust set 3, setup breath at 12.7 s | above 79% of reps | above 91% of reps |
| Rows set 2, setup breath at 7.6 s | above 97% | above 97% |
| Rows set 2, setup breath at 11.1 s | above 100% | above 82% |

- Two of the three setup breaths fall inside the range of real reps. They
  are breaths much like the reps, so nothing measured from the sound alone
  tells them apart.
- With loudness, real soft reps (such as the two that rows set 3 missed at
  41.9 s and 44.6 s) score as unlike a rep as the setup breaths, because most
  reps are loud. Without it, only the jagged setup breath at 7.6 s stands
  out, and a cutoff that catches it also rejects about 3% of real rows reps.
- No rejected sound looked more rep-like than the typical rep, apart from a
  few hip thrust sounds made while getting into position, so the current
  checks aren't throwing away obvious reps.

Conclusion at the time: not worth building. The − button on the page is the
fix for setup breaths for now.

## Short setup noises (2026-10-22)

Three more setup noises were counted on 2026-10-21, all on the Powerbeats
Pro in single sets: set `2026-10-21T05-25-24-624Z` at 8.1 s, and set
`2026-10-21T05-34-29-105Z` at 8.0 s and 11.6 s. The experiment now also
reads `data/logs/sets/`, grouping each mic's single sets as one activity
since they have none, and these are in `SETUP`. Without loudness they
score above 99%, 97% and 98% of that group's reps.

- They are short and quiet: 299 to 384 ms long, peaking at -24 to -27 dB,
  with a mean level of -28 to -31 dB. They were the three shortest of the
  203 counted sounds in the fixtures, while the shortest real rep in a
  fixture was 555 ms.
- But replaying all the logs turned up loud sounds of 360 to 500 ms mid-set
  that look like real quick reps, so length alone can't separate them.
- A rule that a sound under 500 ms must peak at -23 dB or louder would fix
  the 05-35 fixture, but it rests on three examples from one Powerbeats
  session, with about 2.5 dB of margin.
- On the BY-V Analog Stereo mic real reps peak quieter, down to about
  -24 dB, so an absolute level doesn't carry over between mics. Level
  relative to the gate doesn't separate them either. No setup noises were
  counted in the BY-V sets with an entered count.

Conclusion: still not built. Wait for more examples across mics.

## Coming back to it

1. Log more workouts and enter the actual count after every set, and save
   set data for the sets you're sure of so they become fixtures.
2. Note which counted sounds were setup breaths and add them to `SETUP` in
   `test/experiments/rep-template.test.ts` (set id and end time in seconds;
   `npm run report -- data-routine` and the set logs show the times).
3. Run `npm run experiment`. It prints the scores both with and without
   loudness, per activity.
4. Build it only if setup breaths now score clearly above nearly all real
   reps (say above 99%) without loudness, for more than one activity. Then
   add it to the detector as a borderline-only check and keep it if the
   fixture tests improve.

Things worth trying then: features of the spectrum over time instead of
just its average (the frames only hold flatness and high ratio, so this may
need more saved per frame), and a template from the current set's own reps
once a few are counted.
