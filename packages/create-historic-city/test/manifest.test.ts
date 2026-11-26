/** The new city's city.json (src/manifest.ts; docs/research/M5-interfaces.md §4.3). */
import { join } from 'node:path';

import { validateManifest } from '@hcm/shared';
import { themeFromSeed } from '@hcm/ui/dynamic-color';
import { describe, expect, it } from 'vitest';

import { Refusal } from '../src/context.js';
import { translator } from '../src/i18n/index.js';
import { cityManifestText, type CityAnswers } from '../src/manifest.js';
import { read, REPOSITORY } from './support.js';

const TEMPLATE = read(join(REPOSITORY, 'templates/starter-kit/city.json'));
const t = translator('en');
const THEME = themeFromSeed('#4F7A4A');

const CLUJ: CityAnswers = {
    id: 'cluj',
    name: { ro: 'Cluj *Napoca*', en: 'Cluj [Napoca]' },
    bounds: { west: 23.5, south: 46.72, east: 23.7, north: 46.82 },
    seed: '#4F7A4A',
    token: 'pk.e2e-test',
};

describe('cityManifestText', () => {
    it('happyPath_aValidCityWhoseNameIsPlainTextInAbout', () => {
        const manifest = JSON.parse(cityManifestText(TEMPLATE, CLUJ, THEME, t)) as { city: { about: { ro: string; en: string } } };

        expect(validateManifest(manifest).ok).toBe(true);
        expect(manifest.city.about.ro).toContain('**Cluj \\*Napoca\\***');
        expect(manifest.city.about.en).toContain('**Cluj \\[Napoca\\]**');
    });

    it('happyPath_aTemplateWithoutPlaces', () => {
        const bare = Object.fromEntries(
            Object.entries(JSON.parse(TEMPLATE) as Record<string, unknown>).filter(([key]) => !['pois', 'poiCategories'].includes(key)),
        );

        expect(JSON.parse(cityManifestText(JSON.stringify(bare), CLUJ, THEME, t))).toMatchObject({ pois: [] });
    });

    it('badPath_aCityTheEngineWouldRefuseIsRefusedBeforeWriting', () => {
        expect(() => cityManifestText(TEMPLATE, { ...CLUJ, name: { ro: 'x'.repeat(101), en: 'Cluj' } }, THEME, t)).toThrow(
            new Refusal(t('cli.manifest.invalid', { detail: 'city.name.ro validation.tooBig' })),
        );
    });

    it('badPath_anInvalidTemplateIsABugNotARefusal', () => {
        expect(() => cityManifestText('{ "version": 1 }', CLUJ, THEME, t)).toThrow(/the bundled template\/city\.json is invalid/);
    });
});
