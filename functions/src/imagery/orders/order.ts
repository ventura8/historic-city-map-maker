/**
 * An order's transitions (`docs/research/M4-interfaces.md` §1.2, §1.3), pure: a new order marked by the admin, the order
 * after one question to USGS (delivered, still waiting, or the failure that leaves it waiting less long), a reminder
 * sent, the give-up, the import started and finished. The callables and the watch read, change and write them in a
 * transaction (`scene-order.ts`).
 */
import {
    ORDER_CHECK_EVERY_HOURS,
    ORDER_RETRY_HOURS,
    timestampFromDate,
    timestampToDate,
    type ApiErrorCode,
    type OrderState,
    type UsgsOrder,
} from '@hcm/shared';

import { omit } from '../../api/objects.js';

const HOUR_MS = 3_600_000;
/** `usgsOrderSchema` counts at most this many questions. */
const MAX_CHECKS = 10_000;

/** The orders "Check now" may ask about and "Take the mark back" may remove: not yet delivered. */
export const OPEN_ORDER_STATES: readonly OrderState[] = ['ordered', 'reminder', 'expired'];

/** What one question to USGS about an order found. */
export type CheckOutcome =
    | { readonly kind: 'available'; readonly datasetId?: string | undefined }
    | { readonly kind: 'waiting' }
    | { readonly kind: 'failed'; readonly code: ApiErrorCode };

function hoursAfter(now: Date, hours: number): UsgsOrder['nextCheckAt'] {
    return timestampFromDate(new Date(now.getTime() + hours * HOUR_MS));
}

/** "I ordered it": marked by `uid` now, first asked about a day later, no reminder sent yet. */
export function newOrder(uid: string, now: Date): UsgsOrder {
    return {
        state: 'ordered',
        orderedAt: timestampFromDate(now),
        orderedBy: uid,
        checks: 0,
        nextCheckAt: hoursAfter(now, ORDER_CHECK_EVERY_HOURS),
        remindersSent: [],
    };
}

/**
 * The order after one question to USGS: counted and stamped; listed → `delivered`; not yet → asked again a day later,
 * the last failure forgotten; a failure (maintenance, a refused token, USGS down) → asked again sooner, its code kept.
 */
export function afterCheck(order: UsgsOrder, outcome: CheckOutcome, now: Date): UsgsOrder {
    const asked: UsgsOrder = {
        ...omit(order, ['lastError']),
        checks: Math.min(MAX_CHECKS, order.checks + 1),
        lastCheckedAt: timestampFromDate(now),
    };
    if (outcome.kind === 'available') {
        return { ...asked, state: 'delivered', deliveredAt: timestampFromDate(now) };
    }
    if (outcome.kind === 'waiting') {
        return { ...asked, nextCheckAt: hoursAfter(now, ORDER_CHECK_EVERY_HOURS) };
    }
    return { ...asked, nextCheckAt: hoursAfter(now, ORDER_RETRY_HOURS), lastError: outcome.code };
}

/** True when the watch should ask USGS about the order now. */
export function checkDue(order: UsgsOrder, now: Date): boolean {
    return (order.state === 'ordered' || order.state === 'reminder') && timestampToDate(order.nextCheckAt) <= now;
}

/** The reminder of `day` sent: the order says so (the state stays `reminder` after the second one). */
export function reminded(order: UsgsOrder, day: number): UsgsOrder {
    return { ...order, state: 'reminder', remindersSent: [...order.remindersSent, day] };
}

/** Never delivered within `ORDER_GIVE_UP_DAYS`: `expired` ("Order again" marks it anew). */
export function expired(order: UsgsOrder, now: Date): UsgsOrder {
    return { ...order, state: 'expired', expiredAt: timestampFromDate(now) };
}

/** The import's version left processing: `imported`. */
export function imported(order: UsgsOrder, now: Date): UsgsOrder {
    return { ...order, state: 'imported', importedAt: timestampFromDate(now) };
}
