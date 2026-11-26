import { catalogueTranslator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type AdminShellKey } from './ro.js';

export type { AdminShellKey, AdminShellMessages } from './ro.js';

/** The admin shell's texts (`docs/research/M2b-interfaces.md` §1, §2): navigation, sign-in, session, Google consent. */
export const translateAdminShell = catalogueTranslator<AdminShellKey>({ ro, en });
