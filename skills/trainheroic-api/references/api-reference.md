# TrainHeroic Coach API Documentation

Base URL: `https://api.trainheroic.com`

## Authentication

**Login:** `POST https://apis.trainheroic.com/auth` (form post with email/password)

Returns:
```json
{
  "id": 100001,
  "api_token": "...",
  "refresh_token": "...",
  "api_ttl": 7712.75,
  "scope": "athlete",
  "role": "athlete",
  "session_id": "..."
}
```

**Coach session:** The coach platform stores `session_id` in localStorage (`persist:trainheroic`) and uses it as the `session-token` header for all API calls.

**Athlete API token:** The `apis.trainheroic.com` login also returns an `api_token` which is used with the `api-token` header (used by `apis.trainheroic.com/user` endpoint).

**Headers:**
- `session-token: <session_id>` — used by coach platform (library, builder, coachapp)
- `api-token: <api_token>` — used by `apis.trainheroic.com` web app
- `content-type: application/json`

---

## Coach Platform Subdomains

| Subdomain | Purpose |
|-----------|---------|
| `apis.trainheroic.com` | Login portal, athlete web dashboard |
| `coach.trainheroic.com` | Athletes/Teams admin (AngularJS) |
| `library.trainheroic.com` | Exercise/Session/Program library (React/MUI) |
| `builder.trainheroic.com` | Session template builder |
| `coachapp.trainheroic.com` | Program builder (calendar view) |
| `teams.trainheroic.com` | Team management |

---

## Endpoints

### User / Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/user/simple` | Current user profile (simplified) |
| GET | `/v5/users` | Current user info |
| GET | `/v5/users/{id}` | User by ID |
| GET | `/v5/users/{id}/features` | Feature flags for user |
| GET | `/v5/headCoach` | Head coach info (org, license, trial status) |
| GET | `/v5/coaches/orgs` | Coach organizations |
| GET | `/v5/userAgreementTerms/hasAgreed` | TOS agreement status |
| GET | `/avatars/user/{id}` | User avatar (302 redirect to static image) |

#### `GET /user/simple` Response
```json
{
  "id": 2771594,
  "profileImg": "https://static.trainheroic.com/avatar-2025/J/avatar-JI.png",
  "coverImg": "https://static.trainheroic.com/images/defaults/5.png",
  "firstName": "jamon",
  "lastName": "iberico",
  "username": "neat.nest6259@fastmail.com",
  "email": "neat.nest6259@fastmail.com",
  "is_active": true,
  "days_from_login": 0,
  "roles": ["COACH", "TRIAL"],
  "hasRole": { "COACH": 1, "TRIAL": 1 },
  "org_id": 602402,
  "mpEnabled": null,
  "use_metric": false,
  "fdhqUser": false,
  "trial_days_remaining": 14
}
```

#### `GET /v5/headCoach` Response
```json
{
  "id": 2771594,
  "nameFirst": "jamon",
  "nameLast": "iberico",
  "profileImage": "...",
  "orgId": 602402,
  "orgName": "Jamon Fit",
  "coachLicenseId": 10,
  "nextBillingDate": "2026-03-24",
  "isTrial": true,
  "isMarketplaceEnabled": false,
  "isExpiredTrial": false,
  "daysLeftInTrial": 14,
  "isFirstMobileLogin": true
}
```

---

### Athletes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v5/athletes` | List all athletes |
| POST | `/v5/emails/validate` | **Validate email addresses** |
| POST | `/v5/athletes/inviteToTeam` | **Invite athletes to team** |
| PUT | `/v5/athletes/archive` | **Archive athletes** |
| PUT | `/v5/athletes/{athleteId}/archive` | **Archive single athlete** |
| PUT | `/v5/athletes/restore` | **Restore (unarchive) athletes** |

#### `GET /v5/athletes` Response
```json
[
  {
    "id": 2771594,
    "fullName": "iberico, jamon",
    "firstName": "jamon",
    "lastName": "iberico",
    "email": "neat.nest6259@fastmail.com",
    "useMetric": 0,
    "teamCount": 0,
    "daysSinceLastLogin": 0,
    "groups": [],
    "groupTitles": [],
    "userTags": [],
    "imageProfile": "...",
    "canUserBeRemovedFromTeam": false,
    "athleteType": ""
  }
]
```

#### `POST /v5/emails/validate`

Validates email addresses before sending invites.

**Request body:**
```json
{ "emails": "user@example.com" }
```

**Response:** `["user@example.com"]` (array of valid emails)

#### `POST /v5/athletes/inviteToTeam`

Sends team invites to athletes via email.

**Request body:**
```json
{
  "teamType": 0,
  "teamId": 4677619,
  "orgId": null,
  "emails": ["user@example.com"],
  "message": "Follow these steps and you'll be set up and ready to go!"
}
```

**Response:**
```json
{
  "sent": ["user@example.com"],
  "notSent": []
}
```

The invite dialog also supports:
- **1:1 invites** (direct coach-athlete pairing)
- **CSV upload** for bulk invitations

#### `PUT /v5/athletes/archive`

