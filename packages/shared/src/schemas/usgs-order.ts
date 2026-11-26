/**
 * Buying a scan (M4, scenario A13; `docs/research/M4-interfaces.md` §1): a frame USGS has not scanned yet is ordered by the
 * admin in EarthExplorer (a human step: $30 a frame and $5 an order, paid to USGS, never by Claude), marked ordered with
 * one click (`usgs.markOrdered`), then watched every day until USGS lists its download (`download-options`), imported on
 * its own into the M3 job pipeline, and the admin is reminded on days 7 and 12, because USGS deletes an unpaid order
 * after two weeks. The order lives on the scene (`cities/{city}/usgsScenes/{entityId}.order`), written by the functions
 * only; `acquisitionState` gives the one state every screen shows.
 */
import { z } from 'zod';

import { apiErrorCodeSchema } from '../api/errors.js';
import { timestampSchema, timestampToDate, uidSchema } from './firestore-common.js';
import type { USGS_DATASETS } from './firestore.js';
import { coded, idSchema, isId } from './primitives.js';

/**
 * Where an order stands: marked `ordered` (watched daily), `reminder` (day 7 passed without delivery: the admin is
 * reminded to pay, again on day 12), `delivered` (USGS lists the download), `importing` (its `usgs-import` job runs),
 * `imported` (its layer version left processing), `expired` (never delivered within `ORDER_GIVE_UP_DAYS`).
 */
export const ORDER_STATES = ['ordered', 'reminder', 'delivered', 'importing', 'imported', 'expired'] as const;

export type OrderState = (typeof ORDER_STATES)[number];

/**
 * What a scene shows the admin, in one word (the chip of its card): `available` (already scanned: Import is free),
 * `needsOrder` (it must be bought first), or the state of its order. A scene imported for free in M3 is `imported`.
 */
export const SCENE_ACQUISITION_STATES = ['available', 'needsOrder', ...ORDER_STATES] as const;

export type SceneAcquisitionState = (typeof SCENE_ACQUISITION_STATES)[number];

/** The orders still waiting for USGS: the daily watch asks `download-options` for these. */
export const WATCHED_ORDER_STATES = ['ordered', 'reminder'] as const;

/** USGS's price of an on-demand scan (7 µm), per frame, and its handling fee per order, in US dollars (2024 price list). */
export const USGS_SCAN_PRICE_USD = 30;
export const USGS_ORDER_FEE_USD = 5;

/** The days after `orderedAt` on which the admin is reminded that USGS deletes an unpaid order after 14 days. */
export const ORDER_REMINDER_DAYS = [7, 12] as const;

/** An order USGS has not delivered after this many days is `expired` (USGS quotes 3 to 4 weeks after payment). */
export const ORDER_GIVE_UP_DAYS = 90;

/** The watch asks USGS about an order once a day; after a USGS failure it tries again sooner. */
export const ORDER_CHECK_EVERY_HOURS = 24;
export const ORDER_RETRY_HOURS = 6;

/** "Check now" (`usgs.checkOrder`) asks USGS about one order at most once a minute. */
export const ORDER_CHECK_NOW_MIN_SECONDS = 60;

/**
 * EarthExplorer's own id of a dataset, which its scene page needs (it differs from the M2M alias). `corona2`'s was read
 * from M2M `dataset-search` and its scene page opened on 2026-10-11 (`docs/research/design-review-onboarding.md` §0.6);
 * the other two are read at run time and stored on each scene (`eeDatasetId`).
 */
export const EARTH_EXPLORER_DATASET_IDS: Readonly<Partial<Record<(typeof USGS_DATASETS)[number], string>>> = {
    corona2: '5e839febdccb64b3',
};

/** EarthExplorer's dataset ids are short lowercase hexadecimal strings (`5e839febdccb64b3`). */
export const EE_DATASET_ID_PATTERN = /^[a-f0-9]{8,32}$/;

const reminderDaySchema = z
    .number()
    .int()
    .refine((day) => (ORDER_REMINDER_DAYS as readonly number[]).includes(day), coded('validation.value'));

