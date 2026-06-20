#!/usr/bin/env python3
"""Build a TrainHeroic session from a JSON spec — the whole 5-step flow, done right.

This exists so the workout-creation flow is driven by data, not by hand-assembled
payloads. It fills every field `saveWorkoutSetExercises` needs (the ones that
otherwise return HTTP 500) and encodes prescriptions correctly, including the RPE
caveat below.

RPE handling (important)
------------------------
Setting `param_2_type: 14` (RPE) does NOT stick on exercises whose library default
parameter is weight — the API overrides it back to weight, so the RPE numbers
render as pounds. So this builder NEVER puts RPE in a structured param. An
exercise's `rpe` goes into the `instruction` text ("RPE 8"), reps are prescribed,
and load is left blank for athlete autoregulation. Use `weight` only when you want
an actual prescribed load.

Spec format (JSON)
------------------
{
  "instruction": "Welcome to Week 12...\n\nFind a 1RM Strict Press...",
                                   // optional session note ("Coach Instructions") —
                                   //   the day-note shown above the blocks; set after
                                   //   the blocks exist and does NOT change publish state
  "blocks": [
    {
      "title": "Primary Press",
      "type": 2,                       // 1=Conditioning 2=Hypertrophy 4=Strength (default 2)
      "instruction": "",               // optional block note
      "leaderboard": "rounds",         // optional Red Zone score: rounds/reps/time/
                                       //   calories/meters/miles/weight/... or
                                       //   {"unit":"time","lowest_wins":true}
      "exercises": [
        // reps as a per-set list:
        {"id": 1162, "title": "Bench Press", "reps": [10,10,8,8], "rpe": 8},
        // or a scalar rep count with a set count:
        {"id": 7, "title": "Pull-Up", "sets": 3, "reps": 10},
        // prescribed weight instead of RPE:
        {"id": 1, "title": "Back Squat", "reps": [5,5,5], "weight": [185,205,225]},
        // explicit note overrides the auto "RPE x":
        {"id": 903, "title": "Dips", "sets": 3, "reps": 12, "instr": "to near failure"}
      ]
    }
  ]
}

Two exercises in one block render as a superset (A1, A2) automatically.

A top-level `instruction` sets the session's Coach Instructions — the day-note
(greeting + writeup) shown at the top of the session. It is applied with a final
`PUT /3.0/coach/workout/{workout_id}` once the blocks exist; it does not publish.

Usage
-----
  build_workout.py --program 4980851 --date 2026-6-22 spec.json
  cat spec.json | build_workout.py --program 4980851 --date 2026-6-22 -
  build_workout.py --program 4980851 --timeline-day 0 spec.json   # timeline programs
  build_workout.py --program 4980851 --date 2026-6-22 --replace spec.json  # delete same-date sessions first
  build_workout.py --program 4980851 --date 2026-6-22 --no-publish spec.json
  build_workout.py --program 4980851 --date 2026-6-22 --read --pw 151105135 # read-back only

Flags:
  --replace      delete any existing session(s) on that date before building
  --no-publish   build but leave unpublished (draft)
  --read --pw N  skip building; just print the session whose programWorkout id is N
"""

import argparse
import json
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import th_client as th  # noqa: E402
import library_cache as lib  # noqa: E402  (unit labels + per-exercise defaults)

PARAM_UNIT = lib.PARAM_UNIT  # {10: "mi", 6: "m", 3: "reps", 1: "lb", ...}

# Block-level leaderboard ("Red Zone"). redzone_type > 0 turns the block into a
# leaderboard scored in that unit; the UI shows a trophy + "FOR <LABEL>". This is
# the exercise-independent competition score (note: it has Feet/Meters even where
# the exercise param is locked to another unit). Values from the coach app bundle.
LEADERBOARD_TYPE = {
    "completion": 0, "for completion": 0,
    "weight": 1, "lb": 1, "load": 1,
    "reps": 2, "rep": 2,
    "rounds": 3, "round": 3,
    "time": 4,
    "yards": 5, "yd": 5,
    "meters": 6, "m": 6,
    "feet": 7, "ft": 7,
    "calories": 8, "cal": 8, "cals": 8,
    "miles": 10, "mi": 10,
    "inches": 12, "in": 12,
    "watts": 15, "w": 15,
    "velocity": 17, "m/s": 17,
    "seconds": 18, "sec": 18, "s": 18,
}
LEADERBOARD_LABEL = {
    0: "For Completion", 1: "Weight", 2: "Reps", 3: "Rounds", 4: "Time", 5: "Yards",
    6: "Meters", 7: "Feet", 8: "Calories", 10: "Miles", 12: "Inches", 13: "Other",
    15: "Watts", 16: "Percent", 17: "Velocity", 18: "Seconds",
}


