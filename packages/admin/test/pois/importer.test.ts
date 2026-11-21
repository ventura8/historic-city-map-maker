import { FIRESTORE_PATHS, MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { Importer, type ImporterDeps, type ImportFile, type ImportState } from '../../src/pois/importer.js';
import type { PoiValue } from '../../src/pois/model.js';
import { settle } from '../app/fakes.js';
import { CITY, POINT, poisWorld, type PoisWorld } from './world.js';

const LIMITS = {
    limits: [
        [25.5, 43.8],
        [26.8, 45.05],
    ],
    maxVertices: MAX_GEOMETRY_VERTICES,
    maxRings: MAX_POLYGON_RINGS,
} as const;

function file(content: string | Error, size = 100, name = 'locuri.geojson'): ImportFile {
    return { name, size, text: () => (content instanceof Error ? Promise.reject(content) : Promise.resolve(content)) };
}

function collection(count: number, extra: Record<string, unknown> = {}): string {
    const features = Array.from({ length: count }, (_unused, index) => ({
        type: 'Feature',
        geometry: POINT,
        properties: { category: 'biserici', title: `Loc ${String(index)}`, yearStart: 1890, ...extra },
    }));
    return JSON.stringify({ type: 'FeatureCollection', features });
}

function importer(
    world: PoisWorld,
    existing = new Map<string, PoiValue>(),
): { readonly importer: Importer; readonly states: (ImportState | null)[] } {
    const states: (ImportState | null)[] = [];
    const subject = new Importer({
        store: world.store,
        clock: world.clock,
        cityId: CITY,
        context: () => ({ limits: LIMITS, categories: new Set(['biserici', 'parcuri']) }),
        places: () => Promise.resolve({ places: [...existing].map(([id, value]) => ({ id, value })), unreadable: [] }),
        changed: (state) => states.push(state),
    });
    return { importer: subject, states };
}

describe('the import dialog', () => {
    it('happyPath_aFileIsPreviewedThenWrittenInBatches', async () => {
        const world = poisWorld();
        const { importer: subject, states } = importer(world);

        await subject.choose(file(collection(501)), null);
        expect(subject.state).toMatchObject({ status: 'preview', fileName: 'locuri.geojson', refusal: null, written: 0 });
        expect(subject.state?.plan?.created).toHaveLength(501);
        expect(world.store.writes).toEqual([]);
        await subject.commit();

        expect(world.store.writes.map((write) => (write.kind === 'batch' ? write.writes.length : 0))).toEqual([500, 1]);
        expect(subject.state).toMatchObject({ status: 'done', written: 501 });
        expect(states.map((state) => state?.status)).toEqual(['reading', 'preview', 'writing', 'writing', 'writing', 'done']);
        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, 'new-1'))).toMatchObject({ title: { ro: 'Loc 0' }, createdBy: 'admin-uid' });
    });

    it('happyPath_updatesAreWrittenToTheirPlace', async () => {
        const world = poisWorld();
        const existing = new Map<string, PoiValue>([
            ['stavropoleos', { category: 'biserici', geometry: POINT, title: { ro: 'Vechi' }, links: [], photoIds: [], published: true }],
        ]);
        const { importer: subject } = importer(world, existing);
        const text = JSON.stringify({
            type: 'Feature',
            id: 'stavropoleos',
            geometry: POINT,
            properties: { category: 'biserici', title: 'Nou', yearStart: 1890 },
        });

        await subject.choose(file(text), null);
        await subject.commit();

        const write = world.store.writes[0];
        expect(write?.kind === 'batch' ? write.writes[0] : null).toMatchObject({
            kind: 'update',
            path: FIRESTORE_PATHS.poi(CITY, 'stavropoleos'),
        });
    });

    it('happyPath_theCategoryForUncategorisedFeaturesPlansAgain', async () => {
        const world = poisWorld();
        const { importer: subject } = importer(world);
        await subject.choose(file(collection(2, { category: 'nimic' })), null);
        expect(subject.state?.plan?.refused).toHaveLength(2);

        subject.setCategory('parcuri');

        expect(subject.state).toMatchObject({ fallbackCategory: 'parcuri' });
        expect(subject.state?.plan?.created.map((place) => place.value.category)).toEqual(['parcuri', 'parcuri']);
        expect(subject.state?.plan?.uncategorised).toBe(2);
    });

    it('badPath_aFileChosenBeforeTheCategoriesArrivedIsPlannedAgainOnceTheyDo', async () => {
        const world = poisWorld();
        let categories: ReadonlySet<string> | null = null;
        const subject = new Importer({
            store: world.store,
            clock: world.clock,
            cityId: CITY,
            context: () => ({ limits: LIMITS, categories }),
            places: () => Promise.resolve({ places: [], unreadable: [] }),
            changed: () => undefined,
        });
        subject.contextChanged();
        await subject.choose(file(collection(2)), null);
        const before = subject.state?.plan?.created.length;

        categories = new Set(['biserici']);
        subject.contextChanged();

        expect([before, subject.state?.plan?.created.length]).toEqual([0, 2]);
    });

    it('badPath_aFileTooBigNotGeoJsonOrUnreadableIsRefusedBeforeAnyWrite', async () => {
        const world = poisWorld();
        const { importer: subject } = importer(world);

        await subject.choose(file('{}', 6 * 1024 * 1024), null);
        expect(subject.state).toMatchObject({ status: 'refused', refusal: 'too-big' });
        await subject.choose(file('<kml/>'), null);
        expect(subject.state).toMatchObject({ status: 'refused', refusal: 'not-geojson' });
        await subject.choose(file(new Error('read failed')), null);
        expect(subject.state).toMatchObject({ status: 'refused', refusal: 'unreadable' });
        subject.setCategory('parcuri');
        await subject.commit();

        expect(subject.state?.fallbackCategory).toBeNull();
        expect(world.store.writes).toEqual([]);
    });
});

