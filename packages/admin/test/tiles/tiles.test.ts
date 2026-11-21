/**
 * The tile-import wizard's store (`docs/research/M20-import-local.md` §19.11; S-A-*-TILE-WIZARD-*): it reads the waiting series'
 * layout, keeps the owner's draft, sends it for the preview or on to points, and gives way to a newer layout when the server says
 * the draft is stale.
 */
import { RASTER_PATHS } from '@hcm/shared';
import type { AreaPort, TilesIntentsPort, TilesViewState } from '@hcm/ui/admin';
import { describe, expect, it } from 'vitest';

import { TILES_MODULE } from '../../src/tiles/tiles.js';
import { failure, settle } from '../app/fakes.js';
import { answer, CITY, callsOf, golden, imageryWorld, VERSIONS } from '../imagery/world.js';

type Assignable<Source, Target> = [Source] extends [Target] ? true : false;
const STORE_SATISFIES_PORT: Assignable<ReturnType<typeof TILES_MODULE.create>, AreaPort<TilesViewState, TilesIntentsPort>> = true;

const ID = 'ar-mw993zri-s-4054e55659a3';
const LAYER = 'atlas-1911';
const file = (name: 'layout.json' | 'thumbs.jpg' | 'seams.jpg'): string => RASTER_PATHS.version(CITY, LAYER, ID, name);

function setup(revision = 2) {
    const world = imageryWorld();
    const version = golden('version.layout-check.json') as { help: { stitched: { layout: { revision: number } } } };
    version.help.stitched.layout.revision = revision;
    world.store.docs.set(VERSIONS(ID), version);
    world.files.put(file('layout.json'), JSON.stringify({ ...golden('layout.sample.json'), revision }));
    world.files.put(file('thumbs.jpg'));
    world.files.put(file('seams.jpg'));
    world.files.put(`rasters/bucharest/${LAYER}/${ID}/stitched.jpg`);
    const tiles = TILES_MODULE.create(world.services);
    return { ...world, tiles };
}

async function opened(revision = 2) {
    const made = setup(revision);
    made.tiles.open([ID, 'tiles']);
    await settle();
    return made;
}