/** `usgsScenes/{entityId}.order`: written by `usgs.markOrdered`, `usgs.checkOrder`, `usgs.cancelOrder` and the watch. */
export const usgsOrderSchema = z.strictObject({
    state: z.enum(ORDER_STATES),
    orderedAt: timestampSchema,
    /** The admin who clicked "I ordered it". */
    orderedBy: uidSchema,
    /** How many times USGS was asked (the watch and "Check now"). */
    checks: z.number().int().min(0).max(10_000),
    lastCheckedAt: timestampSchema.optional(),
    /** When the watch asks next (daily; sooner after a USGS failure). */
    nextCheckAt: timestampSchema,
    /** The reminders already sent (`ORDER_REMINDER_DAYS`), so each is sent once. */
    remindersSent: z.array(reminderDaySchema).max(ORDER_REMINDER_DAYS.length),
    deliveredAt: timestampSchema.optional(),
    /** The `usgs-import` job the delivery started (its layer version has the same id). */
    importJobId: idSchema.optional(),
    importedAt: timestampSchema.optional(),
    expiredAt: timestampSchema.optional(),
    /** The last check that failed, as an error code (USGS maintenance, a refused token): the card says so. */
    lastError: apiErrorCodeSchema.optional(),
});

export type UsgsOrder = z.infer<typeof usgsOrderSchema>;

/** The scene fields `acquisitionState` reads. */
interface AcquisitionInput {
    readonly status: string;
    readonly downloadAvailable: boolean;
    readonly order?: Pick<UsgsOrder, 'state'> | undefined;
}

/**
 * The scene's one state: its order's when it has one; `imported` after a free import; else whether it is already scanned.
 * A legacy `status: 'ordered'` without an order (a client could write it in M3) is `needsOrder`.
 */
export function acquisitionState(scene: AcquisitionInput): SceneAcquisitionState {
    if (scene.order !== undefined) {
        return scene.order.state;
    }
    if (scene.status === 'imported') {
        return 'imported';
    }
    return scene.downloadAvailable ? 'available' : 'needsOrder';
}

/** What buying `frames` frames costs in one order, in US dollars ($30 a frame plus $5 an order). */
export function orderEstimateUsd(frames: number): number {
    return frames <= 0 ? 0 : frames * USGS_SCAN_PRICE_USD + USGS_ORDER_FEE_USD;
}

/**
 * The scene's page in EarthExplorer, where the admin signs in and clicks Order for the on-demand order (the verified
 * pattern `https://earthexplorer.usgs.gov/scene/metadata/full/{datasetId}/{entityId}/`), or undefined when the dataset's
 * EarthExplorer id is not known yet or either id is malformed (the screen then names the entity id to search for).
 */
export function earthExplorerSceneUrl(scene: {
    readonly dataset: (typeof USGS_DATASETS)[number];
    readonly entityId: string;
    readonly eeDatasetId?: string | undefined;
}): string | undefined {
    const datasetId = scene.eeDatasetId ?? EARTH_EXPLORER_DATASET_IDS[scene.dataset];
    if (datasetId === undefined || !EE_DATASET_ID_PATTERN.test(datasetId) || !isId(scene.entityId)) {
        return undefined;
    }
    return `https://earthexplorer.usgs.gov/scene/metadata/full/${datasetId}/${scene.entityId}/`;
}

const MS_PER_DAY = 86_400_000;

/** Whole days since the order was marked (day 0 is the day of the click). */
export function orderAgeDays(order: Pick<UsgsOrder, 'orderedAt'>, now: Date): number {
    return Math.floor((now.getTime() - timestampToDate(order.orderedAt).getTime()) / MS_PER_DAY);
}

/**
 * The reminder the watch owes an order that is still waiting: the latest of `ORDER_REMINDER_DAYS` it has reached that is
 * later than every reminder sent (a watch that missed day 7 sends day 12's only), or null (a delivered, imported or
 * expired order owes none).
 */
export function reminderDue(order: Pick<UsgsOrder, 'state' | 'orderedAt' | 'remindersSent'>, now: Date): number | null {
    if (!(WATCHED_ORDER_STATES as readonly string[]).includes(order.state)) {
        return null;
    }
    const age = orderAgeDays(order, now);
    const last = Math.max(0, ...order.remindersSent);
    return ORDER_REMINDER_DAYS.filter((day) => day <= age && day > last).at(-1) ?? null;
}

/** True when an order still waiting for USGS has passed `ORDER_GIVE_UP_DAYS`: the watch marks it `expired`. */
export function orderExpired(order: Pick<UsgsOrder, 'state' | 'orderedAt'>, now: Date): boolean {
    return (WATCHED_ORDER_STATES as readonly string[]).includes(order.state) && orderAgeDays(order, now) >= ORDER_GIVE_UP_DAYS;
}