def _unit(param_type):
    return PARAM_UNIT.get(param_type) or "?"


def resolve_leaderboard(block):
    """Map a block's optional `leaderboard` spec to (is_redzone, redzone_type,
    smaller_is_better, redzone_instruction). Returns (None, 0, None, "") when the
    block has no leaderboard.

    Spec forms:
      "leaderboard": "reps"                              # unit string
      "leaderboard": 3                                   # raw redzone_type int
      "leaderboard": {"unit": "time", "lowest_wins": true, "instruction": "..."}
    """
    lb = block.get("leaderboard")
    if lb is None:
        return None, 0, None, ""
    instr, lowest = "", None
    if isinstance(lb, dict):
        unit = lb.get("unit", lb.get("type"))
        instr = lb.get("instruction", "")
        lowest = lb.get("lowest_wins")
    else:
        unit = lb
    if isinstance(unit, str):
        rz = LEADERBOARD_TYPE.get(unit.strip().lower())
        if rz is None:
            raise ValueError(
                f"unknown leaderboard unit {unit!r}; use one of "
                f"{sorted(set(LEADERBOARD_TYPE))}"
            )
    else:
        rz = int(unit)
    # Default: lowest-wins for Time/Seconds (fastest wins), highest-wins otherwise.
    if lowest is None:
        lowest = rz in (4, 18)
    return 1, rz, (1 if lowest else 0), instr


def unit_advisories(blocks):
    """Warn when a spec asks for a param type the API will silently override.

    The API forces param_1_type/param_2_type back to each exercise's library
    default on save (units are fixed per exercise; see references). This reads the
    local exercise cache (offline, no refresh on miss) and flags the cases that
    would otherwise render wrong — a metric distance on the miles-default "Run",
    %-of-max or RPE on a weight lift, a load on an exercise whose secondary unit
    is not weight. Best-effort: any lookup failure just yields no advisory.

    Returns (notes, warnings) as two lists of strings.
    """
    notes, warnings = [], []
    try:
        cache = lib.ExerciseCache()
    except Exception:
        return notes, warnings
    for b in blocks:
        for ex in b.get("exercises", []):
            try:
                defaults = cache.defaults(ex["id"])
            except Exception:
                defaults = None
            if not defaults:
                continue
            def_p1, def_p2 = defaults
            label = f"{b.get('title','?')} / {ex.get('title') or ex['id']}"

            sent_p1 = ex.get("param_1_type")
            if sent_p1 is not None and int(sent_p1) != def_p1:
                warnings.append(
                    f"{label}: param_1_type {sent_p1} ({_unit(int(sent_p1))}) is ignored — "
                    f"this exercise is fixed to {_unit(def_p1)}; values render as {_unit(def_p1)}."
                )
            elif def_p1 not in (3, None):
                notes.append(f"{label}: values are in {_unit(def_p1)} (the exercise's fixed primary unit).")

            if ex.get("weight") is not None:
                sent_p2 = int(ex.get("param_2_type", 1))
                eff_p2 = 1 if def_p2 in (0, None) else def_p2
                if sent_p2 != eff_p2:
                    if sent_p2 in (2, 14):
                        warnings.append(
                            f"{label}: {_unit(sent_p2)} does not stick on this exercise — it renders as "
                            f"{_unit(eff_p2)}. Put it in the exercise 'instr' text and leave load blank."
                        )
                    else:
                        warnings.append(
                            f"{label}: load renders as {_unit(eff_p2)}, not {_unit(sent_p2)} "
                            f"(this exercise's secondary unit is fixed)."
                        )
    return notes, warnings


def _slots(values, n=10):
    """Return 10 string slots filled from values, padded with empty strings."""
    out = []
    for i in range(n):
        out.append(str(values[i]) if values and i < len(values) else "")
    return out


def _reps_list(ex):
    reps = ex.get("reps")
    if isinstance(reps, list):
        return [str(r) for r in reps]
    sets = int(ex.get("sets", 1))
    return [str(reps)] * sets


def make_exercise(ex, wsid, order, key):
    reps = _reps_list(ex)
    weight = ex.get("weight")
    instr = ex.get("instr", "")
    if not instr and ex.get("rpe") is not None:
        instr = f"RPE {ex['rpe']}"

    # Weight is the only structured param-2 we trust. RPE lives in instruction.
    if weight is not None:
        p2_type = ex.get("param_2_type", 1)
        p2_vals = weight if isinstance(weight, list) else [weight] * len(reps)
    else:
        p2_type = 0
        p2_vals = None

    d = {
        "exercise_id": ex["id"],
        "workout_set_id": wsid, "set_id": wsid, "setKey": wsid,
        "title": ex.get("title", ""), "instruction": instr, "order": order,
        "param_1_type": ex.get("param_1_type", 3), "param_2_type": p2_type,
        "workout_set_exercise_template_id": None, "no_sets": 0,
        "param_count": len(reps), "set_num": len(reps),
        "key": key, "video_url": "", "thumbnail_url": "", "tags": [],
        "eType": "e", "use_count": 0,
    }
    p1_slots = _slots(reps)
    p2_slots = _slots([str(v) for v in p2_vals] if p2_vals else None)
    for i in range(10):
        d[f"param_1_data_{i+1}"] = p1_slots[i]
        d[f"param_2_data_{i+1}"] = p2_slots[i]
    return d


