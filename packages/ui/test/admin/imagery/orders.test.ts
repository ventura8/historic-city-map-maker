/**
 * The order card and the orders in the Imagery area's lists (`packages/ui/src/admin/imagery/orders/`,
 * `docs/research/M4-interfaces.md` §1.7; behaviour A13): a scene to buy says what it costs, how to order it and links to
 * its own EarthExplorer page in a new tab, then "I ordered it"; an order says where it stands and offers Check now and
 * Take the mark back; a reminder, a delivery, an import and an order never delivered each say so; the cards and Work
 * show each open order, those that need the admin first.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryIntentsPort, ImageryViewState, SceneItemPort, SceneOrderPort } from '../../../src/admin/imagery/imagery-port.js';
import { EARTH_EXPLORER_HOME } from '../../../src/admin/imagery/orders/order-card.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { button, click, defineImagery, imageryPage, imageryState, ready, scene, sceneButtons } from './fixtures.js';

const PAID = 'DS1105-1071DF076';
const EE_PAGE = `https://earthexplorer.usgs.gov/scene/metadata/full/5e839febdccb64b3/${PAID}/`;

function order(overrides: Partial<SceneOrderPort> = {}): SceneOrderPort {
    return {
        state: 'ordered',
        orderedAt: '2026-10-23T08:00:00.000Z',
        nextCheckAt: '2026-10-24T08:00:00.000Z',
        lastCheckedAt: null,
        lastError: null,
        importJobId: null,
        ...overrides,
    };
}

function paid(overrides: Partial<SceneItemPort> = {}): SceneItemPort {
    return scene({
        id: PAID,
        displayId: PAID,
        free: false,
        date: '1968-12-11',
        year: 1968,
        reasons: [{ code: 'needsOrder' }],
        ...overrides,
    });
}

/** A scene's page in the Imagery area, the scene listed with Free only off. */
function scenePage(item: SceneItemPort, overrides: Partial<ImageryViewState> = {}, locale: 'ro' | 'en' = 'en', marked = true) {
    const state = imageryState({ detail: { kind: 'scene', id: item.id }, scenes: ready([item]), visible: [item], ...overrides });
    return imageryPage(state, { params: ['scene', item.id], locale }, { markOrdered: Promise.resolve(marked) });
}

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

