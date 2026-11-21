import { describe, expect, it } from 'vitest';

import {
    LAYER_DELETE_GRACE_DAYS,
    freeOverlayId,
    layerDeleteParamsSchema,
    layerDeleteRequestSchema,
    layerDeleteResponseSchema,
    layerLinkRequestSchema,
    layerSourceRefusal,
    sourceOrigins,
    tilesetOwnerOf,
} from '../../src/api/layers.js';
import { CALLABLES } from '../../src/api/callables.js';
import { CLIENT_JOB_TYPES, JOB_TYPES } from '../../src/schemas/firestore-ops.js';
import type { LayerSource } from '../../src/schemas/manifest.js';

const XYZ = (template: string): LayerSource => ({ type: 'xyz', tiles: [template], tileSize: 256 });

const LINK = {
    cityId: 'bucharest',
    source: { type: 'mapbox', tilesetId: 'e2e-user.plan-1911' },
    label: { ro: 'Planul 1911' },
    year: 1911,
    kind: 'map',
};

describe('layers.delete', () => {
    it('happyPath_aLayerOfACityAndTheWaitingJob', () => {
        expect(layerDeleteRequestSchema.safeParse({ cityId: 'bucharest', layerId: 'corona-1968' }).success).toBe(true);
        expect(layerDeleteResponseSchema.safeParse({ jobId: 'j1', runsAt: '2026-10-24T08:30:00.000Z' }).success).toBe(true);
        expect(layerDeleteParamsSchema.safeParse({ layerId: 'corona-1968', tilesetId: 'e2e-user.corona' }).success).toBe(true);
        expect(LAYER_DELETE_GRACE_DAYS).toBe(7);
    });

    it('badPath_aLayerIdOutsideTheIdPatternIsRefused', () => {
        expect(layerDeleteRequestSchema.safeParse({ cityId: 'bucharest', layerId: '../photos' }).success).toBe(false);
        expect(layerDeleteParamsSchema.safeParse({ layerId: 'l1', extra: true }).success).toBe(false);
    });

    it('badPath_onlyTheServerQueuesALayerDelete', () => {
        expect(JOB_TYPES).toContain('layer-delete');
        expect(CLIENT_JOB_TYPES).not.toContain('layer-delete');
        expect(CALLABLES['layers.delete']).toMatchObject({ access: 'cityEditor', appCheck: 'consume' });
    });
});

describe('layers.link', () => {
    it('happyPath_aMapboxTilesetOrAnXyzTemplate', () => {
        expect(layerLinkRequestSchema.safeParse(LINK).success).toBe(true);
        const xyz = { ...LINK, source: XYZ('https://tiles.example.test/plan/{z}/{x}/{y}.png'), minzoom: 10, maxzoom: 18 };
        expect(layerLinkRequestSchema.safeParse(xyz).success).toBe(true);
    });

    it('badPath_aPmtilesArchiveAnHttpTemplateOrCrossedZoomsAreRefused', () => {
        const pmtiles = { ...LINK, source: { type: 'pmtiles', url: 'https://tiles.example.test/plan.pmtiles' } };
        const http = { ...LINK, source: XYZ('http://tiles.example.test/{z}/{x}/{y}.png') };
        const placeholders = { ...LINK, source: XYZ('https://tiles.example.test/{z}/{x}.png') };
        const zooms = { ...LINK, minzoom: 16, maxzoom: 12 };

        for (const request of [pmtiles, http, placeholders, zooms]) {
            expect(layerLinkRequestSchema.safeParse(request).success).toBe(false);
        }
    });
});

