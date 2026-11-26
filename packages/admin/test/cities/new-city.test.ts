/**
 * The New city flow (`packages/admin/src/cities/new-city.ts`, M5-interfaces §1.6; behaviour A50): the name and the id
 * that follows it, a dragged rectangle with its problem, **Create the city** with the viewer token after it, a taken id
 * offered a free one, the map opened on the current city and the rectangle drawn on it.
 */
import { DEFAULT_NEW_CITY_LIMITS, FIRESTORE_PATHS, NEW_CITY_SEEDS } from '@hcm/shared';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { describe, expect, it } from 'vitest';

import { canCreate, CITIES_MODULE, LOCATE_AFTER_MS, type NewCityIntents } from '../../src/cities/new-city.js';
import type { AdminMapFactory, AdminMapHandle, AdminMapOptions } from '../../src/map/factory.js';
import { failure, settle } from '../app/fakes.js';
import { CITY, contentWorld } from '../content/world.js';
import { cityDoc } from '../layers/fixtures.js';

const VIEW = { center: [23.6, 46.77] as const, zoom: 12, bearing: 0 };
const SIZE = { width: 1000, height: 800 };

function fakeMaps() {
    const draw = new FakeMapDraw();
    const created: AdminMapOptions[] = [];
    const moves: unknown[] = [];
    const port = {
        getView: () => VIEW,
        flyTo: (view: unknown) => moves.push(['flyTo', view]),
        fitBounds: (bounds: unknown, options: unknown) => moves.push(['fitBounds', bounds, options]),
        destroy: () => undefined,
    };
    const handle = {
        port,
        preview: { show: () => undefined, preview: () => undefined, restore: () => undefined },
        draw: () => Promise.resolve(draw),
        destroy: () => undefined,
    } as unknown as AdminMapHandle;
    const maps: AdminMapFactory = {
        create: (_container, options) => {
            created.push(options);
            return Promise.resolve({ ok: true, map: handle });
        },
    };
    return { maps, draw, created, moves };
}

function world(withMap = true) {
    const fakes = fakeMaps();
    const tokens = { '--md-sys-color-primary': '#8b5e3c' };
    const theme = () => ({ light: tokens, dark: tokens, highContrastLight: tokens, highContrastDark: tokens });
    const content = contentWorld({ maps: withMap ? fakes.maps : null, theme });
    content.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
    const area = CITIES_MODULE.create(content.services);
    return { ...content, ...fakes, area };
}

/** A drawn map with a rectangle of about 0.17 by 0.11 degrees over Cluj. */
async function drawn(w: ReturnType<typeof world>): Promise<void> {
    w.area.intents.attachMap({} as HTMLElement);
    await settle();
    w.area.intents.dragArea({ x: 300, y: 300 }, { x: 700, y: 600 }, SIZE);
    await settle();
}