Archives athletes (removes from active roster but preserves data).

**Request body:**
```json
{ "athleteIds": [2771596] }
```

#### `PUT /v5/athletes/restore`

Restores previously archived athletes.

**Request body:**
```json
{ "athleteIds": [2771596] }
```

---

### Teams

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/1.0/coach/teams` | List coach teams |
| GET | `/1.0/coach/teams?page={n}&pageSize={n}&q={search}` | Paginated/searchable teams |
| POST | `/1.0/coach/team/createWithTitleAndCode` | **Create team** |
| GET | `/1.0/coach/team/allLicenseSubscribedTeams/{groupId}` | Teams subscribed to a program |
| GET | `/1.0/coach/programs/taggedByTeam/{groupId}?type=1` | Programs tagged to a team |
| GET | `/v5/teams/{teamId}` | Team details (full object) |
| GET | `/v5/teams/{teamId}/teamCodes` | **List team access codes** |
| POST | `/v5/teams/{teamId}/teamCodes` | **Create access code** |
| DELETE | `/v5/teamCodes/{codeId}` | **Delete access code** |

#### `POST /1.0/coach/team/createWithTitleAndCode`

Creates a new team. Automatically creates a team calendar (program).

**Request body:**
```json
{ "title": "Test Team" }
```

**Side effects:** Creating a team triggers loading of:
- `/3.0/coach/program/{newCalendarId}` — the auto-created team calendar
- `/1.0/coach/programs/edit/{calendarId}/{year}/{month}/{day}` — calendar edit view
- `/2.0/coach/calendar/summary/{calendarId}/{year}/{month}/{day}` — calendar summary

#### `GET /v5/teams/{teamId}/teamCodes` Response
```json
[
  {
    "id": 874576,
    "code": "17731133064959",
    "created_by": 2771594,
    "date_created": "2026-03-10T03:28:26Z",
    "date_modified": "2026-03-10T03:28:26Z",
    "description": "",
    "end_date": "2099-01-01T00:00:00Z",
    "max_use_count": null,
    "name": "",
    "start_date": "2026-03-10T03:28:26Z",
    "status": 1,
    "team_id": 4677619,
    "type": 2,
    "use_count": 0
  }
]
```

#### `POST /v5/teams/{teamId}/teamCodes`

Creates a new access code for athletes to join the team.

**Request body:**
```json
{ "type": 2 }
```

**Response:**
```json
{
  "type": 2,
  "team_id": 4677619,
  "code": 1773116732,
  "id": 874586,
  "created_by": 2771594
}
```

#### `DELETE /v5/teamCodes/{codeId}`

Deletes an access code. No request body needed.

---

### Programs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v5/programs` | List programs |
| GET | `/v5/programs/new` | New programs |
| GET | `/v5/programs/free` | Free programs |
| GET | `/v5/programs/fixed` | Fixed programs |
| GET | `/1.0/coach/programs` | Coach programs list |
| GET | `/1.0/coach/programs/edit/{id}` | Program edit data |
| GET | `/3.0/coach/program/{id}` | Program detail (full structure) |
| GET | `/1.0/coach/subscriptions` | Program subscriptions |

#### `GET /3.0/coach/program/{id}` Response
```json
{
  "id": 4713234,
  "user_id": 2771594,
  "published": 0,
  "description": "",
  "type": 2,
  "length": 28,
  "days": 0,
  "title": "Test Program",
  "group_id": 4677607,
  "logo": "...",
  "org_id": 602402
}
```

#### `GET /1.0/coach/programs` Response
```json
[
  {
    "id": 4677607,
    "order": 0,
    "owner_user_id": 2771594,
    "featured": 0,
    "title": "Test Program",
    "date_created": 1773112569,
    "description": "",
    "slug": "iberico-program-1773112569",
    "status": 0,
    "group_program": 4713234,
    "org_id": 602402,
    "logo": "..."
  }
]
```

---

