import { catalogueTranslator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type AdminWorkerLocalKey } from './ro.js';

export type { AdminWorkerLocalKey } from './ro.js';

/** "Use this computer" texts (finding 72, `docs/research/M7-local-worker.md` §1.5), fetched with the admin's `worker-local` chunk only. */
export const translateAdminWorkerLocal = catalogueTranslator<AdminWorkerLocalKey>({ ro, en });