describe('the New city flow', () => {
    it('happyPath_aNameARectangleAndCreateMakeTheCity @S-A50-HAPPY', async () => {
        const w = world();
        w.callables.answer('cities.create', (request) => ({ created: true, cityId: request.cityId }));
        w.callables.answer('setup.rotatePublicToken', () => ({ tokenId: 'tok1', retiresOldAt: null, manifestQueued: false }));
        w.area.open(['new']);
        w.area.intents.setNameRo('Cluj-Napoca');
        await drawn(w);

        expect(w.area.state).toMatchObject({ cityId: 'cluj-napoca', problem: null, map: 'ready' });
        expect(canCreate(w.area.state)).toBe(true);
        expect(w.area.hasUnsavedChanges()).toBe(true);
        await expect(w.area.intents.create()).resolves.toBe(true);

        const request = w.callables.calls.find((call) => call.name === 'cities.create')?.request as Record<string, unknown>;
        expect(request).toMatchObject({ cityId: 'cluj-napoca', name: { ro: 'Cluj-Napoca' }, theme: { seedColor: NEW_CITY_SEEDS[0] } });
        expect(w.callables.calls.find((call) => call.name === 'setup.rotatePublicToken')?.request).toEqual({
            cityId: 'cluj-napoca',
            audience: 'viewer',
        });
        expect(w.area.state.created).toEqual({ cityId: 'cluj-napoca', name: 'Cluj-Napoca' });
        expect(w.area.hasUnsavedChanges()).toBe(false);
        expect(w.created[0]).toMatchObject({
            minZoom: 3,
            bounds: [
                [-180, -80],
                [180, 80],
            ],
        });
        expect(w.draw.mode).toBe('select');
        expect(w.draw.features[0]?.id).toBe('city-area');
    });

    it('happyPath_theEnglishNameAndATypedIdAreKeptAndAMovedCornerMovesTheRectangle', async () => {
        const w = world();
        w.area.intents.setNameRo('Bacău');
        w.area.intents.setId(' BACAU-ORAS ');
        w.area.intents.setNameRo('Bacău, pe Bistrița');
        w.area.intents.setNameEn('Bacau');
        await drawn(w);
        w.draw.emitChange([
            {
                id: 'city-area',
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [26.8, 46.5],
                            [27.0, 46.5],
                            [27.0, 46.6],
                            [26.8, 46.6],
                            [26.8, 46.5],
                        ],
                    ],
                },
            },
        ]);
        w.draw.emitChange([], false);

        expect(w.area.state).toMatchObject({ cityId: 'bacau-oras', idEdited: true, nameEn: 'Bacau', bounds: { west: 26.8, north: 46.6 } });
        w.callables.answer('cities.create', () => ({ created: true, cityId: 'bacau-oras' }));
        w.callables.fail('setup.rotatePublicToken', failure('failed-precondition', 'apiError.mapbox.notConfigured'));
        await expect(w.area.intents.create()).resolves.toBe(true);
        expect(w.callables.calls.find((call) => call.name === 'cities.create')?.request).toMatchObject({
            name: { ro: 'Bacău, pe Bistrița', en: 'Bacau' },
        });
    });

    it.each([
        ['too small', { west: 23.5, south: 46.7, east: 23.505, north: 46.8 }, 'validation.tooSmall'],
        ['too large', { west: 22, south: 46, east: 25, north: 47 }, 'validation.tooBig'],
        ['upside down', { west: 23.7, south: 46.7, east: 23.5, north: 46.8 }, 'validation.bounds'],
    ])('badPath_aRectangle%sWaitsWithItsReason @S-A50-BAD-AREA', async (_name, bounds, problem) => {
        const w = world();
        w.area.intents.setNameRo('Cluj');
        w.area.intents.setArea(bounds);

        expect(w.area.state.problem).toBe(problem);
        expect(canCreate(w.area.state)).toBe(false);
        await expect(w.area.intents.create()).resolves.toBe(false);
        expect(w.callables.named('cities.create')).toBe(0);
    });
});