### Exercises

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/1.0/coach/exercises?page={n}&pageSize={n}` | Coach exercises (paginated) |
| GET | `/v5/exerciseLibrary/all` | Full exercise library (all available exercises) |
| POST | `/2.0/coach/exercise/create` | **Create exercise** |
| POST | `/2.0/coach/exercise/update/{exerciseId}` | **Update exercise** |
| DELETE | `/v5/exercises/{exerciseId}` | **Delete exercise** |

#### `POST /2.0/coach/exercise/create`

Creates a new custom exercise. See [Custom Exercise Creation](#custom-exercise-creation) section for full details and examples.

**Tags endpoint used during creation:** `GET /2.0/coach/tags/getByType/3` (exercise tags)

#### `POST /2.0/coach/exercise/update/{exerciseId}`

Updates a custom exercise. Takes the same fields as create. Response wraps the updated exercise in `{"success":1,"data":{...}}`.

#### `DELETE /v5/exercises/{exerciseId}`

Deletes a custom exercise. No request body needed. Only works on exercises where `can_edit: 1`.

---

### Sessions / Workouts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/1.0/coach/workouts?page={n}&pageSize={n}` | Session templates list |
| GET | `/2.0/coach/workoutSetExercise/template` | Prescription templates (sets/reps schemes) |
| POST | `/v5/sessions/template` | **Create session template** (library) |
| DELETE | `/v5/sessions/template/{sessionId}` | **Delete session template** |
| POST | `/2.0/coach/calendar/workout/createWorkoutForTimelineDay/{programId}/{day}/null` | **Create session in program** (timeline) |
| POST | `/2.0/coach/calendar/workout/createWorkoutForDay/{calendarId}/{year}/{month}/{day}/0` | **Create session on team calendar date** |
| POST | `/2.0/coach/calendar/saveProgramWorkoutSets` | **Add block to session** |
| POST | `/2.0/coach/calendar/saveWorkoutSetExercises` | **Add exercise to block** (with prescription) |
| POST | `/2.0/coach/calendar/programWorkout/publish` | **Publish session** |
| GET | `/2.0/coach/calendar/summary/{calendarId}/{year}/{month}/{day}` | Calendar summary for date |
| GET | `/1.0/coach/programs/edit/{calendarId}/{year}/{month}/{day}` | Calendar edit view for date |

---

### Workout Creation Flow (Full Sequence)

The complete flow for creating a workout on a team calendar:

#### Step 1: Create Team (if needed)
```
POST /1.0/coach/team/createWithTitleAndCode
Body: { "title": "My Team" }
→ Returns team with calendar ID (e.g. 4713246)
```

#### Step 2: Create Session on Calendar Date
```
POST /2.0/coach/calendar/workout/createWorkoutForDay/{calendarId}/{year}/{month}/{day}/0
→ Creates empty session, returns workout data including workout_id
```

For program timelines (not date-based):
```
POST /2.0/coach/calendar/workout/createWorkoutForTimelineDay/{programId}/{day}/null
```

