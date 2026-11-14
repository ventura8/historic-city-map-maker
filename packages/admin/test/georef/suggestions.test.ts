import { FIRESTORE_PATHS, type Gcp, type LayerVersionDoc } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';
import { describe, expect, it } from 'vitest';

import { GEOREF_MODULE } from '../../src/georef/georef.js';
import { confidenceLevel, suggestionsView, versionSuggestions } from '../../src/georef/suggestions.js';
import { createMapPreview } from '../../src/map/preview.js';
import { settle } from '../app/fakes.js';
import { factoryOf, host } from '../imagery/maps.js';
import { answer, CITY, callsOf, cityDoc, golden, imageryWorld, VERSIONS } from '../imagery/world.js';
import { fakeFrames } from '../map/support.js';
import { pair } from './fixtures.js';

const WAITING = 'imp-ds1105-075';
const SUGGESTED = golden('version.needs-gcps.suggestions.json');

function mapWorld() {
    const draw = new FakeMapDraw();
    const map = new FakeMap();
    map.view = { center: [26.1, 44.45], zoom: 13, bearing: 0 };
    const handle = { port: map, preview: createMapPreview(map, fakeFrames()), draw: () => Promise.resolve(draw), destroy: () => undefined };
    return { draw, map, maps: factoryOf([{ ok: true, map: handle }]) };
}

function setup(overrides: Parameters<typeof imageryWorld>[0] = {}, doc: Record<string, unknown> = SUGGESTED) {
    const world = imageryWorld(overrides);
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
    world.store.docs.set(VERSIONS(WAITING), doc);
    const georef = GEOREF_MODULE.create(world.services);
    georef.open([WAITING]);
    return { ...world, georef };
}

function pendingIds(georef: ReturnType<typeof setup>['georef']): readonly string[] {
    return georef.state.suggestions.pending.map((row) => `${row.label}:${row.pair.id}`);
}

describe('the georeferencer’s suggestions (M4 §2.5)', () => {
    it('happyPath_aVersionWaitingForPointsListsItsSuggestionsBestFirstWithTheirLevels @S-A44-HAPPY-CITY-GUARD', async () => {
        const { georef } = setup();
        await settle();

        const view = georef.state.suggestions;
        expect([view.matched, view.total, view.confident, view.selected, view.outsideCity]).toEqual([true, 4, '4', null, false]);
        expect(pendingIds(georef)).toEqual(['a1:a001', 'a2:a002', 'a3:a003', 'a4:a004']);
        expect(view.pending.map((row) => row.level)).toEqual(['medium', 'medium', 'low', 'low']);
        expect(georef.state.pairs).toEqual([]);
    });

    it('happyPath_acceptJoinsThePairsUnsavedAndAcceptAllTheRestTheFitFollows', async () => {
        const { georef } = setup();
        await settle();

        georef.intents.acceptSuggestion('a002');
        const one = { pairs: georef.state.pairs.map((gcp) => [gcp.id, gcp.origin, gcp.enabled]), dirty: georef.hasUnsavedChanges() };
        georef.intents.acceptAllSuggestions();

        expect(one).toEqual({ pairs: [['a002', 'auto', true]], dirty: true });
        expect(georef.state.pairs.map((gcp) => gcp.id)).toEqual(['a002', 'a001', 'a003', 'a004']);
        expect(georef.state.suggestions.pending).toEqual([]);
        expect(georef.state.fit.refusal).toBeNull();
        expect(georef.state.fit.missing).toEqual({ affine: 0, poly2: 2, tps: 6 });
    });

    it('badPath_aRejectedSuggestionIsNeverAcceptedNorSavedAndDiscardBringsTheAcceptedOnesBack', async () => {
        const { georef, callables } = setup();
        answer(callables, 'imagery.saveGcps', (request) => ({ jobId: request.versionId, versionId: request.versionId, resumed: true }));
        await settle();

        georef.intents.rejectSuggestion('a003');
        georef.intents.acceptAllSuggestions();
        georef.intents.selectSuggestion('a004');
        georef.intents.discard();
        const back = pendingIds(georef);
        georef.intents.acceptSuggestion('a003');
        georef.intents.acceptAllSuggestions();
        const saved = await georef.intents.save();

        expect(back).toEqual(['a1:a001', 'a2:a002', 'a4:a004']);
        expect(saved).toBe(true);
        const request = callsOf(callables, 'imagery.saveGcps')[0] as { gcps: Gcp[] };
        expect(request.gcps.map((gcp) => [gcp.id, gcp.origin, gcp.score])).toEqual([
            ['a001', 'auto', 0.58],
            ['a002', 'auto', 0.52],
            ['a004', 'auto', 0.33],
        ]);
        expect(request.gcps.some((gcp) => gcp.residualM !== undefined)).toBe(false);
    });

    it('happyPath_theSelectedSuggestionIsTheMapsAndThePanesAndAMovedAcceptedOneStaysDecided', async () => {
        const { map, maps } = mapWorld();
        const { georef } = setup({ maps });
        georef.intents.attachMap(host());
        await settle();

        georef.intents.selectSuggestion('a003');
        const selected = georef.state.suggestions.selected;
        georef.intents.acceptSuggestion('a001');
        georef.intents.movePixel('a001', { x: 10, y: 10 });

        expect(selected).toBe('a003');
        expect(pendingIds(georef)).toEqual(['a2:a002', 'a3:a003', 'a4:a004']);
        // Suggestions are canvas badges (§143), not POI vector overlays; selection lives on the state.
        expect(map.calls.filter((call) => call.method === 'addVectorOverlay')).toEqual([]);
        expect(georef.state.suggestions.pending.map((row) => row.pair.id)).toContain('a003');
        georef.intents.selectSuggestion(null);
        expect(georef.state.suggestions.selected).toBeNull();
    });

    it('badPath_aRevokedAdminAcceptsNothingAndClosingForgetsWhatWasRejected', async () => {
        const locked = setup({ readOnly: () => true });
        await settle();
        locked.georef.intents.acceptAllSuggestions();
        expect(locked.georef.state.pairs).toEqual([]);

        const { georef } = setup();
        await settle();
        georef.intents.rejectSuggestion('a001');
        georef.close();
        georef.open([WAITING]);
        await settle();

        expect(pendingIds(georef)).toHaveLength(4);
    });

    it('badPath_aVersionWithoutSuggestionsShowsNoPanelUnlessItWaitsAfterMatching', async () => {
        const plain = golden('version.awaiting-approval.json');
        const { georef } = setup({}, plain);
        await settle();
        expect(georef.state.suggestions.matched).toBe(false);

        const upload = { ...golden('version.needs-gcps.json'), error: { code: 'apiError.imagery.noMatch', params: { pairs: '0' } } };
        const plainScan = setup({}, upload);
        await settle();
        expect(plainScan.georef.state.suggestions.matched).toBe(false);

        const imported = { ...SUGGESTED, suggestions: undefined, error: { code: 'apiError.imagery.noMatch' } };
        const other = setup({}, imported);
        await settle();
        expect(other.georef.state.suggestions).toMatchObject({ matched: true, total: 0, confident: '0', pending: [], noSpread: false });

        const lined = { ...SUGGESTED, error: { code: 'apiError.imagery.noSpread', params: { pairs: '7' } } };
        const inALine = setup({}, lined);
        await settle();
        expect(inALine.georef.state.suggestions).toMatchObject({ matched: true, confident: '7', noSpread: true });
    });

    it('happyPath_aNewSnapshotWhileEditingKeepsTheEditAndRefreshesTheSuggestions', async () => {
        const { georef, store } = setup();
        await settle();
        georef.intents.acceptSuggestion('a001');
        const doc = { ...SUGGESTED, suggestions: { ...(SUGGESTED['suggestions'] as Record<string, unknown>), pairs: [] } };

        store.put(VERSIONS(WAITING), doc);
        await settle();

        expect(georef.state.pairs.map((gcp) => gcp.id)).toEqual(['a001']);
        expect(georef.state.suggestions.total).toBe(0);
    });
});

