/** The diff gate: which writes can change the manifest (security review §4.5: before/after diff in the trigger). */
import { describe, expect, it } from 'vitest';

import { MANIFEST_FIELDS, needsManifestBuild } from '../../src/publish/fields.js';

const published = { published: true, title: { ro: 'Titlu', en: 'Title' }, location: { lat: 44.4, lng: 26.1 }, processing: 'done' };

describe('needsManifestBuild', () => {
    it('happyPath_anUploadedTabIconRebuildsSoTheManifestSaysOwnIcon @S-V54-HAPPY', () => {
        const city = { published: true, name: { ro: 'B', en: 'B' } };
        expect(needsManifestBuild('city', { ...city, icon: { source: 'default' } }, { ...city, icon: { source: 'custom' } })).toBe(true);
        expect(
            needsManifestBuild(
                'city',
                { ...city, icon: { source: 'default', updatedAt: 1 } },
                { ...city, icon: { source: 'default', updatedAt: 2 } },
            ),
        ).toBe(false);
    });

    it.each([
        ['publishing', { ...published, published: false }, published],
        ['unpublishing', published, { ...published, published: false }],
        ['deleting a published photo', published, undefined],
        ['creating a published photo', undefined, published],
        ['changing a carried field of a published photo', published, { ...published, title: { ro: 'Alt titlu', en: 'Title' } }],
        ['the processing finishing', { ...published, processing: 'pending' }, published],
        ['a month set', { ...published, year: 1936 }, { ...published, year: 1936, month: 7 }],
        ['a day set', { ...published, year: 1936, month: 7 }, { ...published, year: 1936, month: 7, day: 12 }],
        ['a source address set', published, { ...published, sourceUrl: 'https://arhiva.example/1' }],
        ['a source name changed', { ...published, sourceLabel: 'Arhiva' }, { ...published, sourceLabel: 'Muzeul' }],
    ])('happyPath_%s', (_name, before, after) => {
        expect(needsManifestBuild('photo', before, after)).toBe(true);
    });

    it.each([
        ['a change of an unpublished photo', { ...published, published: false }, { ...published, published: false, title: { ro: 'Nou' } }],
        [
            'the stamp and suggestions only @S-A10-BAD-NOTHING-TO-PUBLISH',
            published,
            { ...published, updatedBy: 'u-2', suggested: { year: 1936 } },
        ],
        [
            'the same maps in another key order',
            published,
            { processing: 'done', location: { lng: 26.1, lat: 44.4 }, title: { en: 'Title', ro: 'Titlu' }, published: true },
        ],
        ['creating an unpublished document', undefined, { ...published, published: false }],
        ['deleting an unpublished document', { ...published, published: false }, undefined],
    ])('badPath_%s', (_name, before, after) => {
        expect(needsManifestBuild('photo', before, after)).toBe(false);
    });

    it('happyPath_everyCategoryWriteCounts', () => {
        expect(needsManifestBuild('poiCategory', undefined, { label: { ro: 'Parcuri' } })).toBe(true);
        expect(needsManifestBuild('poiCategory', { label: { ro: 'Parcuri' } }, undefined)).toBe(true);
        expect(needsManifestBuild('poiCategory', { label: { ro: 'Parcuri' }, order: 1 }, { label: { ro: 'Parcuri' }, order: 2 })).toBe(
            true,
        );
        expect(needsManifestBuild('poiCategory', { label: { ro: 'Parcuri' } }, { label: { ro: 'Parcuri' }, updatedBy: 'u-2' })).toBe(false);
    });

    it('happyPath_aCityTokenOrLayerStatusChangeCounts', () => {
        expect(
            needsManifestBuild(
                'city',
                { published: true, mapbox: { publicToken: 'pk.a' } },
                { published: true, mapbox: { publicToken: 'pk.b' } },
            ),
        ).toBe(true);
        expect(needsManifestBuild('layer', { published: true, status: 'processing' }, { published: true, status: 'ready' })).toBe(true);
        expect(needsManifestBuild('poi', { published: true, photoIds: ['a'] }, { published: true, photoIds: ['a', 'b'] })).toBe(true);
    });

    it('happyPath_noEntityCarriesItsStamp', () => {
        expect(Object.values(MANIFEST_FIELDS).flat()).not.toContain('updatedAt');
        expect(Object.values(MANIFEST_FIELDS).flat()).not.toContain('published');
    });
});

describe('needsManifestBuild: M13', () => {
    const photo = { published: true, title: { ro: 'x' } };

    it('happyPath_approvalPutsAPhotoInTheManifest', () => {
        expect(
            needsManifestBuild('photo', { ...photo, reviewStatus: 'pending', published: false }, { ...photo, reviewStatus: 'approved' }),
        ).toBe(true);
    });

    it('badPath_aPendingPhotoIsNotListedWhateverItsPublishedSays', () => {
        expect(
            needsManifestBuild('photo', { ...photo, reviewStatus: 'pending' }, { ...photo, reviewStatus: 'pending', title: { ro: 'y' } }),
        ).toBe(false);
    });

    it('happyPath_aCreditChangesTheManifest', () => {
        expect(needsManifestBuild('poi', { ...photo, credit: 'a' }, { ...photo, credit: 'b' })).toBe(true);
    });
});
