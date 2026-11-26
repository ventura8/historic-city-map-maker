import { describe, expect, it } from 'vitest';

import { en as installEn } from '../src/i18n/admin-install/en.js';
import { ro as installRo } from '../src/i18n/admin-install/ro.js';
import { ro as setupRo } from '../src/i18n/admin-setup/ro.js';
import { translateAdminSetup } from '../src/i18n/admin-setup/index.js';
import { INSTALL_STATES, INSTALL_STEP_IDS, TRANSIENT_DEPLOY_PATTERNS } from '../src/schemas/install.js';

const byText = (a: string, b: string): number => a.localeCompare(b);

/** A terminal command a Setup text could name (S-A30-HAPPY-NO-TERMINAL: Setup lists none). */
const COMMAND = /\b(?:npm|npx|firebase deploy|gcloud|docker|git push)\b/;

describe('the installer catalogue', () => {
    it('happyPath_bothLanguagesHaveTheSameKeys', () => {
        expect(Object.keys(installEn).toSorted(byText)).toEqual(Object.keys(installRo).toSorted(byText));
    });

    it('happyPath_itsKeysAreTheSetupAssistantsAndNoneOverridesASetupText', () => {
        const keys = Object.keys(installRo);

        expect(keys.every((key) => key.startsWith('adminSetup.'))).toBe(true);
        expect(keys.filter((key) => key in setupRo)).toEqual([]);
    });

    it('happyPath_theSetupTranslatorSaysTheInstallersTexts', () => {
        expect(translateAdminSetup('en', 'adminSetup.install.cost', { minutes: '85', free: '2,500' })).toBe(
            'Uses about 85 build minutes; Google Cloud gives 2,500 free each month.',
        );
        expect(translateAdminSetup('ro', 'adminSetup.step.site')).toBe('Publicarea hărții');
        expect(translateAdminSetup('en', 'adminSetup.recheck')).toBe('Check again');
    });

    it('happyPath_everyStateStepAndRetryReasonHasALabel', () => {
        const labels = [
            ...INSTALL_STATES.map((state) => translateAdminSetup('ro', `adminSetup.install.state.${state}`)),
            ...INSTALL_STEP_IDS.map((step) => translateAdminSetup('en', `adminSetup.install.step.${step}`)),
            ...TRANSIENT_DEPLOY_PATTERNS.map(({ id }) => translateAdminSetup('en', `adminSetup.install.retry.${id}`)),
        ];

        expect(labels.every((label) => label.length > 0 && !label.startsWith('adminSetup.'))).toBe(true);
    });

    it('badPath_noTextNamesATerminalCommandOrUsesCedillas', () => {
        const texts = [...Object.values(installRo), ...Object.values(installEn)];

        expect(texts.filter((text) => COMMAND.test(text))).toEqual([]);
        expect(texts.filter((text) => /[şţŞŢ]/.test(text))).toEqual([]);
    });
});
