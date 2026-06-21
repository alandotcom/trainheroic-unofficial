# @trainheroic-unofficial/coach-mcp

## 0.6.4

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.6.4
  - @trainheroic-unofficial/js@0.6.4

## 0.6.3

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.6.3
  - @trainheroic-unofficial/js@0.6.3

## 0.6.2

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.6.2
  - @trainheroic-unofficial/js@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.6.1
  - @trainheroic-unofficial/js@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [6075bc4]
  - @trainheroic-unofficial/core@0.6.0
  - @trainheroic-unofficial/js@0.6.0

## 0.5.0

### Patch Changes

- @trainheroic-unofficial/js@0.5.0
- @trainheroic-unofficial/core@0.5.0

## 0.4.2

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/core@0.4.2
  - @trainheroic-unofficial/js@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/js@0.4.1
  - @trainheroic-unofficial/core@0.4.1

## 0.4.0

### Patch Changes

- Updated dependencies [92a422f]
  - @trainheroic-unofficial/core@0.4.0
  - @trainheroic-unofficial/js@0.4.0

## 0.3.0

### Minor Changes

- dbe2c63: Replace the raw `th_request` escape hatch with typed tools so the model never has to guess endpoints. Adds athlete `invite`/`archive`/`restore`, team `create`/`update`/`delete` and join-code create/delete, an `analytics_query` tool covering readiness, 1RM and working-max history, training summary, compliance, and lift progress, and session `unpublish`/`copy`/`save_as_template`. Destructive and athlete-facing actions still gate through `confirmGate`; additive writes are ungated. Request shapes were verified against the live TrainHeroic API.

### Patch Changes

- Updated dependencies [dbe2c63]
  - @trainheroic-unofficial/core@0.3.0
  - @trainheroic-unofficial/js@0.3.0