describe('<hcm-imagery-page>: buying a scan', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theCostTheGuideTheScenesEarthExplorerPageAndIOrderedIt @S-A13-HAPPY', async () => {
        const { element, area } = await scenePage(paid());

        const card = deep(element, '.order-card[data-state="needs-order"]');
        expect(deep(card, 'h3').textContent).toBe('Buy this scan');
        expect(card.textContent).toContain('Must be ordered from USGS');
        expect(card.textContent).toContain('Cost: 35 USD (1 × 30 USD a frame + 5 USD an order), paid to USGS directly');
        expect(deepAll(card, '.guide li').map((step) => step.textContent.trim())).toEqual([
            'Sign in on the page that opens (Login, top right).',
            'At the bottom of the page, click Order.',
            'On the order page keep On-Demand, choose 7 Micron, then click Submit Product Selections.',
            "Fill in USGS's form and pay 35 USD on pay.gov; keep the confirmation number.",
        ]);
        const link = deep(card, 'a.ee-link');
        expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual([
            EE_PAGE,
            '_blank',
            'noopener noreferrer',
        ]);
        expect(link.textContent).toContain('Order in EarthExplorer');
        expect(sceneButtons(element).map((target) => target.textContent.trim())).toEqual(['I ordered it']);
        click(button(element, 'I ordered it'));
        await updated(element);

        expect(calls(area)).toEqual([`markOrdered "${PAID}"`]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aSceneWhoseEarthExplorerPageIsUnknownNamesItsEntityId', async () => {
        const { element } = await scenePage(paid({ earthExplorerUrl: null, dataset: 'declassiii' }));

        expect(deep(element, '[data-state="no-link"]').textContent).toContain(PAID);
        expect(deep(element, '.order-card a.external').getAttribute('href')).toBe(EARTH_EXPLORER_HOME);
        expect(deepAll(element, '.order-card a.ee-link')).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRefusedMarkSaysWhyAndNothingRunsTwice', async () => {
        const refused = { id: PAID, notice: { key: 'apiError.usgs.alreadyAvailable' as const } };
        const { element, area } = await scenePage(paid(), { orderRefusal: refused });
        const alert = deep(element, '.order-card .alert[role="alert"]').textContent;
        area.set({ orderRefusal: null, ordering: { id: PAID, action: 'mark' } });
        await updated(element);

        expect(alert).toContain('This frame is already scanned');
        expect((button(element, 'I ordered it') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('badPath_aSceneScannedWhileBeingMarkedIsFreeWithoutACard @S-A13-BAD-MARK-AVAILABLE-REFUSED', async () => {
        // usgs.markOrdered found the frame scanned meanwhile: the scene is free now, with Import and no order card (the
        // admin's snackbar says why: packages/admin/test/imagery/orders.test.ts).
        const refused = { id: PAID, notice: { key: 'apiError.usgs.alreadyAvailable' as const } };
        const { element } = await scenePage(paid({ free: true, acquisition: 'available' }), { orderRefusal: refused });

        expect(deepAll(element, '.order-card')).toEqual([]);
        expect(deepAll(element, '.pane[data-scene] .alert[role="alert"]')).toEqual([]);
        expect(sceneButtons(element).map((target) => target.textContent.trim())).toEqual(['Import (free)']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRefusedMarkLeavesTheKeyboardOnTheScenesHeading', async () => {
        // The button may go with its card (a frame scanned meanwhile): the focus must not fall to the page's body.
        const { element } = await scenePage(paid(), {}, 'en', false);

        click(button(element, 'I ordered it'));
        await updated(element);
        await updated(element);

        expect(element.shadowRoot?.activeElement?.hasAttribute('data-detail-heading')).toBe(true);
    });

    it('badPath_beforeUsgsApprovesDownloadsTheCardsSayTheCheckWaitsForIt', async () => {
        const { element } = await scenePage(paid(), { usgs: 'pending' });
        const buy = deep(element, '.order-card [data-state="waits-for-approval"]');
        expect(buy.textContent).toContain('the daily check of the order starts once it does');
        expect(deep(buy, 'a').getAttribute('href')).toBe('#/setup/usgs');
        expect(await axeViolations(element)).toEqual([]);

        cleanup();
        const watched = await scenePage(paid({ acquisition: 'ordered', order: order() }), { usgs: 'pending' });
        const card = deep(watched.element, '.order-card[data-state="ordered"]');
        expect(deep(card, '[data-state="waits-for-approval"]').textContent).toContain('USGS has not approved');
        expect(deepAll(card, '.facts dd')[1]?.textContent.trim()).toBe('after USGS approves downloads');
    });

    it('happyPath_aSceneUsgsOffersHasImportAndNoOrderCard @S-A13-BAD-ALREADY-AVAILABLE', async () => {
        const { element } = await scenePage(scene());

        expect(deepAll(element, '.order-card')).toEqual([]);
        expect(sceneButtons(element).map((target) => target.textContent.trim())).toEqual(['Import (free)']);
    });

    it('happyPath_romanianTextsToo', async () => {
        const { element } = await scenePage(paid(), {}, 'ro');

        expect(deep(element, '.order-card h3').textContent).toBe('Cumpără această scanare');
        expect(deep(element, 'a.ee-link').textContent).toContain('Comandă în EarthExplorer');
        expect(deepText(element)).toContain('Cost: 35 USD');
    });
});

describe('<hcm-imagery-page>: an order', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_whereItStandsCheckNowAndTakeTheMarkBack @S-A13-HAPPY-TAKE-BACK', async () => {
        const item = paid({ acquisition: 'ordered', order: order() });
        const { element, area } = await scenePage(item);

        const card = deep(element, '.order-card[data-state="ordered"]');
        expect(deep(card, 'h3').textContent).toBe('Your order');
        expect(card.textContent).toContain('Ordered: delivery checked daily');
        // In the admin's own time zone, as the inbox shows the same moments.
        const local = (iso: string, time: boolean): string =>
            new Intl.DateTimeFormat('en', { dateStyle: 'medium', ...(time ? { timeStyle: 'short' } : {}) }).format(new Date(iso));
        expect(deepAll(card, '.facts dd').map((fact) => fact.textContent.trim())).toEqual([
            local('2026-10-23T08:00:00.000Z', false),
            local('2026-10-24T08:00:00.000Z', true),
            'not yet',
        ]);
        expect(deepAll(card, '[data-state="waits-for-approval"]')).toEqual([]);
        click(button(element, 'Check now'));
        click(button(element, 'Take the mark back'));
        await updated(element);

        expect(calls(area)).toEqual([`checkOrder "${PAID}"`, `cancelOrder "${PAID}"`]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aReminderToPayAndTheLastFailedCheckInWords @S-A13-BAD-NEVER-DELIVERED', async () => {
        const reminder = order({ state: 'reminder', lastCheckedAt: '2026-10-30T08:00:00.000Z', lastError: 'apiError.usgs.maintenance' });
        const { element } = await scenePage(paid({ acquisition: 'reminder', order: reminder }));

        const card = deep(element, '.order-card[data-state="reminder"]');
        expect(card.textContent).toContain('have you paid?');
        expect(card.textContent).toContain('USGS deletes unpaid orders after 14 days');
        // Once sent, a reminder waits like any order: no error tone, and nothing for an admin who paid to do.
        expect(deep(card, '.tag').getAttribute('data-tone')).toBe('wait');
        expect(card.textContent).toContain('If you have paid, there is nothing to do');
        const failed = deep(card, '[data-state="last-error"]');
        expect(failed.getAttribute('role')).toBe('status');
        expect(failed.textContent).toContain('The last check of USGS failed:');
        expect(failed.textContent).toContain('maintenance');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anOrderNeverDeliveredIsOrderedAgain @S-A13-BAD-NEVER-DELIVERED', async () => {
        const { element, area } = await scenePage(paid({ acquisition: 'expired', order: order({ state: 'expired' }) }));

        const card = deep(element, '.order-card[data-state="expired"]');
        expect(deep(card, 'h3').textContent).toBe('Order it again');
        expect(card.textContent).toContain('Never delivered');
        expect(card.textContent).toContain('within 90 days');
        click(button(element, 'I ordered it'));
        click(button(element, 'Take the mark back'));
        await updated(element);
        expect(calls(area)).toEqual([`markOrdered "${PAID}"`, `cancelOrder "${PAID}"`]);
    });

    it('happyPath_aDeliveryImportsByItselfAndItsImportOpens', async () => {
        const delivered = paid({ free: true, acquisition: 'delivered', order: order({ state: 'delivered' }) });
        const { element, area } = await scenePage(delivered);
        const deliveredText = deep(element, '.order-card[data-state="delivered"]').textContent;
        const buttons = sceneButtons(element).length;
        const importing = paid({
            status: 'imported',
            layerId: 'corona-1968',
            acquisition: 'importing',
            order: order({ state: 'importing', importJobId: 'im-1' }),
        });
        area.set({ scenes: ready([importing]), visible: [importing] });
        await updated(element);

        expect(deliveredText).toContain('Delivered: the import is starting');
        expect(buttons).toBe(0);
        expect(deep(element, '.order-card[data-state="importing"] a').getAttribute('href')).toBe('#/imagery/version/im-1');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anImportedOrderHasNoCardAndADeliveryWithoutItsJobNoLink', async () => {
        const imported = paid({ status: 'imported', layerId: 'corona-1968', acquisition: 'imported', order: order({ state: 'imported' }) });
        const { element, area } = await scenePage(imported);
        const cards = deepAll(element, '.order-card').length;
        const missing = paid({ acquisition: 'ordered', order: null });
        area.set({ scenes: ready([missing]), visible: [missing] });
        await updated(element);
        const noOrder = deepAll(element, '.order-card').length;

        expect([cards, noOrder]).toEqual([0, 0]);
    });
});

describe('<hcm-imagery-page>: orders in the lists', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    const reminder = paid({ id: 'DS-REMIND', acquisition: 'reminder', order: order({ state: 'reminder' }) });
    const ordered = paid({ acquisition: 'ordered', order: order() });
    const imported = paid({ id: 'DS-DONE', acquisition: 'imported', order: order({ state: 'imported' }) });
    const expired = paid({ id: 'DS-LOST', acquisition: 'expired', order: order({ state: 'expired' }) });

    it('happyPath_aCardSaysItsOrdersState', async () => {
        const { element } = await imageryPage(imageryState({ scenes: ready([ordered, reminder]), visible: [ordered, reminder] }));

        const rows = deepAll(element, 'a.row.scene');
        expect(rows[0]?.textContent).toContain('Ordered');
        expect(rows[1]?.textContent).toContain('Ordered: paid?');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_workListsTheOpenOrdersTheOneThatNeedsYouFirstAndCountsThem', async () => {
        const state = imageryState({
            tab: 'work',
            versions: ready([]),
            orders: ready([ordered, imported, reminder, expired]),
            detail: { kind: 'scene', id: 'DS-REMIND' },
        });
        const { element } = await imageryPage(state);

        expect(deep(element, '#imagery-orders').textContent).toBe('Orders');
        const rows = deepAll(element, '[data-order] a.row');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual([
            '#/imagery/scene/DS-LOST',
            `#/imagery/scene/${PAID}`,
            '#/imagery/scene/DS-REMIND',
        ]);
        expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, null, 'page']);
        // Work counts every open order it lists (finding 54), the imported one not.
        expect(deepText(element)).toContain('Work (3)');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anOrderedSceneTheFiltersHideStillOpens', async () => {
        const state = imageryState({ detail: { kind: 'scene', id: PAID }, scenes: ready([scene()]), orders: ready([ordered]) });
        const { element } = await imageryPage(state, { params: ['scene', PAID] });

        expect(deep(element, '.order-card[data-state="ordered"]').textContent).toContain('Check now');
    });

    it('happyPath_aSceneToBuyTheFiltersHideOpensFromItsOwnRead', async () => {
        const toBuy = paid({ id: 'DS-TO-BUY', displayId: 'DS-TO-BUY', order: null, acquisition: 'needsOrder' });
        const named = { loading: false, scene: toBuy };
        const state = imageryState({
            detail: { kind: 'scene', id: 'DS-TO-BUY' },
            scenes: ready([scene()]),
            named: { ...named, failure: null },
        });
        const { element } = await imageryPage(state, { params: ['scene', 'DS-TO-BUY'] });

        expect(deep(element, '[data-scene="DS-TO-BUY"]')).not.toBeNull();
    });

    it('badPath_anAddressOfNoSceneWaitsForItsReadThenSaysNotFound', async () => {
        const loading = imageryState({ detail: { kind: 'scene', id: 'DS-NONE' }, named: { loading: true, scene: null, failure: null } });
        const { element, area } = await imageryPage(loading, { params: ['scene', 'DS-NONE'] });

        expect(deepText(element)).not.toContain('No scene has this address');
        area.set({ ...loading, named: { loading: false, scene: null, failure: null } });
        await updated(element);
        expect(deepText(element)).toContain('No scene has this address');
    });

    it('badPath_aRoutedSceneWhoseReadFailedSaysSoWithTryAgain @S-A11-BAD-ROUTED-SCENE-UNREAD', async () => {
        const failure = { kind: 'failed', code: 'internal' } as const;
        const state = imageryState({ detail: { kind: 'scene', id: 'DS-X' }, named: { loading: false, scene: null, failure } });
        const { element, area } = await imageryPage(state, { params: ['scene', 'DS-X'] });

        expect(deepText(element)).not.toContain('No scene has this address');
        expect(deepText(deep(element, 'p.alert'))).not.toBe('');
        deepAll(element, 'hcm-button')
            .find((button) => button.textContent.includes('Try again'))
            ?.click();

        expect(area.calls).toContain('retry');
    });
});