describe('the New city flow, after the start page', () => {
    it('happyPath_whatTheStartPageWasToldFillsTheFormOnce', () => {
        const { area, services } = world();
        (services as { firstCity?: unknown }).firstCity = {
            id: 'bacau',
            name: { ro: 'Bacău', en: 'Bacau' },
            bounds: { west: 26.85, south: 46.5, east: 26.98, north: 46.62 },
        };
        area.open([]);
        expect(area.state).toMatchObject({ nameRo: 'Bacău', nameEn: 'Bacau', cityId: 'bacau', bounds: { west: 26.85 } });
        area.intents.startOver();
        area.open([]);
        expect(area.state.nameRo).toBe('');
    });

    const FIRST = { id: 'bacau', name: { ro: 'Bacău' }, bounds: { west: 26.85, south: 46.5, east: 26.98, north: 46.62 } };

    it('badPath_aFirstCityThatExistsIsNotOfferedAgain', async () => {
        const { area, services, callables, clock } = world();
        Object.assign(services, { firstCity: { id: 'bacau', name: { ro: 'Bacău' } }, adminCityIds: () => ['bacau'] });
        area.open([]);
        expect(area.state).toMatchObject({ nameRo: '', cityId: '' });
        expect(area.hasUnsavedChanges()).toBe(false);
        clock.advance(LOCATE_AFTER_MS);
        await settle();
        expect(callables.named('cities.locate')).toBe(0);
    });

    it('happyPath_aFilledFormNobodyTouchedHasNothingToLose', () => {
        const { area, services } = world();
        Object.assign(services, { firstCity: FIRST });
        area.open([]);
        expect(area.state.nameRo).toBe('Bacău');
        expect(area.hasUnsavedChanges()).toBe(false);
        area.intents.setNameEn('Bacau');
        expect(area.hasUnsavedChanges()).toBe(true);
    });

    it.each([
        [
            'the name',
            (intents: NewCityIntents) => {
                intents.setNameRo('Altul');
            },
        ],
        [
            'the id',
            (intents: NewCityIntents) => {
                intents.setId('altul');
            },
        ],
        [
            'the rectangle',
            (intents: NewCityIntents) => {
                intents.setArea({ west: 23.5, south: 46.72, east: 23.7, north: 46.82 });
            },
        ],
    ])('happyPath_theOwnersChangeOf_%s_isTheirs', (_what, change) => {
        const { area, services } = world();
        Object.assign(services, { firstCity: FIRST });
        area.open([]);
        change(area.intents);
        expect(area.hasUnsavedChanges()).toBe(true);
    });

    it('happyPath_withoutARectangleTheNameLooksForIt', () => {
        const { area, services } = world();
        (services as { firstCity?: unknown }).firstCity = { id: 'bacau', name: { ro: 'Bacău' } };
        area.open([]);
        expect(area.state).toMatchObject({ nameRo: 'Bacău', nameEn: '', cityId: 'bacau', bounds: null });
    });
});

describe('the New city flow: refusals and starting over', () => {
    it('badPath_aTakenIdIsReplacedByTheFreeOneOffered @S-A50-BAD-ID-TAKEN', async () => {
        const w = world();
        w.callables.fail('cities.create', failure('already-exists', 'apiError.city.idTaken', { cityId: 'cluj', suggestion: 'cluj-2' }));
        w.area.intents.setNameRo('Cluj');
        w.area.intents.setArea({ west: 23.5, south: 46.72, east: 23.7, north: 46.82 });

        await expect(w.area.intents.create()).resolves.toBe(false);

        expect(w.area.state).toMatchObject({ cityId: 'cluj-2', idEdited: true, busy: false, error: { key: 'apiError.city.idTaken' } });
        w.callables.fail('cities.create', failure('permission-denied', 'apiError.city.notProjectOwner'));
        await w.area.intents.create();
        expect(w.area.state).toMatchObject({ cityId: 'cluj-2', error: { key: 'apiError.city.notProjectOwner' } });
    });

    it('badPath_noMapNoNameOrAnIdTheSchemaRefusesCreatesNothing', async () => {
        const w = world(false);
        w.area.intents.attachMap({} as HTMLElement);
        await settle();
        w.area.intents.dragArea({ x: 0, y: 0 }, { x: 10, y: 10 }, SIZE);
        expect([w.area.state.map, w.area.state.bounds]).toEqual(['failed', null]);

        w.area.intents.setArea({ west: 23.5, south: 46.72, east: 23.7, north: 46.82 });
        await expect(w.area.intents.create()).resolves.toBe(false);
        w.area.intents.setNameRo('Cluj');
        w.area.intents.setId('engine');
        await expect(w.area.intents.create()).resolves.toBe(false);

        expect(w.area.state.error).toEqual({ key: 'apiError.invalidRequest' });
        expect(w.callables.named('cities.create')).toBe(0);
    });

    it('happyPath_anotherCityStartsOverAndTheMapGoesWithThePage', async () => {
        const w = world();
        w.area.intents.setNameRo('Cluj');
        await drawn(w);
        w.area.intents.startOver();
        await settle();

        expect(w.area.state).toMatchObject({ nameRo: '', bounds: null, map: 'ready', seed: NEW_CITY_SEEDS[0] });
        expect(w.draw.features).toEqual([]);
        w.area.close();
        w.area.destroy();
        expect([w.area.state.map, w.area.hasUnsavedChanges(), CITIES_MODULE.area]).toEqual(['none', false, 'cities']);
        expect(w.area.subscribe(() => undefined)).toBeTypeOf('function');
    });

    it.each([
        ['missing', undefined],
        ['that no longer passes its schema', { name: 42 }],
    ])('badPath_aCurrentCity%sOpensTheMapOnTheFallbackView', async (_name, doc) => {
        const w = world();
        if (doc === undefined) {
            w.store.docs.delete(FIRESTORE_PATHS.city(CITY));
        } else {
            w.store.docs.set(FIRESTORE_PATHS.city(CITY), doc);
        }
        w.area.intents.attachMap({} as HTMLElement);
        await settle();

        expect(w.created.at(-1)?.view).toEqual({ center: [15, 48], zoom: 4, bearing: 0 });
        expect(DEFAULT_NEW_CITY_LIMITS.rasterJobsPerDay).toBe(3);
    });
});