#### Step 3: Add Block to Session
```
POST /2.0/coach/calendar/saveProgramWorkoutSets
Body:
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

Block types (observed `type` field):
- `1` = Conditioning
- `2` = Hypertrophy
- `4` = Strength/Power (default)

The `title` field can be set to any custom string. The `instruction` field provides block-level coach notes.

#### Step 4: Add Exercise(s) to Block (with prescription)
```
POST /2.0/coach/calendar/saveWorkoutSetExercises
Body: [exercise1, exercise2, ...]   // array of exercises
```

> **Important:** This endpoint requires additional fields beyond the obvious ones (`set_num`, `key`, `setKey`, `eType`, all 10 param slots, etc.) or it returns 500. See [Required Fields for saveWorkoutSetExercises](#required-fields-for-saveworkoutsetexercises) for the complete field list.

**Single exercise:**
```json
[{
  "exercise_id": 1,
  "workout_set_id": 671133862,
  "set_id": 671133862,
  "title": "Back Squat",
  "instruction": "",
  "order": 1,
  "param_1_type": 3,
  "param_2_type": 1,
  "param_1_data_1": "5", "param_1_data_2": "5", "param_1_data_3": "5",
  "param_1_data_4": "", "param_1_data_5": "", "param_1_data_6": "", "param_1_data_7": "", "param_1_data_8": "", "param_1_data_9": "", "param_1_data_10": "",
  "param_2_data_1": "225", "param_2_data_2": "245", "param_2_data_3": "265",
  "param_2_data_4": "", "param_2_data_5": "", "param_2_data_6": "", "param_2_data_7": "", "param_2_data_8": "", "param_2_data_9": "", "param_2_data_10": "",
  "workout_set_exercise_template_id": null,
  "no_sets": 0,
  "param_count": 3,
  "set_num": 3,
  "key": "k::1001",
  "setKey": 671133862,
  "video_url": "",
  "thumbnail_url": "",
  "tags": [],
  "eType": "e",
  "use_count": 0
}]
```

**Superset (multiple exercises in same block):**
Send multiple exercises in the same array, all with the same `workout_set_id`/`set_id` but different `order` values:
```json
[
  { "exercise_id": 1, "workout_set_id": 671133862, "order": 1, "title": "Back Squat", ... },
  { "exercise_id": 3, "workout_set_id": 671133862, "order": 2, "title": "Front Squat", ... }
]
```
This creates A1: Back Squat, A2: Front Squat displayed as a superset.

**Drop set pattern (decreasing weight, increasing reps):**
```json
{
  "exercise_id": 1162,
  "title": "Bench Press",
  "instruction": "Drop set - no rest between sets",
  "param_1_type": 3, "param_2_type": 1,
  "param_1_data_1": "6",   "param_2_data_1": "185",
  "param_1_data_2": "8",   "param_2_data_2": "165",
  "param_1_data_3": "10",  "param_2_data_3": "145",
  "param_1_data_4": "12",  "param_2_data_4": "125",
  "param_1_data_5": "15",  "param_2_data_5": "95",
  "param_count": 5
}
```

**Parameter types (param_1_type / param_2_type):**
| Value | Type | Display |
|-------|------|---------|
| 0 | None | (no parameter) |
| 1 | Weight | `225 lb` |
| 2 | Weight (% of max) | `75%` |
| 3 | Reps | `5` |
| 4 | Time (seconds) | `1:00` |
| 5 | Distance (yards) | `50yd` |
| 6 | Distance (meters) | `50m` |
| 7 | Height | `inches` |
| 10 | Distance (miles) | miles |
| 11 | Distance (feet) | feet |
| 12 | Height (inches) | inches |
| 13 | Heart Rate | bpm |
| 14 | RPE | rating |
| 18 | Time (seconds, alt) | `0:30` |

> **The unit is fixed per exercise — you cannot set it at prescribe time (verified).**
> On save the API discards the `param_1_type`/`param_2_type` you send and restores
> the exercise's library defaults. The `param_*_data_N` *values* are kept, so a
> value sent under the wrong assumed unit renders under the exercise's real unit.
> - **`param_1_type` (primary) is always forced to the exercise default.** e.g. stock
>   `Run` (id 82) is `10` (miles); sending `6` (meters) is ignored and `200` shows as
>   *200 miles*. To program meters, pick a meters-native exercise (`Sprint` 127,
>   `Rowing` 101, `Shuttle Sprint` 42523) or a custom exercise — there is no metric
>   "Run". `library_cache.py resolve` now prints `param_1_unit`/`param_2_unit`; check it.
> - **`param_2_type` (secondary) is forced to the default too, with one exception:**
>   if the exercise has no secondary param (default `0`/none) you may add weight
>   (`1`) — this is how weighted Pull-Ups/Dips work. You cannot swap an exercise's
>   existing secondary unit, and **`2` (% of max) and `14` (RPE) never stick on a
>   weight-default lift — both coerce to weight, so the numbers render as pounds.**
>   Put % or RPE in the `instruction` text instead.
> - `build_workout.py` reads the local exercise cache and prints a `WARNING` when a
>   sent param type will be overridden.

**Common param type combos (from 2067 exercises):**
- `p1=3, p2=None` — Reps only (801 exercises, e.g. Plyo Lunge, Lateral Lunge)
- `p1=3, p2=1` — Reps @ Weight (619 exercises, e.g. Back Squat, Bench Press, Deadlift)
- `p1=3, p2=0` — Reps only (170 exercises, e.g. Push-Up, Pull-Up, Burpee, Air Squat)
- `p1=5, p2=None` — Distance/yards only (133 exercises, e.g. Sled Push, Bear Crawl)
- `p1=4, p2=None` — Time only (91 exercises, e.g. Jog)
- `p1=3, p2=4` — Reps @ Time (51 exercises, e.g. L Drill)
- `p1=4, p2=0` — Time only (37 exercises, e.g. Plank, Rest)
- `p1=5, p2=1` — Distance @ Weight (11 exercises, e.g. Sled Drags)
- `p1=10, p2=4` — Miles @ Time (3 exercises, e.g. Run, Walk)

**Fields:**
- `param_1_data_N` = Value for param 1 in set N (1-10 max)
- `param_2_data_N` = Value for param 2 in set N (1-10 max)
- `param_count` = Number of sets
- `no_sets` = 0 (normal), non-zero may indicate special handling
- `instruction` = Per-exercise coach notes

**Note:** The API ignores the `title` field and uses the exercise's real title from `exercise_id`. It also overrides **both** `param_1_type` and `param_2_type` to the exercise's library defaults (see the fixed-unit note above) — the data values you send are kept, but the unit is the exercise's, not the one you requested.

#### Step 5: Publish Session
```
POST /2.0/coach/calendar/programWorkout/publish
Body: [142002657]   // array of programWorkout IDs
```

---

#### `POST /v5/sessions/template`

Creates a reusable session template in the library.

**Request body:**
- `title` (required)
- `instructions` (optional)
- Blocks with exercises can be added

#### `GET /2.0/coach/workoutSetExercise/template` Response (prescription templates)
```json
[
  {
    "id": 99,
    "title": "4 x 3",
    "type": 1,
    "param_1_type": 3,
    "param_2_type": 0,
    "param_1_data_1": "3",
    "param_1_data_2": "3",
    "param_1_data_3": "3",
    "param_1_data_4": "3",
    "param_count": 4,
    "tags": [
      { "id": 251, "title": "Strength", "type": 4 }
    ],
    "editable": false,
    "use_count": 0
  }
]
```

---

### Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/2.0/coach/tags/getByType/3` | Exercise tags |
| GET | `/2.0/coach/tags/getByType/4` | Training effect tags |
| GET | `/2.0/coach/tags/getSportsTags` | Sports tags |

**Tag types:**
- Type 3: Exercise category (Olympic Lifts, Primary Lifts, Accessory Lifts, Gymnastics, etc.)
- Type 4: Training effect (Strength, Hypertrophy, Power, Conditioning, etc.)

