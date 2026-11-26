/**
 * The admin's lazy `worker` chunk (`docs/research/M7-local-worker.md` §7; its budget in `scripts/ci/check_bundle_budget.py`):
 * its one dynamic entry, which the Jobs area's store imports (`JobsIntents.worker`, `JobsIntents.workerElements`). It
 * holds the local worker's feed and the elements of `@hcm/ui/admin/worker` (the panel, a version's place) with their texts.
 */
export { createWorkerFeed } from './feed.js';
export { defineWorkerElements } from '@hcm/ui/admin/worker';
