/**
 * The project's landing page on GitHub Pages (DECISIONS-for-review.md §162): the committed `sites/landing/`, served as it is
 * at the e2e Hosting server's `/landing/`. It names Historic City Map Maker, links the start page and the example map, names
 * the CLI at this release (never a major line) and switches between English and Romanian; a word missing from one language
 * stops the build before anything is written.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createLogger } from '@hcm/shared';

import { nodeFileSystem } from '../../../../scripts/site/src/files.js';
import { EXIT_INVALID, runLandingCli } from '../../../../scripts/site/src/landing/build.js';
import { LANDING_CATALOGUES } from '../../../../scripts/site/src/landing/texts.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/test.js';
import { ADMIN_ORIGIN } from '../../world.js';
import { REPOSITORY } from './world.js';

const LANDING_URL = `${ADMIN_ORIGIN}/landing/`;
const VERSION = (JSON.parse(readFileSync(resolve(REPOSITORY, 'package.json'), 'utf8')) as { readonly version: string }).version;

test(
    'The landing page names the product and links the start page, the example and the other language',
    { tag: '@S-A132-HAPPY-LANDING' },
    async ({ page }) => {
        await page.goto(LANDING_URL);
        await expect(page.getByRole('heading', { level: 1, name: 'Historic City Map Maker' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Start your map' })).toHaveAttribute('href', 'https://start-historic-city.web.app/');
        await expect(page.getByRole('link', { name: /București dispărut/ })).toHaveAttribute(
            'href',
            'https://bucurestiul-disparut.web.app/',
        );
        await expect(page.getByText(`npx create-historic-city@${VERSION} self-host`)).toBeVisible();
        await expectStateSound(page, adminVisit('start.landing', 'en'));

        await page.getByRole('navigation', { name: 'Language' }).getByRole('link', { name: 'Română' }).click();
        await expect(page.getByRole('link', { name: 'Pornește-ți harta' })).toHaveAttribute('href', 'https://start-historic-city.web.app/');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
        await expectStateSound(page, adminVisit('start.landing-ro', 'ro'));

        await page.getByRole('navigation', { name: 'Limba' }).getByRole('link', { name: 'English' }).click();
        await expect(page.getByRole('heading', { level: 2, name: 'Prefer the terminal?' })).toBeVisible();
    },
);

test(
    'A word missing from one language stops the landing build before anything is written',
    { tag: '@S-A132-BAD-LANDING-MISSING-KEY' },
    ({ lang }, testInfo) => {
        const root = testInfo.outputPath(`landing-build-${lang}`);
        const files = nodeFileSystem(root);
        files.write('package.json', JSON.stringify({ name: 'x', version: VERSION }));
        const ro = Object.fromEntries(Object.entries(LANDING_CATALOGUES.ro).filter(([key]) => key !== 'title'));
        const records: string[] = [];
        const log = createLogger('e2e-landing', { sink: (record) => records.push(record.message) });

        const status = runLandingCli([], { files, log }, { en: { ...LANDING_CATALOGUES.en, footer: '  ' }, ro });

        expect(status).toBe(EXIT_INVALID);
        expect(records).toContain("the landing page's words are incomplete: en: footer, ro: title");
        expect(readdirSync(root)).toEqual(['package.json']);
    },
);
