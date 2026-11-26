/**
 * Find's whole-city dates, the paid frames of a row (2026-11-12; behaviour A66): every paid frame has its own Buy this
 * scan, which opens its page and its order card; one with an open order says it is the owner's order, with its chip.
 */
import type { DatePlanRow } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanup, deep, deepAll } from '../shell/fake-app.js';
import { defineImagery, imageryPage, imageryState, ready, scene } from './fixtures.js';

const ROW: DatePlanRow = {
    date: '1972-08-08',
    sensor: 'KH-9-pan',
    frames: [
        { entityId: 'D3C1202-200149F039', free: true },
        { entityId: 'D3C1202-200149F040', free: true },
    ],
    paidFrames: [],
    coveragePct: 96,
    framesToDownload: 2,
    winter: false,
};

beforeAll(defineImagery);
afterEach(cleanup);

describe("a whole-city date's paid frames", () => {
    it('happyPath_everyPaidFrameOfTheRowHasItsOwnBuyThisScan', async () => {
        // 2026-11-12: only the first paid frame was linked, so the second could not be bought from the row.
        const paid = { ...ROW, paidFrames: ['D3C1205-200122F021', 'D3C1205-200122F022'] };
        const { element } = await imageryPage(imageryState({ dates: [paid] }));
        const row = deep(element, '[data-date="1972-08-08"]');
        const links = deepAll(row, '[data-state="join-buy"]');

        expect(links.map((link) => [link.textContent.trim(), link.getAttribute('href')])).toEqual([
            ['Buy this scan: F021', '#/imagery/scene/D3C1205-200122F021'],
            ['Buy this scan: F022', '#/imagery/scene/D3C1205-200122F022'],
        ]);
        expect(deepAll(row, '[data-paid] .tag')).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aPaidFrameAlreadyOrderedSaysSoWithItsOrdersChip_theOtherStillBuys', async () => {
        const order = {
            state: 'ordered' as const,
            orderedAt: '2026-11-01T08:00:00.000Z',
            nextCheckAt: '2026-11-13T08:00:00.000Z',
            lastCheckedAt: null,
            lastError: null,
            importJobId: null,
        };
        const orders = ready([scene({ id: 'D3C1205-200122F022', free: false, order })]);
        const paid = { ...ROW, paidFrames: ['D3C1205-200122F021', 'D3C1205-200122F022'] };
        const { element } = await imageryPage(imageryState({ dates: [paid], orders }));
        const row = deep(element, '[data-date="1972-08-08"]');

        expect(deepAll(row, '[data-state="join-buy"]').map((link) => link.textContent.trim())).toEqual([
            'Buy this scan: F021',
            'Your order: F022',
        ]);
        expect(deep(row, '[data-paid="D3C1205-200122F022"] .tag').textContent).toBe('Ordered');
        expect(deepAll(row, '[data-paid="D3C1205-200122F021"] .tag')).toEqual([]);
    });

    it('badPath_aPaidFrameWhoseOrderExpiredOffersToOrderItAgain', async () => {
        // Review of 2026-11-12: an expired order read "Your order" with the red chip, as if nothing were left to do.
        const order = {
            state: 'expired' as const,
            orderedAt: '2026-07-01T08:00:00.000Z',
            nextCheckAt: '2026-10-01T08:00:00.000Z',
            lastCheckedAt: '2026-10-01T08:00:00.000Z',
            lastError: null,
            importJobId: null,
        };
        const orders = ready([scene({ id: 'D3C1205-200122F022', free: false, order })]);
        const paid = { ...ROW, paidFrames: ['D3C1205-200122F022'] };
        const { element } = await imageryPage(imageryState({ dates: [paid], orders }));
        const link = deep(element, '[data-paid="D3C1205-200122F022"] [data-state="join-buy"]');

        expect([link.textContent.trim(), link.getAttribute('href')]).toEqual([
            'Order it again: F022',
            '#/imagery/scene/D3C1205-200122F022',
        ]);
        expect(deep(element, '[data-paid="D3C1205-200122F022"] .tag').textContent).toBe('Never delivered');
    });
});