describe('the import: what it cannot do', () => {
    it('badPath_placesThatCannotBeReadRefuseTheFileBeforeAnyWrite', async () => {
        const world = poisWorld();
        const subject = new Importer({
            store: world.store,
            clock: world.clock,
            cityId: CITY,
            context: () => ({ limits: LIMITS, categories: new Set(['biserici']) }),
            places: () => Promise.resolve(null),
            changed: () => undefined,
        });

        await subject.choose(file(collection(1)), null);

        expect(subject.state).toMatchObject({ status: 'refused', refusal: 'places-unread', plan: null });
        await subject.commit();
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_anImportThatWouldPassTheCityLimitWritesNothing', async () => {
        const world = poisWorld();
        world.store.counts.set(FIRESTORE_PATHS.pois(CITY), 4999);
        const { importer: subject } = importer(world);
        await subject.choose(file(collection(2)), null);

        await subject.commit();
        const refused = subject.state;
        world.store.counts.set(FIRESTORE_PATHS.pois(CITY), null);
        await subject.choose(file(collection(1)), null);
        await subject.commit();

        // Over the limit: refused with the numbers; uncounted: stopped before any write.
        expect(refused).toMatchObject({ status: 'refused', refusal: 'too-many', limit: { existing: 4999, adding: 2 } });
        expect(subject.state).toMatchObject({ status: 'failed', written: 0 });
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_aRefusedBatchStopsTheImport', async () => {
        const world = poisWorld();
        const { importer: subject } = importer(world);
        await subject.choose(file(collection(3)), null);
        world.store.outcomes.push({ ok: false, reason: 'denied' });

        await subject.commit();

        expect(subject.state).toMatchObject({ status: 'failed', written: 0 });
    });

    it('badPath_closingWhileWritingForgetsTheImport', async () => {
        const world = poisWorld();
        const { importer: subject } = importer(world);
        await subject.choose(file(collection(1)), null);

        const committing = subject.commit();
        subject.close();
        await committing;

        expect(subject.state).toBeNull();
    });

    it('happyPath_closingForgetsTheFile', async () => {
        const world = poisWorld();
        const { importer: subject, states } = importer(world);
        await subject.choose(file(collection(1)), 'biserici');

        subject.close();

        expect(subject.state).toBeNull();
        expect(states.at(-1)).toBeNull();
    });

    it('badPath_aFeatureNamingAPlaceThatCannotBeReadIsRefusedNotMadeANewPlace @S-A34-BAD-UNREADABLE-PLACE', async () => {
        const world = poisWorld();
        const subject = new Importer({
            store: world.store,
            clock: world.clock,
            cityId: CITY,
            context: () => ({ limits: LIMITS, categories: new Set(['biserici']) }),
            places: () => Promise.resolve({ places: [], unreadable: ['stricat'] }),
            changed: () => undefined,
        });
        const features = [
            {
                type: 'Feature',
                id: 'stricat',
                geometry: POINT,
                properties: { category: 'biserici', title: 'Loc stricat', yearStart: 1890 },
            },
            { type: 'Feature', geometry: POINT, properties: { category: 'biserici', title: 'Loc nou', yearStart: 1890 } },
        ];

        await subject.choose(file(JSON.stringify({ type: 'FeatureCollection', features })), null);

        expect(subject.state?.plan?.created).toHaveLength(1);
        expect(subject.state?.plan?.refused).toEqual([{ number: 1, title: 'Loc stricat', reason: 'unreadable-place', path: null }]);
    });
});