#### `GET /2.0/coach/tags/getByType/{type}` Response
```json
{
  "success": 1,
  "data": {
    "tagType": { "id": "3", "title": "Exercise" },
    "tags": [
      { "id": 211, "title": "Olympic Lifts", "type": 3, "use_count": 28056 },
      { "id": 212, "title": "Primary Lifts", "type": 3, "use_count": 33280 },
      { "id": 213, "title": "Accessory Lifts", "type": 3, "use_count": 171716 }
    ]
  }
}
```

---

### Favorites / Preferences

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/2.0/coach/favorite?pageSize={n}` | Favorited items |
| GET | `/2.0/coach/prefs` | Coach preferences |

#### `GET /2.0/coach/prefs` Response
```json
{
  "id": 2800633,
  "email_workout_preview": 1,
  "email_new_posts": 0,
  "email_coach_posts": 1,
  "mobile_workout_preview": 1,
  "auto_update_wm": 0,
  "show_exercises_trainheroic": 1,
  "show_programs_trainheroic": 1,
  "show_calendars_trainheroic": 1,
  "show_workout_set_exercise_templates_trainheroic": 1,
  "survey_team_enabled": 1,
  "survey_one_to_one_enabled": 1
}
```

---

### Messaging

Chat between a coach and athletes/teams. A **stream** is a conversation; a
**comment** is a message in it. Verified against a live
account (see `messaging_sync.py` / `message_send.py`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v5/messaging/streams` | List conversations (bucketed) |
| GET | `/v5/messaging/streams/{streamId}/comments?lastCommentId={id}` | Messages in a stream; `lastCommentId` returns only comments newer than that id |
| POST | `/v5/messaging/streams/{streamId}/comments` | **Send a message** (athlete-facing, immediate) |
| DELETE | `/v5/messaging/streams/{streamId}/comments/{commentId}` | **Delete a message** (soft delete) |
| GET | `/v5/messaging/reactions` | Reaction catalog (Like/Love/Fire/Trophy/…) |
| GET | `/v5/notifications/counts` | Unread message counts (cheap "anything new?" poll) |

#### `GET /v5/messaging/streams` Response

Conversations grouped into four buckets. Each entry's `id` is the **stream id**
(distinct from `teamId`/`userId`) used by every other messaging call.
```json
{
  "teams":    [ { "id": 37731134, "teamId": 4945224, "title": "Test Team", "isOwner": true, "logo": "...", "lastViewed": 1781808863 } ],
  "athletes": [ { "id": 37730920, "userId": 2855688, "teamId": 4945209, "title": "[Demo] Kyle Jones", "metadata": { "nameFirst": "...", "nameLast": "..." }, "logo": "..." } ],
  "programs": [],
  "coaches":  []
}
```

#### `GET /v5/messaging/streams/{streamId}/comments?lastCommentId={id}` Response

Array of comments, oldest→newest. Pass the highest `id` you've stored as
`lastCommentId` to fetch only newer ones (verified: returns `[]` when none are
newer). A blank `lastCommentId=` returns the whole stream.
```json
[
  {
    "id": 125652586,
    "timestamp": 1781809398,
    "content": "Nice work today!",
    "imageUrl": null,
    "thumbnailUrl": null,
    "authorName": "T Athlete",
    "authorLogo": "https://static.trainheroic.com/avatar-2025/X/avatar-XX.png",
    "replies": [],
    "reactions": [],
    "isAuthor": true
  }
]
```
- `isAuthor: false` is a message you **received**; `true` is one you sent.
- `id` doubles as the incremental cursor (`lastCommentId`).
- `replies[]` holds threaded replies as nested comment objects; `reactions[]`
  holds reactions on the comment (decode via `/v5/messaging/reactions`).

#### `POST /v5/messaging/streams/{streamId}/comments` (send)

Returns the created comment (same shape as above). **The required field the
obvious guesses miss is `feed_id`** — the stream id repeated in the body.
`{ "content": "..." }` alone returns `400 Invalid parameters`; the full body the
web client sends is:
```json
{
  "type": 0,
  "content": "Nice work today!",
  "photo_url": "",
  "photoUrl": "",
  "access_level": 0,
  "parent_feed_item_id": null,
  "feed_id": 37730920
}
```
- `feed_id` = the `{streamId}` from the path (required).
- `parent_feed_item_id` = a comment id to post a threaded reply; `null` for a
  top-level message.
- Trimming any of the other fields also returns `400 Invalid parameters` —
  send the whole body.
- There is **no server-side draft state**: a POST is delivered immediately.

#### `DELETE /v5/messaging/streams/{streamId}/comments/{commentId}`

Soft delete (sets `deleted_at`). No body. Returns the underlying row, which
reveals a comment can attach to more than chat:
```json
{
  "id": 125652586, "created_by": 200003, "type": 0, "access_level": 0,
  "content": "...", "photo_url": "", "deleted_at": "2026-06-18T19:05:35.000000Z",
  "parent_feed_item_id": null, "program_workout_id": null,
  "saved_workout_set_id": null, "group_id": null, "saved_workout_id": null
}
```

#### `GET /v5/notifications/counts` Response

