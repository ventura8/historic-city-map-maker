import { catalogueTranslator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type AdminArchiveKey } from './ro.js';

export type { AdminArchiveKey } from './ro.js';

/** M20's Import local files texts (`docs/research/M20-import-local.md` §8), fetched with the admin's `archive` chunk only. */
export const translateAdminArchive = catalogueTranslator<AdminArchiveKey>({ ro, en });
