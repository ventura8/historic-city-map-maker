/**
 * `layers.link` (`functions/src/layers/link.ts`, M2c §8.1, CR-M2c-27): a ready, unpublished layer on top of the others,
 * its id free in the overlay namespace; a tileset of another account, a credential in a tile address or a source
 * already linked writes nothing.
 */
import { FIRESTORE_PATHS, layerDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { layerLinkFunction } from '../../src/layers/link.js';
import { failureOf } from '../admin/world.js';
import { adminCall, contentDeps, type ContentDeps } from '../publish/fakes.js';
import { CITY, MAPBOX_USER, seedCategory, seedCity, seedLayer } from './world.js';

const NOW = '2026-10-17T08:30:00.000Z';

const TILESET = { type: 'mapbox', tilesetId: `${MAPBOX_USER}.plan-1911` } as const;
const XYZ = { type: 'xyz', tiles: ['https://tiles.example.test/plan/{z}/{x}/{y}.png'], tileSize: 256 } as const;

function link(deps: ContentDeps, overrides: Record<string, unknown> = {}) {
    const data = { cityId: CITY, source: TILESET, label: { ro: 'Planul 1911', en: '1911 plan' }, year: 1911, kind: 'map', ...overrides };
    return layerLinkFunction(() => deps).run(adminCall(data));
}

describe('layers.link', () => {
    it('happyPath_theCitysTilesetBecomesAReadyUnpublishedLayerOnTop @S-A15-HAPPY-LINKED', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        await seedLayer(deps, 'corona-1968', { order: 4 });

        const response = await link(deps, { attribution: 'Arhiva municipiului', minzoom: 12, maxzoom: 19 });

        expect(response).toEqual({ layerId: 'planul-1911' });
        await expect(deps.documents.get(FIRESTORE_PATHS.layer(CITY, 'planul-1911'), layerDocSchema)).resolves.toEqual({
            year: 1911,
            label: { ro: 'Planul 1911', en: '1911 plan' },
            kind: 'map',
            attribution: 'Arhiva municipiului',
            source: TILESET,
            minzoom: 12,
            maxzoom: 19,
            order: 5,
            opacity: 1,
            defaultVisible: false,
            status: 'ready',
            published: false,
            createdAt: timestampFromDate(new Date(NOW)),
            updatedBy: 'u-admin',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
    });

    it('happyPath_aTileServerOfTheFirstLayerWithDefaultZooms', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);

        await link(deps, { source: XYZ, bounds: { west: 26, south: 44.4, east: 26.2, north: 44.5 } });

        await expect(deps.documents.get(FIRESTORE_PATHS.layer(CITY, 'planul-1911'), layerDocSchema)).resolves.toMatchObject({
            source: XYZ,
            minzoom: 0,
            maxzoom: 22,
            order: 0,
            bounds: { west: 26, south: 44.4, east: 26.2, north: 44.5 },
        });
    });

    it('badPath_anIdTakenByALayerACategoryOrThePhotosGetsASuffix', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        await seedLayer(deps, 'planul-1911', { source: { type: 'mapbox', tilesetId: `${MAPBOX_USER}.other` } });
        await seedCategory(deps, 'planul-1911-2');
        deps.documents.seed(FIRESTORE_PATHS.poiCategory(CITY, 'planul-1911-3'), { label: 'not a category' });

        const clash = await link(deps);
        const photos = await link(deps, { source: XYZ, label: { ro: 'Photos' } });

        expect(clash).toEqual({ layerId: 'planul-1911-4' });
        expect(photos).toEqual({ layerId: 'photos-2' });
    });

    it.each([
        ['anotheraccount.plan', 'anotheraccount'],
        ['mapbox.satellite', 'mapbox'],
        ['other-user.private', 'other-user'],
    ])('badPath_anotherAccountsTilesetIsRefused_%s', async (tilesetId, owner) => {
        const deps = contentDeps(NOW);
        await seedCity(deps);

        const failure = await failureOf(link(deps, { source: { type: 'mapbox', tilesetId } }));

        expect(failure).toMatchObject({
            code: 'permission-denied',
            details: { code: 'apiError.layers.foreignTileset', params: { owner } },
        });
        expect(deps.documents.paths(FIRESTORE_PATHS.layers(CITY))).toEqual([]);
    });

    it('badPath_anotherCitysPipelineTilesetIsRefused @S-A15-BAD-OTHER-CITY-TILESET', async () => {
        // docs/LESSONS.md 244: every city shares the project's Mapbox account, and a pipeline tileset's name follows from
        // public USGS metadata (`hcm-<city>-<layer>`); only a layer of the same city may name it.
        const deps = contentDeps(NOW);
        await seedCity(deps);
        const otherCitys = { type: 'mapbox', tilesetId: `${MAPBOX_USER}.hcm-cluj-kh-4-1965` } as const;

        const failure = await failureOf(link(deps, { source: otherCitys }));

        expect(failure).toMatchObject({ code: 'permission-denied', details: { code: 'apiError.layers.otherCityTileset' } });
        expect(deps.documents.paths(FIRESTORE_PATHS.layers(CITY))).toEqual([]);
    });

    it('badPath_theCitysOwnPipelineTilesetIsItsLayersAlready', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        const own = { type: 'mapbox', tilesetId: `${MAPBOX_USER}.hcm-${CITY}-kh-4-1965` } as const;
        await seedLayer(deps, 'kh-4-1965', { label: { ro: 'KH-4 1965' }, source: own, mapbox: { tilesetId: own.tilesetId } });

        const failure = await failureOf(link(deps, { source: own }));

        expect(failure).toMatchObject({ details: { code: 'apiError.layers.alreadyLinked', params: { layer: 'KH-4 1965' } } });
    });

    it('badPath_aCredentialInATileAddressIsNeverPublished @S-A15-BAD-SECRET-IN-ADDRESS', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        const source = { ...XYZ, tiles: ['https://tiles.example.test/{z}/{x}/{y}.png?access_token=generated-test-value'] };

        const failure = await failureOf(link(deps, { source }));

        expect(failure).toMatchObject({ code: 'invalid-argument', details: { code: 'apiError.layers.secretInAddress' } });
        expect(deps.documents.paths(FIRESTORE_PATHS.layers(CITY))).toEqual([]);
    });

    it('badPath_aSourceAnotherLayerShowsIsAlreadyLinked', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);
        await seedLayer(deps, 'plan', { label: { ro: 'Plan vechi' }, source: TILESET });

        const failure = await failureOf(link(deps));

        expect(failure).toMatchObject({
            code: 'already-exists',
            details: { code: 'apiError.layers.alreadyLinked', params: { layer: 'Plan vechi' } },
        });
    });

    it('badPath_aTilesetBeforeMapboxIsSetUpOrAMissingCity', async () => {
        const deps = contentDeps(NOW);

        const noCity = await failureOf(link(deps));
        await seedCity(deps, { mapbox: undefined });
        const noMapbox = await failureOf(link(deps));
        const xyz = await link(deps, { source: XYZ });

        expect(noCity).toMatchObject({ code: 'not-found', details: { code: 'apiError.notFound' } });
        expect(noMapbox).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.mapbox.notConfigured' } });
        expect(xyz).toEqual({ layerId: 'planul-1911' });
    });

    it('badPath_anHttpTemplateOrCrossedZoomsAreAnInvalidRequest', async () => {
        const deps = contentDeps(NOW);
        await seedCity(deps);

        const http = await failureOf(link(deps, { source: { ...XYZ, tiles: ['http://tiles.example.test/{z}/{x}/{y}.png'] } }));
        const zooms = await failureOf(link(deps, { minzoom: 18, maxzoom: 12 }));

        expect(http).toMatchObject({ details: { code: 'apiError.invalidRequest' } });
        expect(zooms).toMatchObject({ details: { code: 'apiError.invalidRequest' } });
    });
});
