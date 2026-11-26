/**
 * The admin's lazy `worker-local` chunk (finding 72 of 2026-11-02, `docs/research/M7-local-worker.md` §1.5, §2.7; its
 * budget in `scripts/ci/check_bundle_budget.py`): "Use this computer" (the starter file, the auto-pair, Stop using this
 * computer, the command behind Advanced) and its element with its texts (`@hcm/shared/admin-worker-local`), fetched by
 * the worker's panel (`WorkerFeed.intents.local`) the first time it shows the computer's part.
 */
export { createLocal } from './local.js';
export { defineWorkerLocal } from '@hcm/ui/admin/worker/local';