/** The golden suggestions moved about 18 km north-west of the test city, as the 1974 archive maps' were (`docs/LESSONS.md`). */
function lockedOutside(doc: Record<string, unknown>): Record<string, unknown> {
    const suggestions = doc['suggestions'] as { pairs: Gcp[] };
    const pairs = suggestions.pairs.map((gcp, index) => ({
        ...gcp,
        score: 0.98,
        geo: { lat: 44.7 + index * 0.005, lng: 25.7 + index * 0.02 },
    }));
    return { ...doc, suggestions: { ...suggestions, pairs } };
}

describe('the city guard (docs/LESSONS.md, the 1974 archive maps)', () => {
    it('badPath_suggestionsThatWouldPutTheMapOutsideTheCityAreDoubtfulAndAcceptAllTakesNone @S-A44-BAD-OUTSIDE-CITY', async () => {
        const { georef } = setup({}, lockedOutside(SUGGESTED));
        await settle();

        const view = georef.state.suggestions;
        expect([view.outsideCity, ...view.pending.map((row) => row.level)]).toEqual([true, 'doubtful', 'doubtful', 'doubtful', 'doubtful']);
        georef.intents.acceptAllSuggestions();
        expect(georef.state.pairs).toEqual([]);
        georef.intents.acceptSuggestion('a003');
        expect(georef.state.pairs.map((gcp) => gcp.id)).toEqual(['a003']);
    });
});

describe('the suggestions’ distances from the fit', () => {
    it('happyPath_eachSuggestionsDistanceIsFromThePagesCurrentFitAndFollowsIt', async () => {
        const { georef } = setup();
        await settle();
        expect(georef.state.suggestions.pending.map((row) => row.offsetM)).toEqual([null, null, null, null]);

        // Three accepted pairs make an affine fit: the last suggestion is measured against it, and again after each change.
        for (const id of ['a001', 'a002', 'a003']) {
            georef.intents.acceptSuggestion(id);
        }
        await settle();

        const [last] = georef.state.suggestions.pending;
        expect(last?.pair.id).toBe('a004');
        expect(last?.offsetM).toEqual(expect.any(Number));
        expect(last?.offsetM ?? -1).toBeGreaterThanOrEqual(0);
    });
});

describe('the suggestions’ pure parts', () => {
    it('happyPath_confidenceInWordsAndAnAlreadyPlacedSuggestionIsNotPending', () => {
        const doc = SUGGESTED as unknown as LayerVersionDoc;
        const source = versionSuggestions(doc);
        const placed = { ...pair('g1', 0, 0), pixel: { x: 10240.5, y: 4410.25 } };

        const view = suggestionsView(source, { pairs: [placed], fit: null, rejected: new Set(['a004']), selected: 'a004' });

        expect([confidenceLevel(0.6), confidenceLevel(0.45), confidenceLevel(0.44)]).toEqual(['high', 'medium', 'low']);
        const unscored = { ...pair('a9', 1, 1), origin: 'auto' as const };
        const lone = { matched: true, all: [unscored], confident: null, noSpread: false };
        expect(suggestionsView(lone, { pairs: [], fit: null, rejected: new Set(), selected: null }).pending[0]?.level).toBe('low');
        expect(view.pending.map((row) => row.label)).toEqual(['a2', 'a3']);
        expect(view.selected).toBeNull();
        expect(versionSuggestions({ ...doc, suggestions: undefined, error: undefined }).matched).toBe(false);
    });
});
