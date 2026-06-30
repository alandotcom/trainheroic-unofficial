# TrainHeroic Toolkit

The shared domain language for this toolkit over the undocumented TrainHeroic API.
This glossary pins terms that are easy to confuse across the SDK, the tool layer, and the
servers. It is a glossary only, not a spec; implementation lives in the code and package
READMEs.

Names follow TrainHeroic's own vocabulary wherever the API exposes one, even when that
produces close collisions (the two log actions below being the clearest case). The
TrainHeroic term wins over a cleaner invented one, so renaming to remove a collision is not
something we do.

## The platform and its API

**TrainHeroic**:
The strength-and-conditioning platform this toolkit talks to. A coach programs workouts for a
roster; each athlete trains and logs against their own program.
_Avoid_: calling it a "coaching platform" in our own summaries, which hides the athlete half
the toolkit treats as first-class.

**TrainHeroic API**:
The single undocumented REST API behind that platform, reached over two hosts and serving both
roles from one surface. This is the canonical name for the upstream API in our taglines,
package descriptions, and docs.
_Avoid_: "coaching API". It frames a two-role surface as coach-only, and it gets quoted
verbatim into downstream summaries of the repo.

## Roles and acting on behalf

**Athlete**:
A person who trains their own program and logs their own results. A coach account also
carries athlete scope, so it can reach its own training data through the athlete surface.
_Avoid_: User, member, trainee.

**Coach**:
A person who manages a roster and can read and write each rostered athlete's training.
_Avoid_: Trainer, owner.

**Roster athlete**:
An athlete that a given coach manages. The coach reaches this athlete's data through the
coach surface, addressing them by athlete id.
_Avoid_: Client, player.

**Log own**:
The act of an athlete recording results against their own saved workout set, through the
athlete surface.
_Avoid_: Self-log, athlete log.

**Log for Athlete**:
The act of a coach recording results against a roster athlete's saved workout set on that
athlete's behalf, through the coach surface. This is the toolkit's name for the mobile app's
own "Log for Athlete" flow, and it is a distinct action from Log own even though both write
the same kind of result.
_Avoid_: Coach log, log on behalf, proxy log.

**Invited athlete**:
A real athlete who joined a roster and whose training log accepts writes. Log for Athlete
succeeds against an invited athlete.
_Avoid_: Live athlete.

**Seeded athlete**:
A demo athlete that TrainHeroic pre-populates on an account. A seeded athlete's training log
is read-only, so Log for Athlete fails against one. The read-only boundary is the reason the
distinction matters.
_Avoid_: Demo athlete (in prose), fake athlete, test athlete.

## The saved-workout hierarchy

These four ids sit on the same nested record and read almost identically, but they identify
different things. Conflating them breaks a write.

**Saved workout**:
An athlete's dated copy of a prescribed workout for one day. Its id appears as `sessionId`
when a set within it is marked completed.
_Avoid_: Session (except as that one body field), program workout.

**Saved workout set**:
A block within a saved workout, possibly a superset. It is the unit that gets marked
completed. Identified by `savedWorkoutSetId`.
_Avoid_: Set (bare), block, group.

**Saved workout set exercise**:
One exercise instance inside a saved workout set. It is the unit that entered results are
logged against. Identified by `savedWorkoutSetExerciseId`, which is the record's own `id`.
_Avoid_: Exercise (bare), logged exercise.

**Workout set exercise id**:
A field on a saved workout set exercise that points back at the original prescription
exercise's id. It is a back-reference, not the saved-copy id, so it differs from
`savedWorkoutSetExerciseId` on the same record. The set-log write needs both.
_Avoid_: Treating it as interchangeable with `savedWorkoutSetExerciseId`.

## Prescription and results

**Prescription**:
The planned values a coach programmed for an exercise, before any training happens.
_Avoid_: Plan, target, prescribed set (when a noun is wanted).

**Performed results**:
The actual reps and weight an athlete did, entered against a saved workout set exercise. The
reliable signal that a slot was performed is its `param_N_made` flag, not the set-level
completed flag.
_Avoid_: Logged set, entered data, actuals (pick one in prose: performed results).
