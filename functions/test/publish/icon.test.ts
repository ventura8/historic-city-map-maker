/**
 * The manifest's build keeps the city's default tab icon (`functions/src/publish/icon.ts`): drawn for a city without one,
 * drawn again when the seed colour changed, an editor's upload left alone, and a failure logged without failing the build.
 */
import { FIRESTORE_PATHS, STORAGE_PATHS, cityDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { buildManifest } from '../../src/publish/build-manifest.js';
import { ensureCityIcon } from '../../src/publish/icon.js';
import { createFakeImageProcessor } from '../support/images.js';
import { CITY_ID, cityDoc } from './city.js';
import { contentDeps, publicUrl, type ContentDeps } from './fakes.js';

const AT = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
const RECORD = { url: publicUrl(STORAGE_PATHS.cityIcon(CITY_ID, 180)), sha256: 'a'.repeat(64), updatedBy: 'u-admin', updatedAt: AT };

function withFakeImages(base: ContentDeps) {
    const fake = createFakeImageProcessor();
    return { deps: { ...base, images: fake.images }, recorder: fake.recorder };
}

async function iconOf(deps: ContentDeps) {
    return (await deps.documents.get(FIRESTORE_PATHS.city(CITY_ID), cityDocSchema))?.icon;
}

describe('ensureCityIcon', () => {
    it('happyPath_aCityWithoutAnIconGetsTheDefaultInItsSeedColour @S-A101-HAPPY-DEFAULT', async () => {
        const { deps } = withFakeImages(contentDeps());
        deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc());

        await expect(ensureCityIcon(deps, CITY_ID)).resolves.toBe('drawn');

        await expect(iconOf(deps)).resolves.toMatchObject({ source: 'default', seedColor: '#8B5E3C', updatedBy: 'system:publish' });
        expect(deps.blobs.paths('public', `cities/${CITY_ID}/icon-`)).toHaveLength(3);
    });

    it('happyPath_aCityWithoutAThemeWearsTheProjectsColour', async () => {
        const { deps } = withFakeImages(contentDeps());
        deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc({ theme: undefined }));

        await expect(ensureCityIcon(deps, CITY_ID)).resolves.toBe('drawn');
        await expect(iconOf(deps)).resolves.toMatchObject({ source: 'default', seedColor: '#8B5E3C' });
    });

    it('happyPath_aNewSeedColourDrawsTheDefaultAgain', async () => {
        const { deps } = withFakeImages(contentDeps());
        const city = cityDoc({ icon: { source: 'default', seedColor: '#8B5E3C', ...RECORD } });
        deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), { ...city, theme: { ...city.theme, seedColor: '#336699' } });

        await expect(ensureCityIcon(deps, CITY_ID)).resolves.toBe('drawn');
        await expect(iconOf(deps)).resolves.toMatchObject({ source: 'default', seedColor: '#336699' });
    });

    it.each([
        ['an upload', { source: 'custom' as const, ...RECORD }],
        ['the default in the current colour', { source: 'default' as const, seedColor: '#8B5E3C', ...RECORD }],
    ])('happyPath_%s_isLeftAlone', async (_name, icon) => {
        const { deps, recorder } = withFakeImages(contentDeps());
        deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc({ icon }));

        await expect(ensureCityIcon(deps, CITY_ID)).resolves.toBe('current');
        expect(recorder.argsOf('iconPng')).toEqual([]);
    });

    it('happyPath_anUploadWhileTheDefaultWasDrawnWins', async () => {
        const { deps } = withFakeImages(contentDeps());
        deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc());
        const racing = {
            ...deps,
            images: {
                ...deps.images,
                iconPng: async (...args: Parameters<typeof deps.images.iconPng>) => {
                    deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc({ icon: { source: 'custom', ...RECORD } }));
                    return deps.images.iconPng(...args);
                },
            },
        };

        await expect(ensureCityIcon(racing, CITY_ID)).resolves.toBe('current');
        await expect(iconOf(deps)).resolves.toMatchObject({ source: 'custom' });
    });

    it('badPath_aMissingCityDrawsNothing', async () => {
        const { deps } = withFakeImages(contentDeps());

        await expect(ensureCityIcon(deps, CITY_ID)).resolves.toBe('current');
        expect(deps.blobs.paths('public')).toEqual([]);
    });

    it('badPath_aFailureIsLoggedAndTheManifestIsStillBuilt', async () => {
        const base = contentDeps();
        base.documents.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc());
        const deps = { ...base, images: { ...base.images, iconPng: () => Promise.reject(new Error('sharp down')) } };

        await expect(ensureCityIcon(deps, CITY_ID)).resolves.toBe('failed');
        await expect(buildManifest(deps, { cityId: CITY_ID, requestedVersion: 1, full: true })).resolves.toBe('published');
        expect(base.recording.records.some((record) => record.message === 'city icon not drawn')).toBe(true);
    });
});