describe('what a source may link to', () => {
    it('happyPath_theCitysOwnTilesetAndAPlainTileServer', () => {
        expect(layerSourceRefusal({ type: 'mapbox', tilesetId: 'e2e-user.plan-1911' }, 'e2e-user')).toBeNull();
        expect(layerSourceRefusal(XYZ('https://tiles.example.test/{z}/{x}/{y}.png'), null)).toBeNull();
        expect(layerSourceRefusal(XYZ('https://api.mapbox.com/v4/e2e-user.plan/{z}/{x}/{y}.png'), 'e2e-user')).toBeNull();
    });

    it.each([
        ['anotheraccount.plan', 'anotheraccount'],
        ['mapbox.satellite', 'mapbox'],
        ['other-user.private', 'other-user'],
    ])('badPath_anotherAccountsTileset_%s', (tilesetId, owner) => {
        expect(layerSourceRefusal({ type: 'mapbox', tilesetId }, 'e2e-user')).toEqual({
            code: 'apiError.layers.foreignTileset',
            params: { owner },
        });
    });

    it.each([
        'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.png',
        'https://a.tiles.mapbox.com/v4/anotheraccount.plan/{z}/{x}/{y}.png',
        'https://api.mapbox.com/v4/mapbox%2Esatellite/{z}/{x}/{y}.png',
    ])('badPath_aTileAddressOfAnotherAccountsTileset_%s', (template) => {
        expect(layerSourceRefusal(XYZ(template), 'e2e-user')?.code).toBe('apiError.layers.foreignTileset');
    });

    it.each([
        'https://tiles.example.test/{z}/{x}/{y}.png?access_token=abc',
        'https://tiles.example.test/{z}/{x}/{y}.png?key=abc',
        'https://tiles.example.test/sk.TEST-not-a-token-000000/{z}/{x}/{y}.png',
    ])('badPath_aCredentialInTheAddressIsNeverPublished_%s', (template) => {
        expect(layerSourceRefusal(XYZ(template), 'e2e-user')).toEqual({ code: 'apiError.layers.secretInAddress' });
    });

    it('badPath_aMapboxTilesetBeforeMapboxIsSetUp', () => {
        expect(layerSourceRefusal({ type: 'mapbox', tilesetId: 'e2e-user.plan' }, null)).toEqual({ code: 'apiError.mapbox.notConfigured' });
    });

    it('happyPath_theOwnerOfEachKindOfSource', () => {
        expect(tilesetOwnerOf({ type: 'mapbox', tilesetId: 'e2e-user.plan' })).toBe('e2e-user');
        expect(tilesetOwnerOf({ type: 'pmtiles', url: 'https://api.mapbox.com/v4/e2e-user.plan.json' })).toBe('e2e-user');
        expect(tilesetOwnerOf({ type: 'pmtiles', url: 'archives/plan.pmtiles' })).toBeNull();
        expect(tilesetOwnerOf(XYZ('https://api.mapbox.com/styles/v1/e2e-user/plan/{z}/{x}/{y}'))).toBeNull();
        expect(tilesetOwnerOf(XYZ('https://api.mapbox.com/v4/%E0%A4%A/{z}/{x}/{y}.png'))).toBeNull();
    });

    it('happyPath_theOriginsTheSitesMustAllow', () => {
        const source: LayerSource = {
            type: 'xyz',
            tiles: [
                'https://a.tiles.example.test/{z}/{x}/{y}.png',
                'https://b.tiles.example.test/{z}/{x}/{y}.png',
                'https://a.tiles.example.test/2/{z}/{x}/{y}.png',
            ],
            tileSize: 512,
        };

        expect(sourceOrigins(source)).toEqual(['https://a.tiles.example.test', 'https://b.tiles.example.test']);
        expect(sourceOrigins({ type: 'mapbox', tilesetId: 'e2e-user.plan' })).toEqual([]);
        expect(sourceOrigins({ type: 'pmtiles', url: 'https://archive.example.test/plan.pmtiles' })).toEqual([
            'https://archive.example.test',
        ]);
        expect(sourceOrigins(XYZ('https://api.mapbox.com/v4/e2e-user.plan/{z}/{x}/{y}.png'))).toEqual([]);
    });
});

describe('the overlay namespace', () => {
    it('happyPath_theSlugOfTheRomanianLabel', () => {
        expect(freeOverlayId('Clădiri dispărute', new Set(), 'category')).toBe('cladiri-disparute');
    });

    it('badPath_photosALayerOrAnotherCategoryGetASuffix', () => {
        expect(freeOverlayId('Photos', new Set(), 'category')).toBe('photos-2');
        expect(freeOverlayId('Planul 1911', new Set(['planul-1911', 'planul-1911-2']), 'layer')).toBe('planul-1911-3');
    });

    it('badPath_aLabelWithoutLettersOrDigitsTakesTheFallback', () => {
        expect(freeOverlayId('—', new Set(['layer']), 'layer')).toBe('layer-2');
    });

    it('badPath_aLongLabelStaysWithinTheIdLength', () => {
        const long = 'Un nume foarte lung pentru o categorie de locuri istorice';
        const first = freeOverlayId(long, new Set(), 'category');
        const second = freeOverlayId(long, new Set([first]), 'category');

        expect(first.length).toBeLessThanOrEqual(40);
        expect(second.length).toBeLessThanOrEqual(40);
        expect(second).toMatch(/-2$/);
    });
});
