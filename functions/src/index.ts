/**
 * The deployed functions: exports only (`docs/research/M2-interfaces.md` §5). Firebase names a function after its export
 * path, so the group `admin` with its `claim` key deploys as `admin-claim` (`deployedName('admin.claim')`; the admin
 * calls `httpsCallable(functions, 'admin-claim')`). Each feature folder builds its group from the composition root's
 * `getDeps`, which creates the adapters on the first call, never at cold start; `functions/test/index.test.ts` checks
 * that the exports are exactly the registry's functions, each with its region, instance cap and service account.
 */
import { adminFunctions, adminsFunctions, contributeFunctions } from './admin/index.js';
import { assistFunctions } from './assist/index.js';
import { citiesFunctions } from './cities/index.js';
import { getDeps, privateBucket } from './deps.js';
import { exportFunctions } from './export/index.js';
import { historyFunctions } from './history/index.js';
import { imageryFunctions } from './imagery/index.js';
import { usgsFunctions } from './imagery/orders/index.js';
import { layersFunctions } from './layers/index.js';
import { notifyFunctions } from './notify/index.js';
import { opsFunctions } from './ops/index.js';
import { contributorsFunctions, photosFunctions, reviewFunctions, suggestionsFunctions } from './photos/index.js';
import { publishFunctions } from './publish/index.js';
import { defineSetupFunctions } from './setup/index.js';
import { telemetryFunctions } from './telemetry/index.js';
import { workerFunctions } from './worker/index.js';

export const admin = adminFunctions(getDeps);
export const admins = adminsFunctions(getDeps);
// M13 (docs/research/M13-roles.md): the Contribute page, role requests, the review queue and the suggestions.
export const contribute = contributeFunctions(getDeps);
export const review = reviewFunctions(getDeps);
export const suggestions = suggestionsFunctions(getDeps);
export const contributors = contributorsFunctions(getDeps);
export const history = historyFunctions(getDeps);
export const telemetry = telemetryFunctions(getDeps);
export const setup = defineSetupFunctions(getDeps);
export const publish = publishFunctions(getDeps);
/** `photos.onUpload` names its bucket when it is declared: the same private bucket the Storage adapter writes. */
export const photos = photosFunctions(getDeps, privateBucket(process.env));
export const ops = opsFunctions(getDeps);
/** `layers.delete` and `layers.link` (M2c layers-settings, CR-M2c-3, CR-M2c-27). */
export const layers = layersFunctions(getDeps);
/** The M3 raster backend (`docs/research/M3-interfaces.md` §9): the raster upload trigger watches the same private bucket. */
export const imagery = imageryFunctions(getDeps, privateBucket(process.env));
/** M4 orders (`docs/research/M4-interfaces.md` §1.4): the buy flow's callables; the daily watch is a step of `imagery.tick`. */
export const usgs = usgsFunctions(getDeps);
/** The M4 assists (`docs/research/M4-interfaces.md` §4): title suggestions through the Nominatim queue, AI drafts. */
export const assist = assistFunctions(getDeps);
/** The M4 notifications (§5): the fan-out of every event to the admins' inboxes and devices, the push callables. */
export const notify = notifyFunctions(getDeps);
export const cities = citiesFunctions(getDeps);
/**
 * The M5 static export (`docs/research/M5-interfaces.md` §5): `export` is a reserved word, so the group is named in an
 * export clause; it deploys `export-start`, `export-download` and `export-build`.
 */
const exportGroup = exportFunctions(getDeps);
export { exportGroup as export };
/** M7 (`docs/research/M7-local-worker.md` §2.4): the local worker's callables, `worker-hello` … `worker-end`. */
export const worker = workerFunctions(getDeps);
