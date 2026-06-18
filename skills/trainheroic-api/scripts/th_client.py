#!/usr/bin/env python3
"""TrainHeroic API client.

A small stdlib-only helper that handles authentication and signed requests
against the TrainHeroic coach/athlete REST API.

Auth model
----------
Login is a form POST to https://apis.trainheroic.com/auth with email/password.
The response carries a `session_id` and an `api_token`:

  - Coach platform calls (api.trainheroic.com) authenticate with the
    `session-token: <session_id>` header. This is the default here.
  - A few apis.trainheroic.com endpoints authenticate with the
    `api-token: <api_token>` header instead. Use `--auth api-token` for those.

Credentials come from the TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD
environment variables. The session is cached at ~/.trainheroic/session.json
and reused until it expires, then a fresh login happens automatically.

Usage
-----
  th_client.py login                          # force a fresh login
  th_client.py whoami                         # GET /user/simple
  th_client.py get  /v5/athletes
  th_client.py post /v5/teams/4677619/teamCodes '{"type": 2}'
  th_client.py put  /v5/athletes/archive '{"athleteIds": [123]}'
  th_client.py delete /v5/teamCodes/874586
  th_client.py request GET /user/simple       # explicit form
  th_client.py logout                         # clear cached session

Reading a JSON body from stdin (handy for large workout payloads):
  cat block.json | th_client.py post /2.0/coach/calendar/saveProgramWorkoutSets -

Flags:
  --auth {session,api-token}   header style (default: session)
  --base URL                   override base URL
  --raw                        print response body without pretty-printing
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

AUTH_URL = "https://apis.trainheroic.com/auth"
COACH_BASE = "https://api.trainheroic.com"
APIS_BASE = "https://apis.trainheroic.com"
SESSION_CACHE = Path.home() / ".trainheroic" / "session.json"
# Re-login this many seconds before the token's stated TTL elapses.
EXPIRY_SKEW = 120


def _eprint(*args):
    print(*args, file=sys.stderr)


def _http(method, url, headers=None, data=None):
    """Perform an HTTP request and return (status, parsed_body_or_text)."""
    req = urllib.request.Request(url, method=method, data=data)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        status = e.code
    except urllib.error.URLError as e:
        _eprint(f"Network error reaching {url}: {e.reason}")
        sys.exit(2)
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, body


def login():
    """Authenticate with email/password and cache the session."""
    email = os.environ.get("TRAINHEROIC_EMAIL")
    password = os.environ.get("TRAINHEROIC_PASSWORD")
    if not email or not password:
        _eprint(
            "Missing credentials. Set TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD "
            "in the environment."
        )
        sys.exit(1)

    form = urllib.parse.urlencode({"email": email, "password": password}).encode()
    status, body = _http(
        "POST",
        AUTH_URL,
        headers={"content-type": "application/x-www-form-urlencoded"},
        data=form,
    )
    if status != 200 or not isinstance(body, dict) or "session_id" not in body:
        _eprint(f"Login failed (HTTP {status}): {body}")
        sys.exit(1)

    ttl = float(body.get("api_ttl") or 3600)
    session = {
        "session_id": body.get("session_id"),
        "api_token": body.get("api_token"),
        "refresh_token": body.get("refresh_token"),
        "user_id": body.get("id"),
        "scope": body.get("scope"),
        "role": body.get("role"),
        "expires_at": time.time() + ttl,
    }
    SESSION_CACHE.parent.mkdir(parents=True, exist_ok=True)
    SESSION_CACHE.write_text(json.dumps(session, indent=2))
    try:
        SESSION_CACHE.chmod(0o600)
    except OSError:
        pass
    return session


def get_session(force=False):
    """Return a valid cached session, logging in when needed."""
    if not force and SESSION_CACHE.exists():
        try:
            session = json.loads(SESSION_CACHE.read_text())
            if session.get("session_id") and session.get("expires_at", 0) - EXPIRY_SKEW > time.time():
                return session
        except (json.JSONDecodeError, OSError):
            pass
    return login()


def request(method, path, body=None, auth="session", base=None):
    """Make an authenticated API request and return (status, parsed_body)."""
    session = get_session()
    if base is None:
        base = APIS_BASE if auth == "api-token" else COACH_BASE
    url = base.rstrip("/") + "/" + path.lstrip("/")

    headers = {"content-type": "application/json", "accept": "application/json"}
    if auth == "api-token":
        headers["api-token"] = session.get("api_token", "")
    else:
        headers["session-token"] = session.get("session_id", "")

    data = None
    if body is not None and method.upper() not in ("GET", "DELETE"):
        data = json.dumps(body).encode()

    status, parsed = _http(method.upper(), url, headers=headers, data=data)

    # One automatic retry on auth failure with a fresh login.
    if status in (401, 403):
        session = login()
        if auth == "api-token":
            headers["api-token"] = session.get("api_token", "")
        else:
            headers["session-token"] = session.get("session_id", "")
        status, parsed = _http(method.upper(), url, headers=headers, data=data)

    return status, parsed


def _parse_body(arg):
    """Parse a JSON body argument. '-' reads from stdin."""
    if arg is None:
        return None
    if arg == "-":
        arg = sys.stdin.read()
    if not arg.strip():
        return None
    try:
        return json.loads(arg)
    except json.JSONDecodeError as e:
        _eprint(f"Invalid JSON body: {e}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(add_help=True, description="TrainHeroic API client")
    parser.add_argument("command", help="request | get | post | put | delete | login | logout | whoami")
    parser.add_argument("rest", nargs="*", help="method/path/body depending on command")
    parser.add_argument("--auth", choices=["session", "api-token"], default="session")
    parser.add_argument("--base", default=None)
    parser.add_argument("--raw", action="store_true", help="print raw response body")
    args = parser.parse_args()

    cmd = args.command.lower()

    if cmd == "login":
        session = login()
        print(json.dumps({k: v for k, v in session.items() if k != "expires_at"}, indent=2))
        return
    if cmd == "logout":
        if SESSION_CACHE.exists():
            SESSION_CACHE.unlink()
        print("Session cleared.")
        return

    if cmd == "whoami":
        method, path, body = "GET", "/user/simple", None
    elif cmd in ("get", "post", "put", "delete", "patch"):
        if not args.rest:
            _eprint(f"{cmd} requires a path")
            sys.exit(1)
        method = cmd.upper()
        path = args.rest[0]
        body = _parse_body(args.rest[1] if len(args.rest) > 1 else None)
    elif cmd == "request":
        if len(args.rest) < 2:
            _eprint("request requires METHOD and PATH")
            sys.exit(1)
        method = args.rest[0].upper()
        path = args.rest[1]
        body = _parse_body(args.rest[2] if len(args.rest) > 2 else None)
    else:
        _eprint(f"Unknown command: {cmd}")
        sys.exit(1)

    status, parsed = request(method, path, body, auth=args.auth, base=args.base)

    if args.raw or isinstance(parsed, str):
        print(parsed if isinstance(parsed, str) else json.dumps(parsed))
    else:
        print(json.dumps(parsed, indent=2))

    # Non-2xx exits non-zero so callers can detect failure.
    sys.exit(0 if 200 <= status < 300 else 1)


if __name__ == "__main__":
    main()