describe('a file chosen while another one reads', () => {
    type Places = Awaited<ReturnType<ImporterDeps['places']>>;

    /** An importer whose reads of the city's places wait until the test answers each, in the order they were asked. */
    function held(): { readonly subject: Importer; readonly answers: ((places: Places) => void)[] } {
        const world = poisWorld();
        const answers: ((places: Places) => void)[] = [];
        const subject = new Importer({
            store: world.store,
            clock: world.clock,
            cityId: CITY,
            context: () => ({ limits: LIMITS, categories: new Set(['biserici']) }),
            places: () =>
                new Promise((resolve) => {
                    answers.push(resolve);
                }),
            changed: () => undefined,
        });
        return { subject, answers };
    }

    const EMPTY: Places = { places: [], unreadable: [] };

    it('badPath_closingAndChoosingAnotherFileForgetsTheFirstFilesPlan @S-A34-BAD-FILE-CHANGED-WHILE-READING', async () => {
        const { subject, answers } = held();
        const first = subject.choose(file(collection(1), 100, 'a.geojson'), null);
        await settle();
        subject.close();
        const second = subject.choose(file(collection(2), 100, 'b.geojson'), null);
        await settle();

        answers[0]?.(EMPTY);
        await first;
        expect(subject.state).toMatchObject({ status: 'reading', fileName: 'b.geojson', plan: null });

        answers[1]?.(EMPTY);
        await second;
        expect(subject.state).toMatchObject({ status: 'preview', fileName: 'b.geojson' });
        expect(subject.state?.plan?.created).toHaveLength(2);
    });

    it('badPath_theFirstFilesLateAnswerNeitherOverwritesNorRefusesTheSecondsPreview @S-A34-BAD-FILE-CHANGED-WHILE-READING', async () => {
        const { subject, answers } = held();
        const first = subject.choose(file(collection(1), 100, 'a.geojson'), null);
        await settle();
        const second = subject.choose(file(collection(2), 100, 'b.geojson'), null);
        await settle();

        answers[1]?.(EMPTY);
        await second;
        answers[0]?.(null);
        await first;

        expect(subject.state).toMatchObject({ status: 'preview', fileName: 'b.geojson', refusal: null });
        expect(subject.state?.plan?.created).toHaveLength(2);
    });

    it('badPath_theFirstFileFailingLateDoesNotRefuseTheSecondsPreview @S-A34-BAD-FILE-CHANGED-WHILE-READING', async () => {
        const { subject, answers } = held();
        const failing: ((error: Error) => void)[] = [];
        const slow: ImportFile = {
            name: 'a.geojson',
            size: 100,
            text: () =>
                new Promise((_resolve, reject) => {
                    failing.push(reject);
                }),
        };
        const first = subject.choose(slow, null);
        const second = subject.choose(file(collection(2), 100, 'b.geojson'), null);
        await settle();
        answers[0]?.(EMPTY);
        await second;

        failing[0]?.(new Error('the disk went away'));
        await first;

        expect(subject.state).toMatchObject({ status: 'preview', fileName: 'b.geojson', refusal: null });
    });

    it('badPath_aFileStillBeingReadWhenTheDialogClosesLeavesItClosed @S-A34-BAD-FILE-CHANGED-WHILE-READING', async () => {
        const world = poisWorld();
        const finishing: ((text: string) => void)[] = [];
        const slow: ImportFile = {
            name: 'a.geojson',
            size: 100,
            text: () =>
                new Promise((resolve) => {
                    finishing.push(resolve);
                }),
        };
        const { importer: subject } = importer(world);
        const choosing = subject.choose(slow, null);
        subject.close();

        finishing[0]?.(collection(1));
        await choosing;

        expect(subject.state).toBeNull();
    });
});
