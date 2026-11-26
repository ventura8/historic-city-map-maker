/** Buying a scan (M4, scenario A13; docs/research/M4-interfaces.md §1): the order record and what the screens derive. */
import { describe, expect, it } from 'vitest';

import { timestampFromDate } from '../../src/schemas/firestore-common.js';
import { usgsSceneDocSchema } from '../../src/schemas/usgs-scene.js';
import {
    acquisitionState,
    earthExplorerSceneUrl,
    ORDER_GIVE_UP_DAYS,
    orderAgeDays,
    orderEstimateUsd,
    orderExpired,
    reminderDue,
    usgsOrderSchema,
    type UsgsOrder,
} from '../../src/schemas/usgs-order.js';
import { validate } from '../../src/schemas/validation.js';

const ORDERED_AT = new Date('2026-10-01T09:30:00Z');

function order(changes: Partial<UsgsOrder> = {}): UsgsOrder {
    return {
        state: 'ordered',
        orderedAt: timestampFromDate(ORDERED_AT),
        orderedBy: 'uid-owner',
        checks: 0,
        nextCheckAt: timestampFromDate(new Date('2026-10-02T09:30:00Z')),
        remindersSent: [],
        ...changes,
    };
}

const day = (days: number): Date => new Date(ORDERED_AT.getTime() + days * 86_400_000);

describe('the order record', () => {
    it('happyPath_aFreshOrderValidates', () => {
        expect(validate(usgsOrderSchema, order()).ok).toBe(true);
    });

    it.each([
        ['an unknown state', { state: 'paid' }],
        ['a reminder day USGS never asks for', { remindersSent: [3] }],
        ['three reminders', { remindersSent: [7, 12, 12] }],
        ['an error that is no code', { lastError: 'oops' }],
    ])('badPath_%s_isRefused', (_name, changes) => {
        expect(validate(usgsOrderSchema, { ...order(), ...changes }).ok).toBe(false);
    });

    it('happyPath_aSceneCarriesItsOrderAndItsEarthExplorerDataset', () => {
        const shape = usgsSceneDocSchema.shape;

        expect(shape.order.safeParse(order({ state: 'reminder', remindersSent: [7] })).success).toBe(true);
        expect(shape.eeDatasetId.safeParse('5e839ff7d71d4811').success).toBe(true);
        expect(shape.eeDatasetId.safeParse('../5e839ff7').success).toBe(false);
    });
});

describe('acquisitionState', () => {
    it.each([
        [{ status: 'candidate', downloadAvailable: true }, 'available'],
        [{ status: 'candidate', downloadAvailable: false }, 'needsOrder'],
        [{ status: 'ordered', downloadAvailable: false }, 'needsOrder'],
        [{ status: 'imported', downloadAvailable: true }, 'imported'],
        [{ status: 'candidate', downloadAvailable: false, order: { state: 'delivered' } }, 'delivered'],
        [{ status: 'imported', downloadAvailable: true, order: { state: 'importing' } }, 'importing'],
    ] as const)('happyPath_%j_is_%s', (scene, state) => {
        expect(acquisitionState(scene)).toBe(state);
    });
});

describe('the EarthExplorer page of a scene', () => {
    it('happyPath_corona2UsesTheVerifiedDatasetId', () => {
        expect(earthExplorerSceneUrl({ dataset: 'corona2', entityId: 'DS1105-1071DF076' })).toBe(
            'https://earthexplorer.usgs.gov/scene/metadata/full/5e839febdccb64b3/DS1105-1071DF076/',
        );
    });

    it('happyPath_theSceneOwnDatasetIdWins', () => {
        expect(earthExplorerSceneUrl({ dataset: 'declassii', entityId: 'DZB1213-500159L010001', eeDatasetId: '5e839ff7d71d4811' })).toBe(
            'https://earthexplorer.usgs.gov/scene/metadata/full/5e839ff7d71d4811/DZB1213-500159L010001/',
        );
    });

    it.each([
        ['a dataset whose id is not known yet', { dataset: 'declassiii', entityId: 'D3C1209-100055F012' }],
        ['a malformed dataset id', { dataset: 'declassii', entityId: 'DZB1', eeDatasetId: 'x/../y' }],
        ['a malformed entity id', { dataset: 'corona2', entityId: 'DS1/../x' }],
    ] as const)('badPath_%s_hasNoLink', (_name, scene) => {
        expect(earthExplorerSceneUrl(scene)).toBeUndefined();
    });
});

describe('the cost, the reminders and the end of the wait', () => {
    it.each([
        [1, 35],
        [3, 95],
        [0, 0],
    ])('happyPath_%i_frames_cost_%i_dollars', (frames, usd) => {
        expect(orderEstimateUsd(frames)).toBe(usd);
    });

    it('happyPath_theAgeCountsWholeDays', () => {
        expect(orderAgeDays(order(), day(6.99))).toBe(6);
        expect(orderAgeDays(order(), day(7))).toBe(7);
    });

    it.each([
        [6, [], null],
        [7, [], 7],
        [8, [7], null],
        [12, [7], 12],
        [13, [], 12],
        [14, [12], null],
        [20, [7, 12], null],
    ] as const)('happyPath_day%i_with_%j_owes_%s', (days, sent, due) => {
        expect(reminderDue(order({ remindersSent: [...sent] }), day(days))).toBe(due);
    });

    it('badPath_aDeliveredOrderOwesNoReminder', () => {
        expect(reminderDue(order({ state: 'delivered' }), day(12))).toBeNull();
    });

    it('happyPath_anOrderNeverDeliveredExpires', () => {
        expect(orderExpired(order({ state: 'reminder', remindersSent: [7, 12] }), day(ORDER_GIVE_UP_DAYS))).toBe(true);
        expect(orderExpired(order(), day(ORDER_GIVE_UP_DAYS - 1))).toBe(false);
    });

    it('badPath_anImportedOrderNeverExpires', () => {
        expect(orderExpired(order({ state: 'imported' }), day(ORDER_GIVE_UP_DAYS + 10))).toBe(false);
    });
});
