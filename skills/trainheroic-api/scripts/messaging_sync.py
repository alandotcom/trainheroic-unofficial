#!/usr/bin/env python3
"""Sync TrainHeroic messages (chat) into the local store.

This populates the messaging zone of ~/.trainheroic/library.db:
message_stream (one row per conversation) -> message_comment (one row per message).

Source of truth
---------------
- Conversations: `GET /v5/messaging/streams`, which returns four buckets —
  `teams`, `athletes` (1:1), `programs`, `coaches`. Each entry's `id` is the
  *stream* id (distinct from teamId/userId) used by every other messaging call.
- Messages: `GET /v5/messaging/streams/{id}/comments?lastCommentId={cursor}`.
  Passing the highest comment id already stored returns only newer comments, so
  the sync is incremental. A blank cursor returns the whole stream.

The chat the web app shows in real time is delivered over a separate long-poll
channel (`adapter.trainheroic.com/messaging?timestamp=...`); a coach-side sync
does not need it — polling the REST `comments` endpoint with `lastCommentId`
captures the same messages.

Reconciliation
--------------
Accumulate-only, like the programming zone: comments are upserted by id and never
pruned, so a message soft-deleted on TrainHeroic is retained here as history.
A per-stream cursor (the max comment id seen) is written to
sync_state('messaging', stream_id). `--full` ignores the cursor and re-pulls each
stream from scratch — use it to refresh reactions/replies on already-synced
comments, which an incremental pull (newer-than-cursor only) will not pick up.

  messaging_sync.py            # incremental sync of every stream
  messaging_sync.py --full     # re-pull every stream from the beginning
  messaging_sync.py 37730920   # one stream id (incremental)
  messaging_sync.py --quiet    # skip the streams that have no new comments
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import th_client as th  # noqa: E402
from library_cache import ExerciseCache, _coerce_int  # noqa: E402

# kind -> the bucket key the streams endpoint returns it under.
BUCKETS = {"team": "teams", "athlete": "athletes", "program": "programs", "coach": "coaches"}


def list_streams():
    """Flatten GET /v5/messaging/streams into (stream_dict, kind) tuples."""
    status, data = th.request("GET", "/v5/messaging/streams")
    if not (200 <= status < 300) or not isinstance(data, dict):
        raise RuntimeError(f"GET /v5/messaging/streams failed (HTTP {status}): {data}")
    out = []
    for kind, key in BUCKETS.items():
        for s in data.get(key, []) or []:
            if s.get("id") is not None:
                out.append((s, kind))
    return out


def _upsert_stream(conn, s, kind):
    sid = _coerce_int(s.get("id"))
    conn.execute(
        "INSERT INTO message_stream (id, kind, title, team_id, user_id, last_viewed, raw, source) "
        "VALUES (?,?,?,?,?,?,?,'api') ON CONFLICT(id) DO UPDATE SET "
        "kind=excluded.kind, title=excluded.title, team_id=excluded.team_id, "
        "user_id=excluded.user_id, last_viewed=excluded.last_viewed, raw=excluded.raw",
        (sid, kind, s.get("title") or "", _coerce_int(s.get("teamId")),
         _coerce_int(s.get("userId")), _coerce_int(s.get("lastViewed")), json.dumps(s)),
    )
    return sid


def _upsert_comment(conn, stream_id, c, parent_id=None):
    """Insert/update one comment row; recurse into its replies. Returns max id seen."""
    cid = _coerce_int(c.get("id"))
    if cid is None:
        return 0
    conn.execute(
        "INSERT INTO message_comment "
        "(id, stream_id, ts, content, author_name, author_logo, image_url, is_author, parent_id, reactions, raw, source) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,'api') ON CONFLICT(id) DO UPDATE SET "
        "ts=excluded.ts, content=excluded.content, author_name=excluded.author_name, "
        "author_logo=excluded.author_logo, image_url=excluded.image_url, "
        "is_author=excluded.is_author, parent_id=excluded.parent_id, "
        "reactions=excluded.reactions, raw=excluded.raw",
        (cid, stream_id, _coerce_int(c.get("timestamp")), c.get("content") or "",
         c.get("authorName") or "", c.get("authorLogo") or "", c.get("imageUrl"),
         1 if c.get("isAuthor") else 0, parent_id,
         json.dumps(c.get("reactions") or []), json.dumps(c)),
    )
    high = cid
    for reply in c.get("replies") or []:
        high = max(high, _upsert_comment(conn, stream_id, reply, parent_id=cid))
    return high


def sync_stream(cache, s, kind, full=False):
    conn = cache.conn
    sid = _upsert_stream(conn, s, kind)

    cursor = "" if full else ((cache.get_cursor("messaging", sid) or {}).get("cursor") or "")
    status, data = th.request("GET", f"/v5/messaging/streams/{sid}/comments?lastCommentId={cursor}")
    if not (200 <= status < 300) or not isinstance(data, list):
        conn.commit()
        return {"stream": sid, "title": s.get("title") or "", "kind": kind,
                "new": 0, "error": f"HTTP {status}"}

    new, high = 0, _coerce_int(cursor) or 0
    for c in data:
        high = max(high, _upsert_comment(conn, sid, c))
        new += 1

    if high:
        cache.set_cursor("messaging", sid, cursor=str(high))
    conn.commit()
    return {"stream": sid, "title": s.get("title") or "", "kind": kind, "new": new}


def sync_all(cache, full=False, quiet=False):
    results = [sync_stream(cache, s, kind, full=full) for s, kind in list_streams()]
    if quiet:
        results = [r for r in results if r.get("new") or r.get("error")]
    return results


def main():
    args = sys.argv[1:]
    full = "--full" in args
    quiet = "--quiet" in args
    ids = [int(a) for a in args if not a.startswith("--")]

    cache = ExerciseCache()
    if ids:
        by_id = {_coerce_int(s.get("id")): (s, kind) for s, kind in list_streams()}
        results = []
        for sid in ids:
            if sid in by_id:
                s, kind = by_id[sid]
                results.append(sync_stream(cache, s, kind, full=full))
            else:
                results.append({"stream": sid, "error": "not found in /v5/messaging/streams"})
    else:
        results = sync_all(cache, full=full, quiet=quiet)

    total_new = sum(r.get("new", 0) for r in results)
    print(json.dumps({"streams": len(results), "new_comments": total_new, "detail": results}, indent=2))


if __name__ == "__main__":
    main()
