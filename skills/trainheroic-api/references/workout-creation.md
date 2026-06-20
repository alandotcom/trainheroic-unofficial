# Workout Creation Playbook

Building a workout is a multi-step sequence. Each step depends on an ID returned
by the previous one, so run them in order and capture the IDs. The exercise-add
step (step 4) is the one that returns HTTP 500 when fields are missing, so follow
its field list exactly.

All calls use the coach base (`https://api.trainheroic.com`) with the
`session-token` header. With the client: `$TH request POST <path> '<json>'`.

> **Prefer the builder.** the workout builder runs this whole sequence
> from a JSON spec and already fills the 500-prone fields and handles RPE
> correctly. Reach for the manual steps below only when debugging or doing
> something the builder does not cover.
>
> **RPE rule (verified the hard way):** never prescribe RPE as a structured param.
> `param_2_type: 14` is silently overridden to weight on any lift whose library
> default param is weight, so the RPE values render as pounds. Put RPE in the
> exercise `instruction` ("RPE 8"), prescribe reps, and leave load blank.

## Step 1 — Get a program/calendar to write to

Every team has an auto-created calendar (a "program"). Create a team if you need a
fresh target:

```
POST /1.0/coach/team/createWithTitleAndCode
{ "title": "My Team" }
```

The response and its side-effect loads expose the calendar/program ID (e.g.
`4713246`). Existing programs come from `GET /1.0/coach/programs` (use
`group_program` as the calendar ID for `/3.0/coach/program/{id}`).

## Step 2 — Create an empty session on a date

Date-based (team calendar):
```
POST /2.0/coach/calendar/workout/createWorkoutForDay/{calendarId}/{year}/{month}/{day}/0
```

Timeline-based (relative-day programs):
```
POST /2.0/coach/calendar/workout/createWorkoutForTimelineDay/{programId}/{day}/null
```

Pass an empty JSON body (`{}`). The response is a session object. Capture two
IDs from it (verified live):
- `workout_id` — the workout, needed by step 3 for blocks.
- `id` — the programWorkout id, needed by step 5 to publish (and by
  `removeProgramWorkout` as `pwId`).

## Step 3 — Add a block to the session

```
POST /2.0/coach/calendar/saveProgramWorkoutSets
[{
  "workout_id": 140318787,
  "order": 1,
  "type": 4,
  "instruction": "",
  "is_redzone": null,
  "redzone_type": 0,
  "exercises": [],
  "exerciseKeys": [],
  "key": "k::9292",
  "title": "Strength/Power"
}]
```

`type` values: `1` = Conditioning, `2` = Hypertrophy, `4` = Strength/Power. The
endpoint accepts an array, so multiple blocks can be created in one call. The
response is an array of the created blocks; each block's `id` is its
`workout_set_id`, which step 4 needs (the `key` you send comes back as `null`,
so match blocks by `order`/`title`).

## Step 4 — Add exercises to the block (the 500-prone step)

```
POST /2.0/coach/calendar/saveWorkoutSetExercises
[ exercise1, exercise2, ... ]
```

Every exercise object must include the full field set below. Omitting any of the
"critical" fields returns HTTP 500.

```json
{
  "exercise_id": 1,
  "workout_set_id": 671135671,
  "set_id": 671135671,
  "title": "Back Squat",
  "instruction": "",
  "order": 1,
  "param_1_type": 3,
  "param_2_type": 1,
  "param_1_data_1": "5", "param_1_data_2": "", "param_1_data_3": "",
  "param_1_data_4": "", "param_1_data_5": "", "param_1_data_6": "",
  "param_1_data_7": "", "param_1_data_8": "", "param_1_data_9": "", "param_1_data_10": "",
  "param_2_data_1": "225", "param_2_data_2": "", "param_2_data_3": "",
  "param_2_data_4": "", "param_2_data_5": "", "param_2_data_6": "",
  "param_2_data_7": "", "param_2_data_8": "", "param_2_data_9": "", "param_2_data_10": "",
  "workout_set_exercise_template_id": null,
  "no_sets": 0,
  "param_count": 3,
  "set_num": 3,
  "key": "k::5001",
  "setKey": 671135671,
  "video_url": "",
  "thumbnail_url": "",
  "tags": [],
  "eType": "e",
  "use_count": 0
}
```

