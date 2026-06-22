# Default query bank

The queries an eval run uses when the caller gives none. Each is something a real athlete would
type, phrased the way a person phrases it (not the way a tool names it). Grouped by the surface
they exercise. Add a query here when a new tool or a new failure mode shows up.

The high-signal area is "what did I actually do" vs "what was I told to do" — the place models
historically burned the most turns. Keep that group well covered.

## Logged vs prescribed (highest signal)
- Did I record anything this week?
- What did I do in my last training session?
- Have I logged any workouts in the last few days?
- Did I actually do my squats yesterday, or just have them scheduled?

## Schedule / upcoming
- What's on my training schedule for this week?
- What's my next workout?

## History / progression
- Show me how my back squat has progressed over the last 3 months.
- What have I been training lately? Give me a sense of my recent workouts.
- How's my bench trending this year?

## PRs / maxes / stats
- What's my current bench press personal record?
- What are my working maxes right now?
- What's the most I've ever squatted?

## Identity / profile
- Whose account is this and how many sessions have I logged all-time?

## Coach surface (role=coach)
Read-only coaching questions. Several need a roster lookup first (resolve an athlete by name
before pulling their data) — that chaining is itself part of what's being evaluated. If the
roster is empty, the run should report how cleanly the model handles the empty result.

### Roster / teams
- Who's on my roster?
- What teams do I have and how many athletes are on each?

### Athlete drill-down (resolve a name first)
- How has my most recently active athlete been training lately?
- What are <athlete name>'s recent PRs?
- Is anyone on my roster falling behind on their programming?

### Exercise resolution
- What's the exercise id for "Romanian Deadlift"? (resolve a name to an exercise)
- Do I have a custom exercise for sled pushes?

### Programming / analytics
- What programs am I running right now?
- Show me team-wide training volume over the last couple of weeks.

### Messaging
- Have any of my athletes messaged me recently?

## Write tasks (write mode only — TEST account)
Used only when the eval runs in write mode (`WRITES=1` for the standalone runners, or the
write-mode prompt for the in-session path). Each requires actually performing a write, so it is
never used in a read-only run. The destructive ones really fire — TEST account only. Several need
a resolve first (an athlete, an exercise, or a program id); that chaining is part of the eval.

### Athlete (role=athlete)
- Log today's session: I did 5 sets of 5 back squats at 185.
- Record that I hit a 225 bench for 3 today.

### Coach (role=coach)
- Log a result for one of my athletes: they did 3x8 at 135 on bench today.
- Build a simple workout — 3 sets of 5 back squats — in one of my programs for tomorrow, and publish it.
- Send one of my athletes a quick "great work this week" message.
- Create a custom exercise called "Eval Test Sled Push" (then clean it up).