The cheap gate before fanning out across streams:
```json
{
  "countNotViewed": 0,
  "countNotificationNotViewed": 0,
  "countMessagingNotViewed": 0,
  "messaging": { "countDirectNotViewed": 0, "countTeamNotViewed": 0 }
}
```

#### Real-time channel (not needed for a sync)

The web client receives live messages over a separate long-poll channel —
`adapter.trainheroic.com/messaging?timestamp={ms}` (global) and
`adapter.trainheroic.com/messaging/team/{teamId}?timestamp={ms}` (per team),
loaded as a cross-origin iframe stream. A coach-side **sync does not need it**:
polling the REST `comments` endpoint with `lastCommentId` captures the same
messages. The entire chat UI is served from `adapter.trainheroic.com` and embedded
in `coachapp.trainheroic.com/messaging` as the `messagingHub` iframe.

---

### Coach Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/2.0/coach/admin/coachAthletes/{coachId}` | Athletes managed by coach |
| GET | `/user/mobile` | User mobile info |

---

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v5/analytics` | Analytics categories (lists all available analytics types) |
| POST | `/v5/analytics/readiness/teams` | **Readiness survey — team** |
| POST | `/v5/analytics/readiness/users` | **Readiness survey — single athlete** |
| POST | `/v5/analytics/lift-one-rep-max-history/users` | **1RM history — single athlete** |
| POST | `/v5/analytics/training-summary/users` | **Training summary — single athlete** |
| POST | `/v5/analytics/training-summary/teams` | **Training summary — team** |
| POST | `/v5/analytics/compliance` | **Compliance data** |
| POST | `/v5/analytics/lift-progress/teams` | **Lift progress — team** |
| POST | `/v5/analytics/working-max-history/users` | **Working max history** |

#### `GET /v5/analytics` Response

Returns all available analytics categories and their instances:
```json
{
  "categories": [
    { "key": "readiness", "title": "Readiness", "instances": ["readiness-survey-athlete", "readiness-survey-team"] },
    { "key": "performance", "title": "Performance", "instances": ["lift-one-rep-max-history", "lift-one-rep-max-team-history"] },
    { "key": "liftHistory", "title": "Lift History", "instances": ["lift-history-complete", "working-max-history"] },
    { "key": "trainingSummary", "title": "Training Summary", "instances": ["training-summary"] },
    { "key": "compliance", "title": "Compliance", "instances": ["compliance-team"] },
    { "key": "liftProgress", "title": "Lift Progress", "instances": ["lift-progress-team"] }
  ]
}
```

#### `POST /v5/analytics/readiness/teams`

**Request body:**
```json
{ "teamId": 4677619, "date": "2026-03-09" }
```

**Response:** Returns columns (user_id, name_last, name_first, date_completed, sleep, mood, energy, stress, soreness, readiness) and rows of athlete readiness data.

#### `POST /v5/analytics/lift-one-rep-max-history/users`

**Request body:**
```json
{
  "date_start": "2026-02-07",
  "date_end": "2026-03-09",
  "user_ids": ["2771596"],
  "exercise_id": "424",
  "use_metric": false
}
```

**Response:** Returns columns (exercise_title, user_id, name, date, estimated_1rm, etc.) and rows of 1RM history data.

---

### Notifications / Misc

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v5/notifications` | Notifications list |
| GET | `/v5/notifications/counts` | Notification counts |
| GET | `/v5/site-banners` | Site banners |
| POST | `/v5/telemetry/track` | Telemetry/tracking events |

---

## Athlete API Endpoints (Mobile App)

