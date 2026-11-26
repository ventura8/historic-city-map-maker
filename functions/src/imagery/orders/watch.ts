/**
 * The order watch, `imagery.tick`'s step `orders` (`docs/research/M4-interfaces.md` §1.5): no scheduler of its own. Per
 * city, the orders due (asked about once a day, at most 50 a run) are asked about in one USGS session when USGS lets the
 * city download; then every open order moves on by itself: a reminder on days 7 and 12 (USGS deletes an unpaid order
 * after two weeks), `expired` after `ORDER_GIVE_UP_DAYS`, a delivered scan imported into the M3 pipeline when the budget
 * guard is green and today's raster jobs allow (else on a later tick), and an import whose version left processing
 * `imported`. An import that ended for good takes its order off the scene with it (`freedScene`), so Import is offered and
 * nothing here starts it again. It runs while the guard is red: asking and reminding cost nothing; only the import waits.
 */
import {
    FIRESTORE_PATHS,
    ORDER_GIVE_UP_DAYS,
    layerVersionDocSchema,
    orderExpired,
    reminderDue,
    usgsSceneDocSchema,
    type LayerVersionState,
    type OrderState,
    type UsgsOrder,
} from '@hcm/shared';

import { startImport } from '../import.js';
import { refuseNewRasterJob, type Placement } from '../limits.js';
import { IMAGERY_WRITER, usgsRecord } from '../records.js';
import { usgsDownloads } from '../usgs-session.js';
import { checkOrders, type CheckDeps } from './check.js';
import { emitOrderEvent, type OrderEvent } from './events.js';
import { checkDue, expired, imported, reminded } from './order.js';
import { orderIn, updateOrder, type CityNow, type OrderedScene } from './scene-order.js';

type OrderWatchDeps = CheckDeps;

/** The orders the watch moves on: every one not imported or given up yet. */
const ACTIVE_ORDER_STATES: readonly OrderState[] = ['ordered', 'reminder', 'delivered', 'importing'];
/** USGS is asked about at most this many orders a run (the rest wait for the next tick). */
const DUE_PER_RUN = 50;
/** A version in these states has not left processing for good: the import is not done. */
const NOT_IMPORTED: readonly LayerVersionState[] = ['processing', 'failed', 'cancelled', 'rejected'];

/** The city's open orders (a handful: each is a scan the admin bought). */
async function activeOrders(deps: OrderWatchDeps, cityId: string): Promise<OrderedScene[]> {
    const found = await deps.documents.query(FIRESTORE_PATHS.usgsScenes(cityId), usgsSceneDocSchema, {
        where: [['order.state', 'in', [...ACTIVE_ORDER_STATES]]],
    });
    return found.documents.map((document) => document.data).filter((scene) => orderIn(scene, ACTIVE_ORDER_STATES));
}

/** Steps 1–2: the due orders asked about, when USGS lets the city download. */
async function askDue(deps: OrderWatchDeps, cityId: string, now: Date): Promise<void> {
    const due = (await activeOrders(deps, cityId)).filter((scene) => checkDue(scene.order, now)).slice(0, DUE_PER_RUN);
    const usgs = await usgsRecord(deps.setup);
    if (due.length > 0 && usgs !== undefined && usgsDownloads(usgs)) {
        await checkOrders(deps, cityId, due);
    }
}

/** A move of an order: its new record, and what the admins are told. */
interface Step {
    readonly next: (order: UsgsOrder) => UsgsOrder;
    readonly event: OrderEvent;
}

/** Moves the order on while it is still in the state it was read in, then tells the admins. */
async function moveTo(deps: OrderWatchDeps, at: CityNow, scene: OrderedScene, step: Step): Promise<void> {
    const written = await updateOrder(
        deps.documents,
        { cityId: at.cityId, entityId: scene.entityId, states: [scene.order.state] },
        (current) => ({ ...current, order: step.next(current.order) }),
        { by: IMAGERY_WRITER, now: at.now },
    );
    if (written !== undefined) {
        await emitOrderEvent(deps, at, written, step.event);
    }
}

/** Step 3: a waiting order past `ORDER_GIVE_UP_DAYS` expires; else the reminder it owes is sent. */
async function remindOrExpire(deps: OrderWatchDeps, cityId: string, scene: OrderedScene, now: Date): Promise<void> {
    if (orderExpired(scene.order, now)) {
        const event = { kind: 'order.expired', days: ORDER_GIVE_UP_DAYS } as const;
        await moveTo(deps, { cityId, now }, scene, { next: (order) => expired(order, now), event });
        return;
    }
    const day = reminderDue(scene.order, now);
    if (day !== null) {
        await moveTo(deps, { cityId, now }, scene, { next: (order) => reminded(order, day), event: { kind: 'order.reminder', day } });
    }
}

/** Where a new raster job runs when it may start now (the budget guard green, today's jobs under the caps); else it waits. */
async function importAllowed(deps: OrderWatchDeps, now: Date, cityId: string): Promise<Placement | undefined> {
    try {
        return await refuseNewRasterJob(deps.documents, now, cityId);
    } catch (error) {
        deps.log.info('a delivered order waits for its import', { reason: String(error) });
        return undefined;
    }
}

/**
 * Step 4: a delivered scan imported as a free one is (`imagery.import`'s transaction), by the admin who ordered it; the
 * order becomes `importing` in the same transaction. Returns the import's job id, or undefined while it waits.
 */
export async function importDelivered(deps: OrderWatchDeps, cityId: string, scene: OrderedScene, now: Date): Promise<string | undefined> {
    const placement = await importAllowed(deps, now, cityId);
    if (placement === undefined) {
        return undefined;
    }
    const { jobId } = await startImport(deps, { cityId, scene, createdBy: scene.order.orderedBy, now, ...placement });
    deps.log.info('a delivered order is importing', { cityId, entityId: scene.entityId, jobId });
    return jobId;
}

/** Step 5: the import's version left processing (and did not fail or stop): the order is `imported`. */
async function finishImport(deps: OrderWatchDeps, cityId: string, scene: OrderedScene, now: Date): Promise<void> {
    const versionId = scene.order.importJobId;
    if (versionId === undefined) {
        return;
    }
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionDocSchema);
    if (version !== undefined && !NOT_IMPORTED.includes(version.state)) {
        await moveTo(deps, { cityId, now }, scene, { next: (order) => imported(order, now), event: { kind: 'order.imported', versionId } });
    }
}

/** Steps 3–5 for one order, by its state. */
async function moveOn(deps: OrderWatchDeps, cityId: string, scene: OrderedScene, now: Date): Promise<void> {
    const state = scene.order.state;
    if (state === 'delivered') {
        await importDelivered(deps, cityId, scene, now);
    } else if (state === 'importing') {
        await finishImport(deps, cityId, scene, now);
    } else {
        await remindOrExpire(deps, cityId, scene, now);
    }
}

/** The watch over one city's orders; one order's failure is logged and the others still move on. */
export async function watchOrders(deps: OrderWatchDeps, cityId: string, now: Date): Promise<void> {
    await askDue(deps, cityId, now);
    for (const scene of await activeOrders(deps, cityId)) {
        await moveOn(deps, cityId, scene, now).catch((error: unknown) => {
            deps.log.error('an order did not move on', { cityId, entityId: scene.entityId, error: String(error) });
        });
    }
}
