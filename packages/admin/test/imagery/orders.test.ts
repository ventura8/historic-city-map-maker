/**
 * The Imagery area's orders (`packages/admin/src/imagery/orders/`, `docs/research/M4-interfaces.md` §1.7): a scene's
 * acquisition state, order and EarthExplorer page; the scenes that have an order, read whatever the filters; and the
 * order card's three actions through the `usgs.*` callables, one at a time, their answers in words, a refusal on the
 * scene's card, and the snackbar's Undo after "I ordered it".
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { IMAGERY_MODULE } from '../../src/imagery/imagery.js';
import { orderFieldsOf } from '../../src/imagery/orders/model.js';
import { SETUP_LINK_URLS } from '../../src/setup/links.js';
import { failure, settle } from '../app/fakes.js';
import { at, CITY, cityDoc, imageryWorld, SCENES, sceneDoc, setupStatus } from './world.js';

const PAID = 'DS1105-1071DF076';
const EE_PAGE = `https://earthexplorer.usgs.gov/scene/metadata/full/5e839febdccb64b3/${PAID}/`;

function orderDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        state: 'ordered',
        orderedAt: at('2026-10-23T08:00:00.000Z'),
        orderedBy: 'admin-uid',
        checks: 0,
        nextCheckAt: at('2026-10-24T08:00:00.000Z'),
        remindersSent: [],
        ...overrides,
    };
}

function seeded() {
    const world = imageryWorld();
    world.clock.current = Date.parse('2026-10-20T09:00:00Z');
    world.store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('ok'));
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
    world.store.docs.set(SCENES('a'), sceneDoc('a', { harvestedAt: at('2026-10-19T00:00:00Z') }));
    world.store.docs.set(SCENES(PAID), sceneDoc(PAID, { downloadAvailable: false, order: orderDoc() }));
    world.store.docs.set(SCENES('DS-TO-BUY'), sceneDoc('DS-TO-BUY', { downloadAvailable: false }));
    return world;
}

describe('a scene and its order', () => {
    it('happyPath_theAcquisitionStateTheOrderAndTheEarthExplorerPage', () => {
        const fields = orderFieldsOf(
            sceneDoc(PAID, {
                downloadAvailable: false,
                order: orderDoc({
                    state: 'reminder',
                    lastCheckedAt: at('2026-10-30T08:00:00.000Z'),
                    lastError: 'apiError.usgs.maintenance',
                }),
            }) as never,
        );

        expect(fields).toEqual({
            acquisition: 'reminder',
            order: {
                state: 'reminder',
                orderedAt: '2026-10-23T08:00:00.000Z',
                nextCheckAt: '2026-10-24T08:00:00.000Z',
                lastCheckedAt: '2026-10-30T08:00:00.000Z',
                lastError: 'apiError.usgs.maintenance',
                importJobId: null,
            },
            earthExplorerUrl: EE_PAGE,
        });
    });

    it('happyPath_theCardsLinkIsTheTemplateTheWeeklyContractCheckProbes', () => {
        const url = SETUP_LINK_URLS['usgs.sceneMetadata'].replace('{datasetId}', '5e839febdccb64b3').replace('{entityId}', PAID);

        expect(orderFieldsOf(sceneDoc(PAID, { downloadAvailable: false }) as never).earthExplorerUrl).toBe(url);
    });

    it('badPath_aSceneWithoutAnOrderOrAKnownDatasetId', () => {
        const fields = orderFieldsOf(
            sceneDoc('D3C1209-100055F012', { dataset: 'declassiii', sensor: 'KH-9-pan', downloadAvailable: false }) as never,
        );

        expect(fields).toEqual({ acquisition: 'needsOrder', order: null, earthExplorerUrl: null });
        expect(
            orderFieldsOf(sceneDoc('x', { order: orderDoc({ importJobId: 'im-1', state: 'importing' }) }) as never).order?.importJobId,
        ).toBe('im-1');
    });
});

describe('the Imagery area with orders', () => {
    it('happyPath_theOrdersAreReadWhateverTheFiltersAndAnOrderedSceneOpens', async () => {
        const { services } = seeded();
        const imagery = IMAGERY_MODULE.create(services);

        imagery.open(['scene', PAID]);
        await settle();

        expect(imagery.state.visible.map((scene) => scene.id)).toEqual(['a']);
        expect(imagery.state.orders.items.map((scene) => [scene.id, scene.acquisition])).toEqual([[PAID, 'ordered']]);
        expect(imagery.state.scenes.items.find((scene) => scene.id === PAID)).toBeUndefined();
        imagery.close();
    });

    it('happyPath_aSceneToBuyThatFreeOnlyHidesOpensFromItsOwnRead', async () => {
        const { services, store } = seeded();
        const imagery = IMAGERY_MODULE.create(services);

        imagery.open(['scene', 'DS-TO-BUY']);
        await settle();

        expect(imagery.state.visible.map((scene) => scene.id)).toEqual(['a']);
        expect([imagery.state.named.loading, imagery.state.named.scene?.id]).toEqual([false, 'DS-TO-BUY']);
        imagery.open(['scene', 'a']);
        await settle();
        expect(imagery.state.named.scene?.id).toBe('a');
        imagery.close();
        expect([imagery.state.named, store.listeners()]).toEqual([{ loading: false, scene: null, failure: null }, 0]);
    });

    it('badPath_anAddressOfNoSceneIsNotFoundOnceItsReadAnswers', async () => {
        const { services, store } = seeded();
        const imagery = IMAGERY_MODULE.create(services);

        imagery.open(['scene', 'DS-NONE']);
        await settle();

        expect(imagery.state.named).toEqual({ loading: false, scene: null, failure: null });
        store.fail(SCENES('DS-NONE'), { kind: 'failed', code: 'internal' });
        // A read that failed is not "no such scene": it says why, with Try again.
        expect(imagery.state.named).toEqual({ loading: false, scene: null, failure: { kind: 'failed', code: 'internal' } });
        imagery.intents.retry();
        await settle();
        expect(imagery.state.named).toEqual({ loading: false, scene: null, failure: null });
        imagery.open([]);
        expect(imagery.state.named).toEqual({ loading: false, scene: null, failure: null });
        imagery.close();
    });

    it('happyPath_iOrderedItThenTheSnackbarsUndo @S-A13-HAPPY-TAKE-BACK', async () => {
        const { services, callables, notices } = seeded();
        callables.answer('usgs.markOrdered', () => ({ state: 'ordered', nextCheckAt: '2026-10-21T09:00:00.000Z' }));
        callables.answer('usgs.cancelOrder', () => ({ state: 'needsOrder' }));
        const imagery = IMAGERY_MODULE.create(services);

        await expect(imagery.intents.markOrdered('DS-TO-BUY')).resolves.toBe(true);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.orders.notice.marked']);
        notices[0]?.action?.run();
        await settle();

        expect(callables.calls.map((call) => [call.name, call.request])).toEqual([
            ['usgs.markOrdered', { cityId: CITY, entityId: 'DS-TO-BUY' }],
            ['usgs.cancelOrder', { cityId: CITY, entityId: 'DS-TO-BUY' }],
        ]);
        expect(notices.map((notice) => notice.key)).toContain('adminContent.orders.notice.takenBack');
        expect(imagery.state.ordering).toBeNull();
    });

    it('happyPath_checkNowSaysWhatUsgsAnswered', async () => {
        const { services, callables, notices } = seeded();
        const answers = [
            { state: 'ordered', available: false },
            { state: 'delivered', available: true },
            { state: 'importing', available: true, jobId: 'im-1' },
        ];
        callables.answer('usgs.checkOrder', () => answers.shift() as never);
        const imagery = IMAGERY_MODULE.create(services);

        for (let index = 0; index < 3; index += 1) {
            await imagery.intents.checkOrder(PAID);
        }

        expect(notices.map((notice) => notice.key)).toEqual([
            'adminContent.orders.notice.waiting',
            'adminContent.orders.notice.deliveredWaits',
            'adminContent.orders.notice.delivered',
        ]);
    });

    it('badPath_aRefusalStaysOnTheScenesCardAndOneActionRunsAtATime', async () => {
        const { services, callables, notices } = seeded();
        callables.fail('usgs.checkOrder', failure('resource-exhausted', 'apiError.rateLimited'));
        const held: { resolve?: (answer: { state: 'needsOrder' }) => void } = {};
        const answer = new Promise<{ state: 'needsOrder' }>((resolve) => {
            held.resolve = resolve;
        });
        callables.answer('usgs.cancelOrder', () => answer);
        const imagery = IMAGERY_MODULE.create(services);

        await expect(imagery.intents.checkOrder(PAID)).resolves.toBe(false);
        const refused = imagery.state.orderRefusal;
        const cancelling = imagery.intents.cancelOrder(PAID);
        const running = imagery.state.ordering;
        await expect(imagery.intents.markOrdered(PAID)).resolves.toBe(false);
        held.resolve?.({ state: 'needsOrder' });
        await cancelling;

        expect(refused).toEqual({ id: PAID, notice: { key: 'apiError.rateLimited' } });
        expect(running).toEqual({ id: PAID, action: 'cancel' });
        expect(callables.named('usgs.markOrdered')).toBe(0);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.orders.notice.takenBack']);
        expect(imagery.state.orderRefusal).toBeNull();
    });

    it('badPath_aMarkOrUndoUsgsRefusedSaysWhy', async () => {
        const { services, callables, notices } = seeded();
        callables.fail('usgs.markOrdered', failure('failed-precondition', 'apiError.usgs.alreadyAvailable'));
        callables.fail('usgs.cancelOrder', new Error('offline'));
        const imagery = IMAGERY_MODULE.create(services);

        await expect(imagery.intents.markOrdered('DS-TO-BUY')).resolves.toBe(false);
        const marked = imagery.state.orderRefusal;
        await expect(imagery.intents.cancelOrder(PAID)).resolves.toBe(false);

        expect(marked?.notice).toEqual({ key: 'apiError.usgs.alreadyAvailable' });
        expect(imagery.state.orderRefusal).toEqual({ id: PAID, notice: { key: 'apiError.unavailable' } });
        // A frame scanned meanwhile loses its card with the order: the snackbar says why too (S-A13-BAD-SCANNED-WHILE-MARKING).
        expect(notices).toEqual([{ key: 'apiError.usgs.alreadyAvailable' }]);
    });
});

describe("Not useful (the owner's report of 2026-11-13)", () => {
    it('happyPath_notUsefulWithWhyThenTheSnackbarsUndo @S-A152-HAPPY-UNDO', async () => {
        const { services, callables, notices } = seeded();
        callables.answer('imagery.markScene', (request) => ({ status: request.unusable === null ? 'candidate' : 'rejected' }));
        const imagery = IMAGERY_MODULE.create(services);

        await expect(imagery.intents.markUnusable('DS-TO-BUY', 'clouds')).resolves.toBe(true);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.unusable.marked']);
        notices[0]?.action?.run();
        await settle();

        expect(callables.calls.map((call) => [call.name, call.request])).toEqual([
            ['imagery.markScene', { cityId: CITY, entityId: 'DS-TO-BUY', unusable: 'clouds' }],
            ['imagery.markScene', { cityId: CITY, entityId: 'DS-TO-BUY', unusable: null }],
        ]);
        expect(notices.map((notice) => notice.key)).toContain('adminContent.imagery.unusable.restored');
        expect(imagery.state.ordering).toBeNull();
    });

    it('badPath_aMarkTheServerRefusedStaysOnTheScene', async () => {
        const { services, callables, notices } = seeded();
        callables.fail('imagery.markScene', failure('already-exists', 'apiError.imagery.alreadyImported'));
        const imagery = IMAGERY_MODULE.create(services);

        await expect(imagery.intents.markUnusable('a', 'haze')).resolves.toBe(false);

        expect(imagery.state.orderRefusal).toEqual({ id: 'a', notice: { key: 'apiError.imagery.alreadyImported' }, action: 'unusable' });
        expect(notices).toEqual([]);
    });
});
