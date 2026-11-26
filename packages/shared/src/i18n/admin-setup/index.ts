import { catalogueTranslator } from '../catalogue.js';
// [section install] owner: installer (docs/research/M6-interfaces.md §1.8, CR-M6-6): the installer's texts join this catalogue.
import { en as installEn } from '../admin-install/en.js';
import { ro as installRo, type AdminInstallKey } from '../admin-install/ro.js';
// [end install]
import { en } from './en.js';
import { ro, type AdminSetupKey as AdminSetupOwnKey } from './ro.js';

/** Every key of the Setup Assistant: its own catalogue's and, since M6, the installer's (`../admin-install/`). */
export type AdminSetupKey = AdminSetupOwnKey | AdminInstallKey;

export type AdminSetupMessages = Readonly<Record<AdminSetupKey, string>>;

/**
 * The Setup Assistant's texts per language: this folder's catalogue and the installer's, whose keys are disjoint
 * (`packages/shared/test/i18n-admin-install.test.ts`), so no spread overrides another text.
 */
const ADMIN_SETUP_CATALOGUES: Readonly<Record<'ro' | 'en', AdminSetupMessages>> = {
    ro: { ...ro, ...installRo },
    en: { ...en, ...installEn },
};

/** The Setup Assistant's texts (`docs/research/M2b-interfaces.md` §3): steps, states, billing, provisioning, import, install. */
export const translateAdminSetup = catalogueTranslator<AdminSetupKey>(ADMIN_SETUP_CATALOGUES);