These are used by the mobile app / athlete-facing client (documented in `train-heroic-schema.yml`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth` | Login |
| GET | `/v5/users/exercises/history` | All exercise history |
| GET | `/v5/users/exercises/recent` | Recent exercises |
| GET | `/v5/exercises/{id}/history` | Single exercise history |
| GET | `/v5/exercises/{id}` | Exercise details |
| GET | `/v5/exercises/{id}/personalRecords` | Exercise PRs |
| GET | `/v5/exercises/{id}/stats` | Exercise stats |
| GET | `/v5/exercises/{id}/stackUp/isSupportedExercise` | Stack-up support check |
| GET | `/v5/users/circuits/recent` | Recent circuits |
| GET | `/v5/users/circuits/history` | Circuit history |
| GET | `/3.0/athlete/programworkout/range?startDate=&endDate=` | Workouts by date range |
| GET | `/1.0/athlete/programming/programs` | Athlete programs |
| GET | `/v5/users/{id}` | User profile |
| GET | `/1.0/athlete/prefs` | Athlete preferences |
| GET | `/2.0/athlete/workingMax` | Working maxes (all exercises with WM tracking) |
| GET | `/1.0/athlete/savedworkoutset/{id}` | Saved workout set |
| GET | `/1.0/athlete/savedworkout/{id}` | Saved workout |
| GET | `/1.0/user/userInfo` | User info |
| GET | `/v5/calendars/athletes/{id}/coachAthleteTeam` | Coach-athlete team calendar |
| GET | `/v5/users/{id}/workingMaxes/{id1}` | Specific working max |
| GET | `/v5/programs/new` | New programs |
| GET | `/v5/programs/free` | Free programs |
| GET | `/v5/athleteProfile/summary` | Athlete profile summary |
| GET | `/3.0/athlete/leaderboard/{id}` | Leaderboard |

---

## Key Exercise IDs (from exercise library)

| ID | Title | param_1_type | param_2_type |
|----|-------|-------------|-------------|
| 1 | Back Squat | 3 (Reps) | 1 (Weight) |
| 3 | Front Squat | 3 | 1 |
| 7 | Pull-Up | 3 | 0 |
| 24 | Burpee | 3 | 0 |
| 36 | Air Squat | 3 | 0 |
| 67 | Plank | 4 (Time) | 0 |
| 100 | Push-Up | 3 | 0 |
| 424 | Deadlift | 3 | 1 |
| 1162 | Bench Press | 3 | 1 |

Full exercise library: `GET /v5/exerciseLibrary/all` (~2387 entries: 2067 exercises + 320 workout circuits)

---

## Custom Exercise Creation

`POST /2.0/coach/exercise/create`

Create exercises not in the standard library. You control the title and parameter types.

**Request body:**
```json
{
  "title": "Goblet Cossack Squat",
  "param_1_type": 3,
  "param_2_type": 1,
  "instruction": "",
  "video_url": "",
  "points_of_performance": "Deep lateral squat holding KB at chest",
  "is_circuit": false,
  "type": 0,
  "tags": [],
  "swaps": [],
  "reference_max_exercise_id": null,
  "trainheroic_reference_exercise_id": null
}
```

**Response:**
```json
{
  "id": 7721170,
  "user_id": 2771594,
  "title": "Goblet Cossack Squat",
  "param_1_type": 3,
  "param_2_type": 1,
  "can_edit": 1,
  "use_count": 0
}
```

Custom exercises can use any param type combo (see parameter types table). Examples:
- `p1=5, p2=0` → Distance only (e.g. "Walking Lunge for Distance" → shows as "3 x 50yd")
- `p1=5, p2=1` → Distance @ Weight (e.g. "Weighted Walking Lunge for Distance" → "2 x 40yd @ 50lb")
- `p1=3, p2=0` → Reps only / bodyweight (e.g. Push-Up → "3 x 15")
- `p1=3, p2=1` → Reps @ Weight (e.g. "Goblet Cossack Squat" → "3 x 8 @ 35lb")

---

## Advanced Prescription Patterns

### Pyramid Sets

Use varying values across `param_1_data_N` and `param_2_data_N` to create pyramids (ascending then descending):

```json
{
  "exercise_id": 1,
  "title": "Back Squat",
  "instruction": "Pyramid: work up to heavy single then back down",
  "param_1_type": 3, "param_2_type": 1,
  "param_1_data_1": "5",   "param_2_data_1": "185",
  "param_1_data_2": "3",   "param_2_data_2": "225",
  "param_1_data_3": "1",   "param_2_data_3": "275",
  "param_1_data_4": "3",   "param_2_data_4": "225",
  "param_1_data_5": "5",   "param_2_data_5": "185",
  "param_count": 5
}
```
Displays as: `5, 3, 1, 3, 5 @ 185, 225, 275, 225, 185lb`

### Bodyweight Exercises (No Weight)

Set `param_2_type: 0` and leave all `param_2_data_N` empty:

```json
{
  "exercise_id": 100,
  "title": "Push-Up",
  "param_1_type": 3, "param_2_type": 0,
  "param_1_data_1": "20", "param_1_data_2": "15", "param_1_data_3": "10",
  "param_2_data_1": "", "param_2_data_2": "", "param_2_data_3": "",
  "param_count": 3
}
```
Displays as: `20, 15, 10` (reps only)

Many existing exercises default to bodyweight (p2=0 or p2=None):
- Push-Up (100), Pull-Up (7), Air Squat (36), Burpee (24)
- ~970+ exercises in the library are reps-only (p2=0 or p2=None)

### Distance-Based Exercises

The distance unit is the exercise's fixed default (see the fixed-unit note under
"Parameter types") — you only get the unit the exercise already carries. The
examples below work because the `exercise_id`s are **custom** exercises created
with that `param_1_type`; sending `param_1_type: 5` to a stock reps or miles
exercise is ignored. To get a unit a stock exercise lacks, create a custom
exercise with the unit you want, or pick a stock exercise whose default matches
(`Sprint` 127 = meters, a `*yd` carry = yards, `Run` 82 = miles).

For a custom exercise created with `param_1_type: 5`, distance displays as yards:

```json
{
  "exercise_id": 7721172,
  "title": "Walking Lunge for Distance",
  "param_1_type": 5, "param_2_type": 0,
  "param_1_data_1": "50", "param_1_data_2": "50", "param_1_data_3": "50",
  "param_count": 3
}
```
Displays as: `3 x 50yd`

With weight (`param_2_type: 1`):
```json
{
  "exercise_id": 7721174,
  "title": "Weighted Walking Lunge for Distance",
  "param_1_type": 5, "param_2_type": 1,
  "param_1_data_1": "40", "param_1_data_2": "40",
  "param_2_data_1": "50", "param_2_data_2": "50",
  "param_count": 2
}
```
Displays as: `2 x 40yd @ 50lb`

**Distance type values:**
| param type | Unit |
|-----------|------|
| 5 | yards |
| 6 | meters |
| 10 | miles |
| 11 | feet |

Existing distance exercises: 193 in library (e.g. Sled Push, Bear Crawl, Sprint, Carioca, Run)

### Lunge Exercises in Library

102 lunge exercises exist. Most use Reps (p1=3):
- Walking Lunges (77): `p1=6 (meters), p2=None` — already distance-based!
- DB Walking Lunge (5947818): `p1=3, p2=1`
- Body Weight Lunge (5947644): `p1=3, p2=None`
- Tandem Resisted Lunge Walks (688456): `p1=5 (yards), p2=None` — distance-based

To make any lunge distance-based, create a custom exercise with `param_1_type: 5`.

---

## Required Fields for saveWorkoutSetExercises

The API requires these additional fields beyond the basic ones (discovered via UI capture):

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
  "param_1_data_1": "5", "param_1_data_2": "", ..., "param_1_data_10": "",
  "param_2_data_1": "225", "param_2_data_2": "", ..., "param_2_data_10": "",
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

**Critical fields that cause 500 errors if missing:**
- `set_num` — number of sets (same as `param_count`)
- `key` — unique key string (format: `"k::<number>"`, can be any unique value)
- `setKey` — same as `workout_set_id`
- All 10 `param_1_data_N` and `param_2_data_N` fields (empty string `""` for unused slots)
- `eType` — `"e"` for exercise
- `tags` — array (can be empty `[]`)
- `video_url`, `thumbnail_url` — strings (can be empty `""`)
- `use_count` — integer (can be `0`)
- `workout_set_exercise_template_id` — null

---

## Session Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/2.0/coach/calendar/programWorkout/unPublish/{programWorkoutId}` | **Unpublish session** |
| POST | `/2.0/coach/calendar/removeProgramWorkout` | **Delete session** |
| POST | `/2.0/coach/calendar/copyProgramWorkout` | **Copy/Repeat session** |
| POST | `/2.0/coach/calendar/programWorkout/saveWorkoutAsTemplate/{workoutId}` | **Save session to library** |

#### `POST /2.0/coach/calendar/programWorkout/unPublish/{programWorkoutId}`

Unpublishes a previously published session. No request body needed.

#### `POST /2.0/coach/calendar/removeProgramWorkout`

Deletes a session from the calendar.

**Request body:**
```json
{
  "programId": 4713246,
  "pwId": 142002657
}
```

#### `POST /2.0/coach/calendar/copyProgramWorkout`

Copies or repeats a session to a target date. Used for both "Copy" and "Repeat" context menu actions.

**Request body:**
```json
{
  "toProgramId": 4713246,
  "pwId": 142002657,
  "toDate": {
    "date": "2026-03-15",
    "day": 15,
    "month": 3,
    "year": 2026,
    "dayOfWeek": 0,
    "isToday": false
  }
}
```

#### `POST /2.0/coach/calendar/programWorkout/saveWorkoutAsTemplate/{workoutId}`

Saves an existing session as a reusable template in the session library. No request body needed — uses the workout ID in the URL path.

---

## Team Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/v5/teams/{teamId}` | **Update team settings** (title, etc.) |
| DELETE | `/v5/teams/{teamId}` | **Delete team** |
| POST | `/1.0/coach/team/updatePublishSettings` | **Update auto-publish settings** |

#### `PUT /v5/teams/{teamId}`

Updates team properties like title.

**Request body:**
```json
{
  "title": "New Team Name"
}
```

#### `POST /1.0/coach/team/updatePublishSettings`

Updates the auto-publish settings for a team's program. Takes the full program object with `pub_*` fields controlling auto-publish behavior.

---

## Coach Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v5/coaches/activityFeed?page={n}&pageSize={n}` | Coach activity feed |
| GET | `/v5/coaches/lowProgramming` | Low programming alerts |
| GET | `/v5/coaches/onboarding` | Onboarding tracking |
| GET | `/v5/coaches/athletes/{athleteId}/workouts?startDate=&endDate=` | Athlete workout data with surveys |

---

## Still Unexplored

- Program update (title, description, settings) — PUT/POST patterns return 405/404
- Athlete remove from specific team (endpoint pattern not found via probing)
- Working max set/update from coach side for specific athletes
- Marketplace endpoints (publishing, pricing, purchases)
- Notification management (mark read, dismiss — 401/404 on tested patterns)
- `apis.trainheroic.com/user` endpoint (uses `api-token` header, returns full user profile with teams)
- Circuit creation (vs superset — circuits may use different block type or field)
- Prescription template CRUD
- Coach preferences update (PATCH/PUT on `2.0/coach/prefs` returns 403/405)
- Library settings
- Session template update (edit existing template)
- Workout set reorder / move exercises between blocks