describe('the tile-import wizard store @S-A-HAPPY-TILE-WIZARD-ORDER', () => {
    it('happyPath_theWaitingLayoutOpensWithItsSheetsSeamsAndPictures', async () => {
        const { tiles } = await opened();
        expect([STORE_SATISFIES_PORT]).toEqual([true]);
        const state = tiles.state;
        expect(state).toMatchObject({ status: 'ready', rows: 2, cols: 2, revision: 2, dirty: false });
        expect(state.sheets.map((sheet) => [sheet.name, sheet.out])).toEqual([
            ['atlas/r1c1.jpg', null],
            ['atlas/r1c2.jpg', null],
            ['atlas/r2c1.jpg', null],
            ['atlas/r2c2.jpg', null],
            ['atlas/blank.jpg', 'blank'],
        ]);
        expect(state.seams).toHaveLength(2);
        expect(state.seams[0]).toMatchObject({ nameA: 'atlas/r1c2.jpg', nameB: 'atlas/r2c2.jpg' });
        expect(state.seams[1]).toMatchObject({ nameA: 'atlas/r2c1.jpg', nameB: 'atlas/r2c2.jpg', suggestion: null });
        expect(state.thumbs).toEqual({ url: `blob:${file('thumbs.jpg')}`, width: 640, height: 128 });
        expect(state.seamsSprite).toEqual({ url: `blob:${file('seams.jpg')}`, width: 512, height: 512 });
        expect(state.quality?.verdict).toBe('check');
        tiles.open([ID, 'tiles']);
        expect(tiles.state.status).toBe('ready');
    });

    it('happyPath_editsMakeTheDraftDirtyAndThePreviewSendsIt @S-A-HAPPY-TILE-WIZARD-PREVIEW', async () => {
        const { tiles, callables } = await opened();
        answer(callables, 'imagery.saveLayout', () => ({ jobId: ID, versionId: ID }));
        tiles.intents.goTo('seams');
        tiles.intents.acceptSeam();
        tiles.intents.pick('a', [1, 2]);
        tiles.intents.nextSeam();
        tiles.intents.select(0, 0);
        tiles.intents.rotate();
        tiles.intents.flip();
        tiles.intents.select(1, 0);
        tiles.intents.takeOut();
        tiles.intents.putBack(2);
        expect(tiles.hasUnsavedChanges()).toBe(true);
        expect(tiles.state).toMatchObject({ step: 'seams', selected: { row: 1, col: 0 }, seam: 0 });
        expect(tiles.state.seams).toHaveLength(1);
        await tiles.intents.preview();
        expect(tiles.state).toMatchObject({ previewing: true, dirty: false, busy: false });
        const [request] = callsOf(callables, 'imagery.saveLayout') as { sheets: unknown[]; seams: unknown[]; preview: boolean }[];
        expect(request).toMatchObject({ cityId: CITY, versionId: ID, revision: 2, preview: true });
        expect(request?.sheets).toContainEqual({ index: 0, row: 0, col: 0, turn: 90, flip: true });
        expect(request?.seams).toEqual([{ a: 1, b: 3, side: 'below', points: { a: [1, 2], b: [1497, 42] } }]);
    });

    it('badPath_aSheetMovedTurnedOrTakenOutDropsTheSeamsItBelongsTo @S-A-BAD-TILE-WIZARD-SEAM-RESET', async () => {
        const { tiles, callables } = await opened();
        answer(callables, 'imagery.saveLayout', () => ({ jobId: ID, versionId: ID }));
        expect(tiles.state.seams.map((seam) => [seam.a, seam.b])).toEqual([
            [1, 3],
            [2, 3],
        ]);
        tiles.intents.nextSeam();
        tiles.intents.pick('a', [5, 6]);
        tiles.intents.pick('b', [7, 8]);
        tiles.intents.select(1, 0);
        tiles.intents.takeOut();
        expect(tiles.state.seams.map((seam) => [seam.a, seam.b])).toEqual([[1, 3]]);
        expect(tiles.state.seam).toBe(0);
        tiles.intents.select(0, 0);
        tiles.intents.shift(0, 1);
        expect(tiles.state.seams).toEqual([]);
        expect(tiles.state.seam).toBe(0);
        tiles.intents.place(3, 1, 0);
        expect(tiles.state.selected).toEqual({ row: 1, col: 0 });
        await tiles.intents.preview();
        const [request] = callsOf(callables, 'imagery.saveLayout') as { seams: unknown[] }[];
        expect(request?.seams).toEqual([]);
    });

    it('happyPath_theCallsOwnWriteArrivingFirstIsNoMoveAway', async () => {
        const { tiles, callables, store } = await opened();
        const version = golden('version.layout-check.json');
        answer(callables, 'imagery.saveLayout', () => {
            store.put(VERSIONS(ID), { ...version, state: 'processing', help: undefined });
            return { jobId: ID, versionId: ID };
        });
        await tiles.intents.preview();
        await settle();
        expect(tiles.state).toMatchObject({ status: 'ready', previewing: true });
    });

    it('happyPath_thePipelinesNewRevisionEndsThePreview', async () => {
        const { tiles, callables, store, files } = await opened();
        answer(callables, 'imagery.saveLayout', () => ({ jobId: ID, versionId: ID }));
        await tiles.intents.preview();
        const version = golden('version.layout-check.json') as Record<string, unknown> & { help: { stitched: { layout: object } } };
        store.put(VERSIONS(ID), { ...version, state: 'processing' });
        await settle();
        expect(tiles.state.previewing).toBe(true);
        files.put(file('layout.json'), JSON.stringify({ ...golden('layout.sample.json'), revision: 3 }));
        const layout = { ...version.help.stitched.layout, revision: 3 };
        store.put(VERSIONS(ID), { ...version, help: { ...version.help, stitched: { ...version.help.stitched, layout } } });
        await settle();
        expect(tiles.state).toMatchObject({ previewing: false, revision: 3 });
    });

    it('happyPath_theHandOffAcceptsAnUnchangedLayoutOrSavesAChangedOne @S-A-HAPPY-TILE-WIZARD-HANDOFF', async () => {
        const { tiles, callables } = await opened();
        answer(callables, 'imagery.acceptLayout', () => ({ jobId: ID, versionId: ID }));
        answer(callables, 'imagery.saveLayout', () => ({ jobId: ID, versionId: ID }));
        await tiles.intents.handOff();
        expect(callsOf(callables, 'imagery.acceptLayout')).toEqual([{ cityId: CITY, versionId: ID, revision: 2 }]);
        expect(tiles.state).toMatchObject({ handedOff: true, step: 'points' });
        const again = await opened();
        answer(again.callables, 'imagery.saveLayout', () => ({ jobId: ID, versionId: ID }));
        again.tiles.intents.rotate();
        await again.tiles.intents.handOff();
        expect(callsOf(again.callables, 'imagery.saveLayout')).toMatchObject([{ preview: false }]);
        again.store.docs.delete(VERSIONS(ID));
    });
});

