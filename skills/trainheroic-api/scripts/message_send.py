#!/usr/bin/env python3
"""Compose, preview, and (only on explicit request) send TrainHeroic chat messages.

Sending a message is athlete-facing and immediate: TrainHeroic chat has no
server-side draft state, so a POST is delivered the moment it lands. This tool
therefore separates *drafting* from *sending*:

  message_send.py streams                              # list conversations + stream ids
  message_send.py read   <stream_id> [--limit N]       # show recent messages
  message_send.py draft  <stream_id> "<text>" [--reply-to <id>]   # PREVIEW only — never sends
  message_send.py send   <stream_id> "<text>" [--reply-to <id>]   # actually POSTs the message
  message_send.py delete <stream_id> <comment_id>      # remove a message (soft delete)

`draft` prints the exact payload and the target conversation for review and exits
without touching the account. Only `send` performs the write. Per the skill's
destructive-actions policy, get the user's explicit go-ahead in the moment before
running `send` or `delete` — do not send on standing/earlier approval.

The message body shape (reverse-engineered; the required field the obvious
guesses miss is `feed_id`, the stream id repeated in the body):

  POST /v5/messaging/streams/{stream_id}/comments
  { "type": 0, "content": "<text>", "photo_url": "", "photoUrl": "",
    "access_level": 0, "parent_feed_item_id": <reply-to id or null>,
    "feed_id": <stream_id> }
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import th_client as th  # noqa: E402
from library_cache import ExerciseCache, _coerce_int  # noqa: E402
from messaging_sync import list_streams, _upsert_stream, _upsert_comment  # noqa: E402


def _eprint(*a):
    print(*a, file=sys.stderr)


def build_payload(stream_id, text, reply_to=None):
    """The exact body the web app sends (captured from the chat client)."""
    return {
        "type": 0,
        "content": text,
        "photo_url": "",
        "photoUrl": "",
        "access_level": 0,
        "parent_feed_item_id": _coerce_int(reply_to) if reply_to is not None else None,
        "feed_id": _coerce_int(stream_id),
    }


def find_stream(stream_id):
    sid = _coerce_int(stream_id)
    for s, kind in list_streams():
        if _coerce_int(s.get("id")) == sid:
            return s, kind
    return None, None


def cmd_streams():
    rows = []
    for s, kind in list_streams():
        rows.append({"id": s.get("id"), "kind": kind, "title": s.get("title") or "",
                     "teamId": s.get("teamId"), "userId": s.get("userId")})
    print(json.dumps(rows, indent=2))


def cmd_read(stream_id, limit=20):
    sid = _coerce_int(stream_id)
    status, data = th.request("GET", f"/v5/messaging/streams/{sid}/comments?lastCommentId=")
    if not (200 <= status < 300) or not isinstance(data, list):
        _eprint(f"read failed (HTTP {status}): {data}")
        sys.exit(1)
    tail = data[-limit:] if limit else data
    print(json.dumps(tail, indent=2))


def cmd_draft(stream_id, text, reply_to=None):
    s, kind = find_stream(stream_id)
    if s is None:
        _eprint(f"WARNING: stream {stream_id} not found in /v5/messaging/streams; "
                "double-check the id with `message_send.py streams`.")
    payload = build_payload(stream_id, text, reply_to)
    target = f"{kind} stream {stream_id} — {s.get('title')!r}" if s else f"stream {stream_id}"
    print(json.dumps({
        "draft": True,
        "note": "NOT sent. This is a preview. Run the `send` subcommand to deliver it.",
        "target": target,
        "would_POST": f"/v5/messaging/streams/{stream_id}/comments",
        "payload": payload,
    }, indent=2))


def cmd_send(stream_id, text, reply_to=None):
    sid = _coerce_int(stream_id)
    payload = build_payload(stream_id, text, reply_to)
    status, data = th.request("POST", f"/v5/messaging/streams/{sid}/comments", payload)
    if not (200 <= status < 300) or not isinstance(data, dict) or not data.get("id"):
        _eprint(f"send failed (HTTP {status}): {data}")
        sys.exit(1)
    # Write-through so the local store reflects the sent message without a re-sync.
    try:
        cache = ExerciseCache()
        s, kind = find_stream(stream_id)
        if s is not None:
            _upsert_stream(cache.conn, s, kind)
        _upsert_comment(cache.conn, sid, data)
        cache.conn.commit()
    except Exception as e:  # write-through is best-effort; the send already succeeded
        _eprint(f"(sent; local write-through skipped: {e})")
    print(json.dumps({"sent": True, "comment": data}, indent=2))


def cmd_delete(stream_id, comment_id):
    sid, cid = _coerce_int(stream_id), _coerce_int(comment_id)
    _eprint(f"WARNING: deleting comment {cid} from stream {sid} on the LIVE account "
            "(soft delete). This acts on real data.")
    status, data = th.request("DELETE", f"/v5/messaging/streams/{sid}/comments/{cid}")
    if not (200 <= status < 300):
        _eprint(f"delete failed (HTTP {status}): {data}")
        sys.exit(1)
    print(json.dumps({"deleted": True, "response": data}, indent=2))


def _opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        if i + 1 < len(args):
            return args[i + 1]
    return default


def main():
    args = sys.argv[1:]
    if not args:
        _eprint(__doc__.strip().splitlines()[0])
        _eprint("commands: streams | read <id> | draft <id> \"text\" | send <id> \"text\" | delete <id> <commentId>")
        sys.exit(1)

    cmd = args[0]
    rest = args[1:]
    reply_to = _opt(rest, "--reply-to")
    positional = [a for i, a in enumerate(rest)
                  if not a.startswith("--") and rest[i - 1] not in ("--reply-to", "--limit")]

    if cmd == "streams":
        cmd_streams()
    elif cmd == "read":
        if not positional:
            _eprint("read requires a stream id"); sys.exit(1)
        cmd_read(positional[0], int(_opt(rest, "--limit", "20")))
    elif cmd == "draft":
        if len(positional) < 2:
            _eprint('draft requires a stream id and text'); sys.exit(1)
        cmd_draft(positional[0], positional[1], reply_to)
    elif cmd == "send":
        if len(positional) < 2:
            _eprint('send requires a stream id and text'); sys.exit(1)
        cmd_send(positional[0], positional[1], reply_to)
    elif cmd == "delete":
        if len(positional) < 2:
            _eprint("delete requires a stream id and a comment id"); sys.exit(1)
        cmd_delete(positional[0], positional[1])
    else:
        _eprint(f"Unknown command: {cmd}"); sys.exit(1)


if __name__ == "__main__":
    main()
