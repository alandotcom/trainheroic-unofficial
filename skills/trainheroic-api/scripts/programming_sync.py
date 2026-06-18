#!/usr/bin/env python3
"""Sync TrainHeroic programming (prescribed workouts) into the local store.

This populates the programming zone of ~/.trainheroic/library.db:
program -> program_session -> block -> prescribed_set, at set-level grain.

Source of truth
---------------
A program/calendar's sessions come from `GET /1.0/coach/programs/edit/{cal}/{y}/{m}/{d}`,
which returns the WHOLE calendar's `programWorkouts` regardless of the date in the
path (so one call is a complete snapshot). Calendars to sync are the union of
standalone programs (`/1.0/coach/programs`) and team group-programs
(`/1.0/coach/teams[].group_program`).

Reconciliation
--------------
Each session is upserted and its blocks/prescribed_sets are rebuilt (delete +
re-insert) so edits are absorbed and re-runs are idempotent. The programming zone
is accumulate-only: sessions are never pruned, so it retains history even after a
session is removed on TrainHeroic. A per-program cursor is written to
sync_state('programming', cal_id).

  programming_sync.py            # sync every calendar
  programming_sync.py 4980851    # sync one calendar id
"""

import datetime as dt
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import th_client as th  # noqa: E402
from library_cache import ExerciseCache, _coerce_int  # noqa: E402

# How wide to walk the calendar, in months around today.
MONTHS_BACK = 18
MONTHS_FWD = 6


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def list_calendars():
    """Calendar ids to sync, mapped to a title: programs + team group-programs."""
    cals = {}
    _, programs = th.request("GET", "/1.0/coach/programs")
    if isinstance(programs, list):
        for p in programs:
            if p.get("id"):
                cals[p["id"]] = p.get("title") or ""
    _, teams = th.request("GET", "/1.0/coach/teams")
    if isinstance(teams, list):
        for t in teams:
            gp = t.get("group_program")
            if gp:
                cals.setdefault(gp, t.get("title") or "")
    return cals


def _months(months_back=MONTHS_BACK, months_fwd=MONTHS_FWD):
    """Yield (year, month) for each month in the window around today."""
    today = dt.date.today()
    base = today.year * 12 + (today.month - 1)
    for k in range(-months_back, months_fwd + 1):
        idx = base + k
        yield idx // 12, idx % 12 + 1


def fetch_calendar(cal_id):
    """programs/edit returns one calendar month per call, so walk the window and
    union by session id (the endpoint scopes results to the queried month)."""
    by_id = {}
    for y, m in _months():
        status, data = th.request("GET", f"/1.0/coach/programs/edit/{cal_id}/{y}/{m}/1")
        if not (200 <= status < 300) or not isinstance(data, dict):
            continue
        for pw in data.get("programWorkouts", []) or []:
            by_id[pw["id"]] = pw
    return list(by_id.values())


def sync_calendar(cache, cal_id, title=""):
    conn = cache.conn
    pws = fetch_calendar(cal_id)

    conn.execute(
        "INSERT INTO program (id, title, raw, source) VALUES (?,?,?,'api') "
        "ON CONFLICT(id) DO UPDATE SET title=excluded.title, raw=excluded.raw",
        (cal_id, title, json.dumps({"id": cal_id, "title": title})),
    )

    n_sessions, n_blocks, n_sets = 0, 0, 0
    for pw in pws:
        if pw.get("deleted"):
            continue
        sid = pw["id"]
        date = f"{int(pw['year']):04d}-{int(pw['month']):02d}-{int(pw['day']):02d}"
        conn.execute(
            "INSERT INTO program_session (id, program_id, day_index, date, title, published, raw, source) "
            "VALUES (?,?,?,?,?,?,?,'api') ON CONFLICT(id) DO UPDATE SET "
            "program_id=excluded.program_id, day_index=excluded.day_index, date=excluded.date, "
            "title=excluded.title, published=excluded.published, raw=excluded.raw",
            (sid, cal_id, pw.get("timeline_day"), date, pw.get("title") or "",
             _coerce_int(pw.get("published")) or 0,
             json.dumps({k: v for k, v in pw.items() if k != "sets"})),
        )
        n_sessions += 1

        # Rebuild this session's blocks + sets so re-syncs don't duplicate.
        conn.execute(
            "DELETE FROM prescribed_set WHERE block_id IN (SELECT id FROM block WHERE program_session_id=?)",
            (sid,),
        )
        conn.execute("DELETE FROM block WHERE program_session_id=?", (sid,))

        for blk in sorted((pw.get("sets") or {}).values(), key=lambda b: b.get("order") or 0):
            bid = blk["id"]
            conn.execute(
                "INSERT INTO block (id, program_session_id, ord, type, title, instruction, raw, source) "
                "VALUES (?,?,?,?,?,?,?,'api')",
                (bid, sid, _coerce_int(blk.get("order")), _coerce_int(blk.get("type")),
                 blk.get("title") or "", blk.get("instruction") or "", json.dumps(blk)),
            )
            n_blocks += 1
            for ex in blk.get("exercises") or []:
                ex_id = _coerce_int(ex.get("exercise_id"))
                p1t, p2t = _coerce_int(ex.get("param_1_type")), _coerce_int(ex.get("param_2_type"))
                for i in range(1, 11):
                    v1, v2 = ex.get(f"param_1_data_{i}"), ex.get(f"param_2_data_{i}")
                    if v1 in (None, "") and v2 in (None, ""):
                        continue
                    conn.execute(
                        "INSERT INTO prescribed_set (block_id, exercise_id, set_index, "
                        "param_1_type, param_1_value, param_2_type, param_2_value, source) "
                        "VALUES (?,?,?,?,?,?,?,'api')",
                        (bid, ex_id, i, p1t, _num(v1), p2t, _num(v2)),
                    )
                    n_sets += 1

    # Accumulate-only: sessions are upserted and never pruned (this is programming
    # history). Each session's own blocks/sets are rebuilt above to absorb edits.
    cache.set_cursor("programming", cal_id, cursor=time.strftime("%Y-%m-%d"))
    conn.commit()
    return {"program": cal_id, "title": title, "sessions": n_sessions,
            "blocks": n_blocks, "prescribed_sets": n_sets}


def sync_all(cache):
    return [sync_calendar(cache, cal_id, title) for cal_id, title in list_calendars().items()]


def main():
    cache = ExerciseCache()
    if len(sys.argv) > 1:
        cal_id = int(sys.argv[1])
        result = [sync_calendar(cache, cal_id, list_calendars().get(cal_id, ""))]
    else:
        result = sync_all(cache)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