describe('the tile-import wizard store refuses and recovers', () => {
    it('badPath_aStaleRevisionIsRefusedAndTheNewerLayoutShown @S-A-BAD-TILE-WIZARD-STALE-REVISION', async () => {
        const { tiles, callables, store, files } = await opened();
        tiles.intents.rotate();
        files.put(file('layout.json'), JSON.stringify({ ...golden('layout.sample.json'), revision: 5 }));
        const version = golden('version.layout-check.json') as Record<string, unknown> & { help: { stitched: { layout: object } } };
        const layout = { ...version.help.stitched.layout, revision: 5 };
        store.put(VERSIONS(ID), { ...version, help: { ...version.help, stitched: { ...version.help.stitched, layout } } });
        await settle();
        expect(tiles.state).toMatchObject({ revision: 2, dirty: true });
        callables.fail('imagery.saveLayout', failure('failed-precondition', 'apiError.imagery.layoutStale', { revision: '5' }));
        await tiles.intents.preview();
        await settle();
        expect(tiles.state).toMatchObject({ revision: 5, dirty: false, previewing: false });
        expect(tiles.state.refusal).toEqual({ key: 'apiError.imagery.layoutStale', params: { revision: '5' } });
    });

    it('badPath_noWeakSeamsLeaveTheSeamWhereItIsAndALaterReadWins', async () => {
        const made = setup();
        const bare = golden('layout.sample.json') as { seams: { state: string }[] };
        made.files.put(
            file('layout.json'),
            JSON.stringify({ ...bare, seams: bare.seams.filter((seam) => seam.state !== 'weak' && seam.state !== 'missing') }),
        );
        made.files.hold = true;
        made.tiles.open([ID, 'tiles']);
        await settle();
        made.tiles.open(['ar-other']);
        made.files.hold = false;
        made.files.flush();
        await settle();
        expect(made.tiles.state.status).toBe('notFound');
        made.tiles.open([ID, 'tiles']);
        await settle();
        made.tiles.intents.nextSeam();
        expect(made.tiles.state).toMatchObject({ status: 'ready', seam: 0, seams: [] });
        expect(made.tiles.subscribe(() => undefined)).toBeTypeOf('function');
        made.tiles.intents.putBack(4);
        expect(made.tiles.state.dirty).toBe(false);
    });

    it('badPath_noBucketNoThumbnailsAndNoParams', async () => {
        const made = setup();
        made.files.objects.delete(file('thumbs.jpg'));
        made.tiles.open([ID, 'tiles']);
        await settle();
        expect(made.tiles.state).toMatchObject({ status: 'ready', thumbs: null });
        made.tiles.open([]);
        expect(made.tiles.state.status).toBe('notFound');
        const blind = imageryWorld({ files: null });
        blind.store.docs.set(VERSIONS(ID), golden('version.layout-check.json'));
        const tiles = TILES_MODULE.create(blind.services);
        tiles.open([ID, 'tiles']);
        await settle();
        expect(tiles.state.status).toBe('error');
    });

    it('badPath_aCallThatBreaksIsAnInternalRefusal', async () => {
        const { tiles, callables } = await opened();
        callables.fail('imagery.acceptLayout', new Error('offline'));
        await tiles.intents.handOff();
        expect(tiles.state).toMatchObject({ handedOff: false, busy: false, refusal: { key: 'apiError.internal' } });
    });

    it('badPath_aMissingOrBrokenLayoutIsAnErrorUntilRetried', async () => {
        const made = setup();
        made.files.put(file('layout.json'), 'not json');
        made.tiles.open([ID, 'tiles']);
        await settle();
        expect(made.tiles.state.status).toBe('error');
        made.files.objects.delete(file('layout.json'));
        made.tiles.intents.retry();
        await settle();
        expect(made.tiles.state.status).toBe('error');
        made.files.put(file('layout.json'), JSON.stringify(golden('layout.sample.json')));
        made.tiles.intents.retry();
        await settle();
        expect(made.tiles.state.status).toBe('ready');
    });

    it('badPath_aWrongAddressAMissingVersionAndOneThatNoLongerWaits', async () => {
        const made = setup();
        made.tiles.open(['not an id']);
        expect(made.tiles.state.status).toBe('notFound');
        made.tiles.open(['ar-missing']);
        await settle();
        expect(made.tiles.state.status).toBe('notFound');
        made.tiles.open([ID]);
        await settle();
        made.store.put(VERSIONS(ID), { ...golden('version.layout-check.json'), state: 'processing' });
        await settle();
        expect(made.tiles.state.status).toBe('moved');
        made.tiles.destroy();
        expect(made.files.released).toContain(`blob:${file('thumbs.jpg')}`);
        expect(made.tiles.state.versionId).toBe('');
    });

    it('badPath_aReadThatFailsIsAnErrorUntilRetried', async () => {
        const made = await opened();
        made.store.fail(VERSIONS(ID), { kind: 'failed', code: 'internal' });
        expect(made.tiles.state.status).toBe('error');
        made.tiles.intents.retry();
        await settle();
        expect(made.tiles.state.status).toBe('ready');
        const missing = setup();
        missing.tiles.open(['ar-missing']);
        await settle();
        missing.tiles.intents.retry();
        await settle();
        expect(missing.tiles.state.status).toBe('notFound');
    });
});
