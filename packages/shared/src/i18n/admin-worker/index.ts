import { catalogueTranslator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type AdminWorkerKey } from './ro.js';

export type { AdminWorkerKey } from './ro.js';

/** M7's "Run on my computer" texts (`docs/research/M7-local-worker.md` §7), fetched with the admin's `worker` chunk only. */
export const translateAdminWorker = catalogueTranslator<AdminWorkerKey>({ ro, en });