/** The rectangle the server's `cities.locate` answers for Cluj (`cityAreaAround` of its OpenStreetMap box). */
const FOUND = { west: 23.4846, south: 46.7181, east: 23.6919, north: 46.8167 };

describe('the New city flow: the city found by its name', () => {
    it('happyPath_theNameThatRestsFindsTheCityItsRectangleDrawnAndFlownTo @S-A50-HAPPY', async () => {
        // docs/LESSONS.md 252: two inputs, the name and Create, wherever the map opened.
        const w = world();
        w.callables.answer('cities.locate', () => ({ bounds: FOUND, place: 'Cluj-Napoca, Cluj, România' }));
        w.area.intents.attachMap({} as HTMLElement);
        await settle();
        for (const typed of ['C', 'Cl', 'Cluj']) {
            w.area.intents.setNameRo(typed);
        }

        w.clock.advance(LOCATE_AFTER_MS);
        await settle();

        expect(w.callables.calls.filter((call) => call.name === 'cities.locate').map((call) => call.request)).toEqual([{ name: 'Cluj' }]);
        expect(w.area.state).toMatchObject({ bounds: FOUND, problem: null, located: 'Cluj-Napoca, Cluj, România' });
        expect(canCreate(w.area.state)).toBe(true);
        expect(w.moves).toEqual([
            [
                'fitBounds',
                [
                    [FOUND.west, FOUND.south],
                    [FOUND.east, FOUND.north],
                ],
                { padding: 24 },
            ],
        ]);
        expect(w.draw.features[0]?.id).toBe('city-area');

        // Another name moves the found rectangle with it; nothing found leaves the last one; the name stays what it is.
        w.callables.answer('cities.locate', () => ({ bounds: null }));
        w.area.intents.setNameRo('Clujul meu');
        w.clock.advance(LOCATE_AFTER_MS);
        await settle();
        expect(w.area.state).toMatchObject({ bounds: FOUND, located: 'Cluj-Napoca, Cluj, România' });
        w.callables.answer('cities.locate', () => ({ bounds: FOUND }));
        w.area.intents.setNameRo('Cluj');
        w.clock.advance(LOCATE_AFTER_MS);
        await settle();
        expect(w.area.state.located).toBe('Cluj');
    });

    it('badPath_aRectangleOfTheAdminsOwnIsNeverReplaced', async () => {
        const w = world();
        w.callables.answer('cities.locate', () => ({ bounds: FOUND, place: 'Cluj-Napoca' }));
        w.area.intents.setNameRo('Cluj');
        await drawn(w);
        const own = w.area.state.bounds;

        w.clock.advance(LOCATE_AFTER_MS);
        await settle();

        expect(w.callables.named('cities.locate')).toBe(0);
        expect(w.area.state).toMatchObject({ bounds: own, located: null });
    });

    it('badPath_aRectangleDrawnWhileTheAnswerCameKeepsItAndSoDoesANameChanged', async () => {
        const w = world();
        w.callables.answer('cities.locate', () => ({ bounds: FOUND, place: 'Cluj-Napoca' }));
        w.area.intents.setNameRo('Cluj');
        w.clock.advance(LOCATE_AFTER_MS);
        w.area.intents.setNameRo('Cluj-Napoca');
        await settle();
        expect(w.area.state.bounds).toBeNull();

        w.clock.advance(LOCATE_AFTER_MS);
        w.area.intents.setArea({ west: 23.5, south: 46.72, east: 23.7, north: 46.82 });
        await settle();
        expect(w.area.state).toMatchObject({ bounds: { west: 23.5 }, located: null });
    });

    it('badPath_nothingFoundAFailureAnEmptyNameOrAClosedPageDrawNothing @S-A50-BAD-NOT-FOUND', async () => {
        const w = world();
        w.callables.answer('cities.locate', () => ({ bounds: null }));
        w.area.intents.setNameRo('Turda E2E');
        w.clock.advance(LOCATE_AFTER_MS);
        await settle();
        w.callables.fail('cities.locate', failure('permission-denied', 'apiError.city.notProjectOwner'));
        w.area.intents.setNameRo('Turda');
        w.clock.advance(LOCATE_AFTER_MS);
        await settle();
        w.area.intents.setNameRo('   ');
        w.clock.advance(LOCATE_AFTER_MS);
        w.area.intents.setNameRo('Cluj');
        w.area.close();
        w.clock.advance(LOCATE_AFTER_MS);
        await settle();

        expect(w.callables.calls.filter((call) => call.name === 'cities.locate').map((call) => call.request)).toEqual([
            { name: 'Turda E2E' },
            { name: 'Turda' },
        ]);
        expect(w.area.state).toMatchObject({ bounds: null, located: null, error: null });
    });

    it('badPath_noLookUpOnceTheCityExists', async () => {
        const w = world();
        w.callables.answer('cities.create', (request) => ({ created: true, cityId: request.cityId }));
        w.callables.answer('setup.rotatePublicToken', () => ({ tokenId: 'tok1', retiresOldAt: null, manifestQueued: false }));
        w.area.intents.setNameRo('Cluj');
        w.area.intents.setArea({ west: 23.5, south: 46.72, east: 23.7, north: 46.82 });
        w.area.intents.setArea(null);
        await expect(w.area.intents.create()).resolves.toBe(false);
        w.area.intents.setArea({ west: 23.5, south: 46.72, east: 23.7, north: 46.82 });
        await expect(w.area.intents.create()).resolves.toBe(true);

        w.clock.advance(LOCATE_AFTER_MS);
        await settle();

        expect(w.callables.named('cities.locate')).toBe(0);
    });
});