def _require_ok(label, status, body):
    if not (200 <= status < 300):
        print(f"FAILED at {label}: HTTP {status}\n{json.dumps(body, indent=2) if isinstance(body, (dict, list)) else body}",
              file=sys.stderr)
        sys.exit(1)


def delete_sessions_on_date(program_id, y, m, d):
    status, data = th.request("GET", f"/1.0/coach/programs/edit/{program_id}/{y}/{m}/{d}")
    _require_ok("read-for-replace", status, data)
    pws = [p for p in data.get("programWorkouts", []) if (p.get("year"), p.get("month"), p.get("day")) == (y, m, d)]
    for p in pws:
        st, r = th.request("POST", "/2.0/coach/calendar/removeProgramWorkout",
                           {"programId": program_id, "pwId": p["id"]})
        _require_ok(f"delete pw {p['id']}", st, r)
        print(f"  replaced: deleted existing session pw={p['id']}")


def _ordered_block_ids(sets):
    """Flatten a programWorkout's `sets` into an ordered list of block ids.

    Both the create response and `/1.0/coach/programs/edit` return `sets` as a dict
    keyed by block id (each value a block object with an `order`); the session PUT
    wants `sets`/`setKeys` as a flat list of block ids sorted by block order. A list
    is returned unchanged.
    """
    if isinstance(sets, dict):
        return [int(bid) for bid, blk in sorted(sets.items(), key=lambda kv: kv[1].get("order", 0))]
    return list(sets or [])


def set_session_instruction(workout_id, pw, instruction, block_ids=None):
    """Set a session's Coach Instructions (the day-note at the top of the session).

    `pw` is the programWorkout object — the create-time response, or a day's entry
    from `/1.0/coach/programs/edit`. `PUT /3.0/coach/workout/{workout_id}` wants the
    whole object back with `instruction` set and `sets`/`setKeys` as a flat list of
    block ids (the GETs return `sets` as a dict). This does NOT change publish state:
    `published` is sent exactly as it is on `pw`, so set the instruction before
    publishing if the session should stay a draft.
    """
    ids = block_ids if block_ids is not None else _ordered_block_ids(pw.get("sets"))
    body = dict(pw)
    body["instruction"] = instruction
    body["sets"] = ids
    body["setKeys"] = ids
    status, r = th.request("PUT", f"/3.0/coach/workout/{workout_id}", body)
    _require_ok("set session instruction", status, r)


def build(program_id, blocks, date=None, timeline_day=None, publish=True, instruction=None):
    notes, warnings = unit_advisories(blocks)
    for n in notes:
        print(f"  note: {n}", file=sys.stderr)
    for w in warnings:
        print(f"  WARNING: {w}", file=sys.stderr)

    if timeline_day is not None:
        path = f"/2.0/coach/calendar/workout/createWorkoutForTimelineDay/{program_id}/{timeline_day}/null"
    else:
        y, m, d = date
        path = f"/2.0/coach/calendar/workout/createWorkoutForDay/{program_id}/{y}/{m}/{d}/0"
    status, sess = th.request("POST", path, {})
    _require_ok("createWorkout", status, sess)
    workout_id, pw_id = sess["workout_id"], sess["id"]

    block_payload = []
    for i, b in enumerate(blocks):
        is_rz, rz_type, smaller, rz_instr = resolve_leaderboard(b)
        block_payload.append({
            "workout_id": workout_id, "order": i + 1, "type": b.get("type", 2),
            "instruction": b.get("instruction", ""),
            "is_redzone": is_rz, "redzone_type": rz_type,
            "smaller_is_better": smaller, "redzone_instruction": rz_instr,
            "exercises": [], "exerciseKeys": [], "key": f"k::{workout_id}{i+1}",
            "title": b["title"],
        })
    status, created = th.request("POST", "/2.0/coach/calendar/saveProgramWorkoutSets", block_payload)
    _require_ok("saveProgramWorkoutSets", status, created)
    by_order = {blk["order"]: blk["id"] for blk in created}

    counter = 0
    for i, b in enumerate(blocks):
        wsid = by_order[i + 1]
        ex_payload = []
        for j, ex in enumerate(b["exercises"]):
            counter += 1
            ex_payload.append(make_exercise(ex, wsid, j + 1, f"k::{workout_id}{counter:03d}"))
        status, r = th.request("POST", "/2.0/coach/calendar/saveWorkoutSetExercises", ex_payload)
        _require_ok(f"saveWorkoutSetExercises (block '{b['title']}')", status, r)

    # Session note (Coach Instructions). Set before publish so it leaves the
    # draft/published state untouched — the PUT echoes `published` back as-is.
    if instruction:
        ordered_block_ids = [by_order[o] for o in sorted(by_order)]
        set_session_instruction(workout_id, sess, instruction, ordered_block_ids)

    if publish:
        status, r = th.request("POST", "/2.0/coach/calendar/programWorkout/publish", [pw_id])
        _require_ok("publish", status, r)

    return pw_id, workout_id


