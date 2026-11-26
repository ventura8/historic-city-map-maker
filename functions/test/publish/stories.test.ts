/**
 * M17's stories in the manifest (docs/research/M17-stories.md §4): which stories are listed, their links filtered to what the
 * manifest lists, the rebuild a story's write asks for, and what the static export keeps of them.
 */
import { validateManifest, type CityDoc, type Manifest } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { QueryResult } from '../../src/ports/documents.js';
import { planExport } from '../../src/export/plan.js';
import { assembleManifest, type Assembly, type CityContent } from '../../src/publish/assemble.js';
import { needsManifestBuild } from '../../src/publish/fields.js';
import { KIT_PAGE } from '../export/world.js';
import { TEST_CONFIG } from './fakes.js';
import { CITY_ID, categoryDoc, cityDoc, layerDoc, photoDoc, poiDoc, storyDoc } from './city.js';

function result<T>(documents: readonly (readonly [string, T])[]): QueryResult<T> {
    return { documents: documents.map(([id, data]) => ({ id, path: `cities/${CITY_ID}/x/${id}`, data })), invalid: [] };
}

function content(stories: CityContent['stories'], city: Partial<CityDoc> = {}): CityContent {
    return {
        cityId: CITY_ID,
        city: cityDoc(city),
        layers: result([['flight-1940', layerDoc()]]),
        photos: result([
            ['p1', photoDoc('p1')],
            ['p2', photoDoc('p2')],
            ['lost', photoDoc('lost', { location: undefined, bearing: undefined })],
        ]),
        poiCategories: result([['churches', categoryDoc()]]),
        pois: result([['enei', poiDoc()]]),
        stories,
    };
}

function manifestOf(assembly: Assembly): Manifest {
    if (!assembly.ok) {
        throw new Error(`refused: ${JSON.stringify(assembly.issues)}`);
    }
    return assembly.manifest;
}

describe('assembleManifest: stories (M17 §4)', () => {
    it('happyPath_aPublishedStoryIsListedWithItsTextAndLinks @S-A100-HAPPY-MANIFEST', () => {
        const assembly = assembleManifest(content(result([['enei-story', storyDoc({ credit: 'Maria' })]])), TEST_CONFIG.errorEndpoint);
        const manifest = manifestOf(assembly);
        expect(manifest.stories).toEqual([
            {
                id: 'enei-story',
                title: { ro: 'Biserica Enei', en: 'Enei Church' },
                body: { ro: 'Demolată în **1977**.\n\n![Altarul](photo:p2)' },
                yearStart: 1977,
                photoIds: ['p1'],
                poiIds: ['enei'],
                credit: 'Maria',
            },
        ]);
        expect(assembly.ok && assembly.counts.stories).toBe(1);
    });

    it('happyPath_aStoryMayNameAPhotoWithNoPlace', () => {
        const manifest = manifestOf(
            assembleManifest(content(result([['s', storyDoc({ photoIds: ['lost'] })]])), TEST_CONFIG.errorEndpoint),
        );
        expect(manifest.stories?.[0]?.photoIds).toEqual(['lost']);
    });

    it('badPath_unpublishedWaitingRefusedAndTextlessStoriesAreNotListed @S-A100-BAD-MANIFEST', () => {
        const stories = result([
            ['draft', storyDoc({ published: false })],
            ['waiting', storyDoc({ reviewStatus: 'pending' })],
            ['refused', storyDoc({ reviewStatus: 'refused' })],
            ['textless', storyDoc({ body: undefined })],
        ]);
        const published: object = JSON.parse(
            JSON.stringify(manifestOf(assembleManifest(content(stories), TEST_CONFIG.errorEndpoint))),
        ) as object;
        expect(Object.keys(published)).not.toContain('stories');
    });

    it('badPath_linksToWhatTheManifestDoesNotListAreDropped', () => {
        const story = storyDoc({ photoIds: ['gone', 'p1'], poiIds: ['gone'] });
        const manifest = manifestOf(assembleManifest(content(result([['s', story]])), TEST_CONFIG.errorEndpoint));
        expect(manifest.stories?.[0]).toMatchObject({ photoIds: ['p1'] });
        expect(manifest.stories?.[0]?.poiIds).toBeUndefined();
    });

    it('badPath_aStoryWithAnHttpLinkIsSkippedAndReported', () => {
        const story = storyDoc({ body: { ro: 'O [sursă](http://example.org).' } });
        const assembly = assembleManifest(content(result([['s', story]])), TEST_CONFIG.errorEndpoint);
        expect(assembly.ok && assembly.skipped).toEqual([{ entity: 'story', id: 's', code: 'validation.markdownLink', path: 'body.ro' }]);
    });

    it('badPath_theManifestRefusesAStoryNamingAnUnknownPhoto', () => {
        const manifest = manifestOf(assembleManifest(content(result([['s', storyDoc()]])), TEST_CONFIG.errorEndpoint));
        const broken = { ...manifest, stories: manifest.stories?.map((story) => ({ ...story, photoIds: ['nobody'] })) };
        expect(validateManifest(broken).ok).toBe(false);
    });
});

describe('needsManifestBuild: stories', () => {
    it('happyPath_aListedStorysTextRebuilds', () => {
        expect(needsManifestBuild('story', storyDoc(), storyDoc({ body: { ro: 'Altfel.' } }))).toBe(true);
    });

    it('badPath_aWaitingStorysEditRebuildsNothing', () => {
        const waiting = storyDoc({ reviewStatus: 'pending', published: false });
        expect(needsManifestBuild('story', waiting, { ...waiting, title: { ro: 'Nou' } })).toBe(false);
    });
});

describe('planExport: stories (M17 §4)', () => {
    function exported(manifest: Manifest): Manifest {
        const plan = planExport({
            manifest,
            publicPrefix: 'https://storage.googleapis.com/demo-hcm-public/',
            engine: [],
            rasters: [],
            archives: [],
            kitPage: KIT_PAGE,
            kitReadme: '# Kit',
            madeAt: new Date('2026-11-08T08:00:00.000Z'),
        });
        const city = plan.entries.find((entry) => entry.name === 'city.json');
        return JSON.parse(city?.source.kind === 'text' ? city.source.text : '{}') as Manifest;
    }

    it('happyPath_theStoriesTravelWithTheExport @S-A100-HAPPY-EXPORT', () => {
        const manifest = manifestOf(assembleManifest(content(result([['s', storyDoc()]])), TEST_CONFIG.errorEndpoint));
        expect(exported(manifest).stories?.map((story) => [story.id, story.photoIds])).toEqual([['s', ['p1']]]);
    });

    it('badPath_aLinkToAPhotoTheExportLeavesOutGoes @S-A100-BAD-EXPORT', () => {
        const manifest = manifestOf(
            assembleManifest(content(result([['s', storyDoc({ photoIds: ['lost'] })]])), TEST_CONFIG.errorEndpoint),
        );
        const copy = exported(manifest);
        expect(copy.stories?.[0]?.photoIds).toBeUndefined();
        expect(validateManifest(copy).ok).toBe(true);
    });
});
