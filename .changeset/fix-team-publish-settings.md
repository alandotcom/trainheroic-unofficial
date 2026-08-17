---
"@trainheroic-unofficial/dto": patch
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/core": patch
"@trainheroic-unofficial/cli": patch
"@trainheroic-unofficial/db": patch
---

Fix team auto-publish when targeting a team id: resolve `group_program` first, then GET that program. The `--team` / `teamId` path previously requested `/3.0/coach/program/undefined`.
