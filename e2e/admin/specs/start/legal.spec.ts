/**
 * What Google's OAuth verification asks of the start site (`docs/research/M14-start-your-map.md` §10): the home page names the
 * app and links its privacy policy and terms in plain HTML, both pages hold both languages, and Search Console's file is
 * served when the build names one; a name that is no such file stops the build before anything is written.
 */
import { readdirSync } from 'node:fs';

import { createLogger } from '@hcm/shared';

import { nodeFileSystem } from '../../../../scripts/site/src/files.js';
import { EXIT_INVALID, runStartCli } from '../../../../scripts/site/src/start/build.js';
import { expectStateSound } from '../../../support/state-check.js';
import { testIdOf } from '../../../support/test.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/test.js';
import { E2E_START_SITE_VERIFICATION } from '../../world.js';
import { START_URL, startPage } from './world.js';

const PAGES = [
    { link: /Privacy policy/, ro: 'Politica de confidențialitate', en: 'Privacy policy', state: 'start.privacy' },
    { link: /Terms of service/, ro: 'Condiții de utilizare', en: 'Terms of service', state: 'start.terms' },
] as const;

test(
    'The start page names the app and links its privacy policy and terms, in both languages',
    { tag: '@S-A76-HAPPY-LEGAL' },
    async ({ page, lang }, testInfo) => {
        await page.goto(`${START_URL}?test=${encodeURIComponent(testIdOf(testInfo))}&lang=${lang}`);
        await expect(startPage(page).getByRole('heading', { level: 1 })).toBeVisible();
        const footer = page.getByRole('contentinfo');
        await expect(footer).toContainText('Historic City Map Maker');
        for (const legal of PAGES) {
            await footer.getByRole('link', { name: legal.link }).click();
            await expect(page.getByRole('heading', { level: 1, name: legal.ro })).toBeVisible();
            await expect(page.getByRole('heading', { level: 2, name: legal.en, exact: true })).toBeVisible();
            await expectStateSound(page, adminVisit(legal.state, lang));
            await page
                .getByRole('contentinfo')
                .getByRole('link', { name: /Start your map/ })
                .click();
            await expect(startPage(page).getByRole('heading', { level: 1 })).toBeVisible();
        }
        const verification = await page.request.get(`${START_URL}${E2E_START_SITE_VERIFICATION}`);
        expect(await verification.text()).toBe(`google-site-verification: ${E2E_START_SITE_VERIFICATION}`);
    },
);

test(
    'A Search Console name that is no verification file stops the start build',
    { tag: '@S-A76-BAD-VERIFICATION' },
    async ({ lang }, testInfo) => {
        const root = testInfo.outputPath(`start-build-${lang}`);
        const files = nodeFileSystem(root);
        files.write('marker.txt', 'before');
        const steps = (): Promise<never> => Promise.reject(new Error('the steps are read only after the name is checked'));
        const env = { HCM_START_SITE_VERIFICATION: '../index.html' };
        const status = await runStartCli([], { files, log: createLogger('e2e-start-legal'), env, steps });
        expect(status).toBe(EXIT_INVALID);
        expect(readdirSync(root)).toEqual(['marker.txt']);
    },
);