Fields that cause a 500 when missing:
- `set_num` — number of sets (mirror `param_count`)
- `key` — any unique string in the form `"k::<number>"`
- `setKey` — equal to `workout_set_id`
- All 10 `param_1_data_N` and all 10 `param_2_data_N` slots — unused ones are `""`
- `eType` — `"e"` for an exercise
- `tags` — array, may be `[]`
- `video_url`, `thumbnail_url` — strings, may be `""`
- `use_count` — integer, may be `0`
- `workout_set_exercise_template_id` — `null`

The API ignores the `title` you send and substitutes the real title for
`exercise_id`. It may also override `param_2_type` from the exercise's defaults.

## Step 5 — Publish

```
POST /2.0/coach/calendar/programWorkout/publish
[ 142002657 ]   // array of programWorkout IDs
```

## (Optional) Session note — Coach Instructions

The session-level note (the day-note shown at the top of a session — greeting +
writeup) is set with a PUT to the programWorkout, not on a block. Use the same
`workout_id` from step 2:

```
PUT /3.0/coach/workout/{workout_id}
{ ...the full programWorkout object..., "instruction": "Welcome to Week 12..." }
```

Build the body from the session object you already have (the create response, or a
day's entry from `/1.0/coach/programs/edit`), set `instruction`, and replace
`sets`/`setKeys` with a flat **list** of block ids sorted by `order` — the edit-GET
returns `sets` as a dict keyed by block id, so convert it. This does **not** publish:
`published` is echoed back as sent, so set the note **before** step 5 if the session
should stay a draft. the workout builder does all of this when the spec has a
top-level `"instruction"`.

## Reading a session back (verified)

To confirm what was built on a team calendar date:

```
GET /1.0/coach/programs/edit/{calendarId}/{year}/{month}/{day}
```

This returns `programWorkouts`, an array of every session on the calendar (it is
not scoped to the single date you pass). Match the one you built by the `id` you
captured at create time — do not assume `programWorkouts[0]`. On the matched
session, `published` is `1` once published, and blocks live under its `sets`
object keyed by `workout_set_id`; each block has an `exercises` array with the
rendered `title`, `instruction`, and `param_*_data_N` values.

---

## Parameter types

| Value | Meaning | Display |
|-------|---------|---------|
| 0 | None | (no parameter) |
| 1 | Weight | `225 lb` |
| 2 | Weight (% of max) | `75%` |
| 3 | Reps | `5` |
| 4 | Time (seconds) | `1:00` |
| 5 | Distance (yards) | `50yd` |
| 6 | Distance (meters) | `50m` |
| 7 | Height | inches |
| 10 | Distance (miles) | miles |
| 11 | Distance (feet) | feet |
| 12 | Height (inches) | inches |
| 13 | Heart Rate | bpm |
| 14 | RPE | rating |
| 18 | Time (seconds, alt) | `0:30` |

Most common combos: `p1=3,p2=1` (reps @ weight, e.g. Back Squat), `p1=3,p2=0`
(reps only / bodyweight, e.g. Push-Up), `p1=3` with `p2` absent (reps only),
`p1=5` (distance in yards), `p1=4` (time).

`param_1_data_N` is the value for param 1 in set N; `param_2_data_N` likewise for
param 2. `param_count` is the number of sets (max 10).

### The unit is fixed per exercise (verified)

On save the API **discards the `param_1_type`/`param_2_type` you send and restores
the exercise's library defaults.** Your `param_*_data_N` values are kept, so a value
sent under the wrong assumed unit silently renders under the exercise's real unit.

- **`param_1_type` (primary): always forced to the exercise default.** You cannot
  change the primary unit at prescribe time. Stock `Run` (id 82) is miles, so a
  "200 m run" written on `Run` renders as *200 miles*. For meters use a meters-native
  exercise (`Sprint` 127, `Rowing` 101, `Shuttle Sprint` 42523) or a custom exercise.
- **`param_2_type` (secondary): forced to the default too, except** you may add weight
  (`1`) to an exercise that has no secondary param (default `0`/none) — that is how
  weighted Pull-Ups/Dips work. `2` (% of max) and `14` (RPE) do **not** stick on a
  weight-default lift; both coerce to weight and render as pounds.
- Check an exercise's real units first: `$TH exercise resolve "<name>"` prints
  `param_1_unit`/`param_2_unit`. the workout builder also prints a `WARNING` when a
  sent param type will be overridden, and its read-back labels the stored units.

## Prescription patterns

- **Superset**: send multiple exercises in one array, same `workout_set_id`/
  `set_id`, different `order`. They render as A1, A2, ...
- **Drop set**: one exercise, decreasing weight and increasing reps across the
  `_data_N` slots.
- **Pyramid**: vary both params up then down across the slots
  (e.g. reps `5,3,1,3,5` at weight `185,225,275,225,185`).
- **Bodyweight**: `param_2_type: 0` and leave every `param_2_data_N` empty.
- **Weighted bodyweight** (weighted Pull-Up/Dip): add `param_2_type: 1` with loads.
  Adding weight sticks *only* on exercises whose default secondary is none (`0`).
- **Max / AMRAP reps (verified)**: the rep slots are free text — put the literal
  string `"Max"` (or `"AMRAP"`, `"ME"`) in `param_1_data_N`; it round-trips verbatim
  and you can mix it with numbers (e.g. last set `"Max"`). The builder accepts
  `"reps": ["Max", "Max"]` or `"reps": [5, 5, "Max"]`.
- **RPE and % of max (verified caveat)**: `param_2_type: 14` (RPE) and `2` (% of max)
  do **not** stick on exercises whose library default param is weight — the API
  overrides them back to weight, so the numbers render as pounds. Reliable approach:
  prescribe reps with `param_2_type: 0` (load left blank for athlete autoregulation)
  and put the target in the exercise `instruction` (e.g. `"RPE 8"` or `"75% of max"`).
  The `instruction` field round-trips intact. (This is one case of the fixed-unit
  rule above.)

## Common exercise IDs

| ID | Title | p1 | p2 |
|----|-------|----|----|
| 1 | Back Squat | 3 | 1 |
| 3 | Front Squat | 3 | 1 |
| 7 | Pull-Up | 3 | 0 |
| 24 | Burpee | 3 | 0 |
| 36 | Air Squat | 3 | 0 |
| 67 | Plank | 4 | 0 |
| 100 | Push-Up | 3 | 0 |
| 424 | Deadlift | 3 | 1 |
| 1162 | Bench Press | 3 | 1 |

Full library: `GET /v5/exerciseLibrary/all`. Custom exercises:
`POST /2.0/coach/exercise/create` with your own `title`, `param_1_type`,
`param_2_type`.

## Leaderboards (Red Zone)

A block can be a **leaderboard** — TrainHeroic's "Red Zone" competition score. The
UI shows a trophy and "FOR <UNIT>". It is encoded on the block, not the exercise,
and is a separate unit system (it has Feet/Meters/Calories even when the exercise
param is locked to another unit):

- `redzone_type` = the score unit; setting it `> 0` flags `is_redzone = 1`.
- `smaller_is_better = 1` makes the lowest score win (use for Time/Seconds).
- `redzone_instruction` = optional scoring note.

`redzone_type` values: `0` For Completion, `1` Weight, `2` Reps, `3` Rounds,
`4` Time, `5` Yards, `6` Meters, `7` Feet, `8` Calories, `10` Miles, `12` Inches,
`15` Watts, `17` Velocity, `18` Seconds.

In the workout builder add `"leaderboard"` to a block: a unit string (`"rounds"`,
`"time"`, `"calories"`, ...) or `{"unit": "time", "lowest_wins": true,
"instruction": "..."}`. Time/Seconds default to lowest-wins.

**When to set one (ask if unclear).** For an **AMRAP**, score = `rounds` (or `reps`);
for a **"for time"** workout, score = `time` (lowest wins); for a max-distance/row,
the distance/calorie unit. If the coach's intent is ambiguous, ask rather than guess.
For an AMRAP also program **multiple sets** (one per expected round) — assume a fit
athlete's round count (e.g. ~5–6 rounds for a ~10–12 min triplet) and confirm if unsure.

## Editing and managing sessions

- Set the session note (Coach Instructions): `PUT /3.0/coach/workout/{workoutId}`
  with the programWorkout object + `instruction` (does not change publish state).
- Unpublish: `POST /2.0/coach/calendar/programWorkout/unPublish/{programWorkoutId}`
- Delete: `POST /2.0/coach/calendar/removeProgramWorkout` `{ "programId", "pwId" }`
- Copy/repeat to a date: `POST /2.0/coach/calendar/copyProgramWorkout`
- Save as template: `POST /2.0/coach/calendar/programWorkout/saveWorkoutAsTemplate/{workoutId}`