describe('the New city flow: the id and the map', () => {
    it('happyPath_anEmptiedIdTakesTheNamesSuggestionAgain', () => {
        const w = world();
        w.area.intents.setNameRo('Cluj');
        w.area.intents.setId('mine');
        expect(w.area.state).toMatchObject({ cityId: 'mine', idEdited: true });

        w.area.intents.setId('  ');

        expect(w.area.state).toMatchObject({ cityId: 'cluj', idEdited: false });
    });

    it('badPath_anIdNoCityMayTakeKeepsCreateOff @S-A50-BAD-ID-INVALID', () => {
        for (const cityId of ['engine', 'cluj napoca', 'bacău', 'x']) {
            expect(canCreate({ nameRo: 'Cluj', cityId, bounds: FOUND, problem: null, busy: false })).toBe(false);
        }
        expect(canCreate({ nameRo: 'Cluj', cityId: 'cluj', bounds: FOUND, problem: null, busy: false })).toBe(true);
    });

    it('happyPath_theZoomButtonsMoveTheMap', async () => {
        const w = world();
        w.area.intents.zoomBy(1);
        w.area.intents.attachMap({} as HTMLElement);
        await settle();

        w.area.intents.zoomBy(-1);

        expect(w.moves).toEqual([['flyTo', { zoom: VIEW.zoom - 1 }]]);
    });
});