def read_session(program_id, y, m, d, pw_id):
    status, data = th.request("GET", f"/1.0/coach/programs/edit/{program_id}/{y}/{m}/{d}")
    _require_ok("read", status, data)
    pw = next((p for p in data.get("programWorkouts", []) if p["id"] == pw_id), None)
    if not pw:
        print(f"programWorkout {pw_id} not found on {y}-{m}-{d}", file=sys.stderr)
        sys.exit(1)
    print(f"Session pw={pw_id}  date={pw.get('year')}-{pw.get('month')}-{pw.get('day')}  published={pw.get('published')}")
    if pw.get("instruction"):
        print("  Coach Instructions:")
        for line in pw["instruction"].splitlines() or [""]:
            print(f"    {line}")
    for b in sorted(pw["sets"].values(), key=lambda s: s["order"]):
        rz = b.get("redzone_type")
        lb = ""
        if rz:
            tag = LEADERBOARD_LABEL.get(rz, f"type {rz}")
            lb = f"   🏆 FOR {tag.upper()}" + (" (lowest wins)" if b.get("smaller_is_better") else "")
        print(f"  [{b['order']}] {b['title']}{lb}")
        for ex in sorted(b["exercises"], key=lambda e: e["order"]):
            reps = [ex[f"param_1_data_{i}"] for i in range(1, 11) if ex[f"param_1_data_{i}"]]
            p2 = [ex[f"param_2_data_{i}"] for i in range(1, 11) if ex[f"param_2_data_{i}"]]
            # Units are whatever the API actually stored (it overrides the spec to
            # the exercise default), so label from the stored param types.
            u1 = PARAM_UNIT.get(ex["param_1_type"])
            u2 = PARAM_UNIT.get(ex["param_2_type"])
            prim = ",".join(reps) + ((" " + u1) if (u1 and u1 != "reps") else "")
            load = f"  @ {','.join(p2)}" + ((" " + u2) if u2 else "") if p2 else ""
            note = f"   [{ex['instruction']}]" if ex.get("instruction") else ""
            print(f"      {ex['order']}. {ex['title']}  {prim}{load}{note}")


def _parse_date(s):
    parts = s.split("-")
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("date must be YYYY-M-D")
    return tuple(int(p) for p in parts)


def main():
    ap = argparse.ArgumentParser(description="Build a TrainHeroic session from a JSON spec")
    ap.add_argument("spec", nargs="?", help="spec JSON file, or - for stdin")
    ap.add_argument("--program", type=int, required=True, help="calendar/program id")
    ap.add_argument("--date", type=_parse_date, help="YYYY-M-D (date-based team calendar)")
    ap.add_argument("--timeline-day", type=int, help="relative day index (timeline programs)")
    ap.add_argument("--replace", action="store_true", help="delete same-date sessions first")
    ap.add_argument("--no-publish", dest="publish", action="store_false", help="leave as draft")
    ap.add_argument("--read", action="store_true", help="read-back only (needs --pw)")
    ap.add_argument("--pw", type=int, help="programWorkout id for --read")
    args = ap.parse_args()

    if args.read:
        if not (args.date and args.pw):
            ap.error("--read needs --date and --pw")
        read_session(args.program, *args.date, args.pw)
        return

    if not args.spec:
        ap.error("a spec file (or -) is required unless --read")
    raw = sys.stdin.read() if args.spec == "-" else open(args.spec).read()
    spec = json.loads(raw)
    blocks = spec["blocks"] if isinstance(spec, dict) else spec
    instruction = spec.get("instruction") if isinstance(spec, dict) else None

    if args.replace and args.date:
        delete_sessions_on_date(args.program, *args.date)

    pw_id, workout_id = build(args.program, blocks, date=args.date,
                              timeline_day=args.timeline_day, publish=args.publish,
                              instruction=instruction)
    print(f"Built session: pw={pw_id} workout_id={workout_id} published={args.publish}")
    if args.date:
        read_session(args.program, *args.date, pw_id)


if __name__ == "__main__":
    main()
