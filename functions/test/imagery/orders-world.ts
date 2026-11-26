/**
 * The orders' test world (`docs/research/M4-interfaces.md` §1): the imagery world (`./world.ts`) with scenes USGS has not
 * scanned yet, their orders at any age, the notification events the watch writes, and the callables run as `u-admin`.
 * Every value is a generated test value.
 */
import {
    FIRESTORE_PATHS,
    notificationEventDocSchema,
    timestampFromDate,
    type NotificationEventDoc,
    type UsgsOrder,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { cancelOrderFunction } from '../../src/imagery/orders/take-back.js';
import { checkOrderFunction } from '../../src/imagery/orders/check-now.js';
import { markOrderedFunction } from '../../src/imagery/orders/mark.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, NOW, seedScene, type ImageryWorld } from './world.js';

/** A Corona frame of 1968 that must be bought (the fake USGS's paid twin of the free 1968 frame). */
export const PAID = 'DS1105-1071DF076';
/** A KH-9 mapping frame of 1977 that must be bought (another dataset: another `download-options` call). */
export const PAID_DECLASSII = 'DZB1213-500159L010099';
/** EarthExplorer's id of Corona's dataset (verified, `EARTH_EXPLORER_DATASET_IDS`). */
export const CORONA_EE_ID = '5e839febdccb64b3';
/** Who clicked "I ordered it" (the import's `createdBy`). */
export const ORDERED_BY = 'u-owner';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The instant `days` days (and `hours` hours) after `NOW`. */
export function after(days: number, hours = 0): string {
    return new Date(Date.parse(NOW) + days * DAY_MS + hours * HOUR_MS).toISOString();
}

/** A timestamp `days` days (and `hours` hours) after `NOW`. */
export function stampAfter(days: number, hours = 0) {
    return timestampFromDate(new Date(after(days, hours)));
}

/** An order marked at `NOW` by `ORDERED_BY`, first asked about a day later. */
export function order(overrides: Partial<UsgsOrder> = {}): UsgsOrder {
    return {
        state: 'ordered',
        orderedAt: stampAfter(0),
        orderedBy: ORDERED_BY,
        checks: 0,
        nextCheckAt: stampAfter(1),
        remindersSent: [],
        ...overrides,
    };
}

/** A scene that must be bought (USGS offers no download), with `order` when given. */
export async function seedPaid(world: ImageryWorld, entityId: string, overrides: Partial<UsgsSceneDoc> = {}): Promise<void> {
    await seedScene(world, entityId, {
        downloadAvailable: false,
        acquisitionDate: '1968-12-11',
        rank: { score: 40, reasons: [{ code: 'needsOrder' }], version: 2 },
        ...overrides,
    });
}

/** A scene's `download-options` answer: listed (delivered) or not. */
export function listDownload(world: ImageryWorld, entityId: string, available: boolean, datasetId = CORONA_EE_ID): void {
    world.scenes.options.set(entityId, { entityId, available, bytes: available ? 734_003_200 : 0, datasetId });
}

/** The notification events written so far, by id. */
export async function events(world: ImageryWorld): Promise<Map<string, NotificationEventDoc>> {
    const found = await world.deps.documents.query(FIRESTORE_PATHS.notificationEvents, notificationEventDocSchema);
    return new Map(found.documents.map((document) => [document.id, document.data]));
}

const request = (entityId: string) => adminCall({ cityId: CITY, entityId });

export function markOrdered(world: ImageryWorld, entityId = PAID) {
    return markOrderedFunction(() => world.deps).run(request(entityId));
}

export function checkOrder(world: ImageryWorld, entityId = PAID, fromOrderPage?: boolean) {
    return checkOrderFunction(() => world.deps).run(
        adminCall({ cityId: CITY, entityId, ...(fromOrderPage === true ? { fromOrderPage } : {}) }),
    );
}

export function cancelOrder(world: ImageryWorld, entityId = PAID) {
    return cancelOrderFunction(() => world.deps).run(request(entityId));
}
