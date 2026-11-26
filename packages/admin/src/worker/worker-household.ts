/**
 * The admin's lazy `worker-household` chunk (W5, household computers: `docs/research/M7-local-worker.md` *Household computers*; its
 * budget in `scripts/ci/check_bundle_budget.py`): the city's computers, Add another computer and Remove this computer, with their
 * element and texts (`@hcm/shared/admin-worker-household`), fetched by the worker's panel (`WorkerFeed.intents.household`).
 */
export { createHousehold } from './household.js';
export { defineWorkerHousehold } from '@hcm/ui/admin/worker/household';
