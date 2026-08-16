# API coverage inventory

The living gap list for undocumented TrainHeroic endpoints lives next to the reverse-engineering
skill:

- Workflow: [`.agents/skills/reverse-engineer-api/SKILL.md`](../../.agents/skills/reverse-engineer-api/SKILL.md)
- Status table: [`.agents/skills/reverse-engineer-api/coverage.md`](../../.agents/skills/reverse-engineer-api/coverage.md)
- Probe recipe: [`.claude/skills/live-api-probe/SKILL.md`](../../.claude/skills/live-api-probe/SKILL.md)

When you wrap a new endpoint, update `coverage.md` and the "Still Unexplored" sections in the
CLI skill api-references. Do not fork a third inventory here.

Remaining wrap work is sliced in [`tasks/plan.md`](../../tasks/plan.md).
