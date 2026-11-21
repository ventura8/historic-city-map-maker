/**
 * Orders in the Imagery area's lists (`docs/research/M4-interfaces.md` §1.7): a short chip of an order's state on the
 * scene's card, and Work's orders (every scan bought and not imported yet, live, the one that needs the admin first: an
 * order never delivered, until it is ordered again or its mark taken back); every open order counts in Work's tab
 * (finding 54 of 2026-11-01). A reminder to pay is no longer the admin's to clear once it was sent: it waits like any order.
 */
import type { AdminContentKey, UiLocale, OrderState } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { current } from '../../editing/states.js';
import { EMPTY } from '../../shell/empty.js';
import { contentText } from '../../shell/text.js';
import type { ImageryContext } from '../context.js';
import type { ImageryViewState, SceneItemPort } from '../imagery-port.js';
import { dayText } from '../imagery-text.js';
import { frameName } from '../join/live-join.js';
import { withValue } from '../when.js';

/** The orders the admin has to act on (and can: Order it again, or Take the mark back). */
const NEEDS_YOU: readonly OrderState[] = ['expired'];

type ShownState = Exclude<OrderState, 'imported'>;

const TONES: Readonly<Record<ShownState, 'good' | 'wait' | 'error'>> = {
    ordered: 'wait',
    reminder: 'wait',
    delivered: 'good',
    importing: 'good',
    expired: 'error',
};

/** A scene's order not imported yet, by its state. */
function openState(scene: SceneItemPort): ShownState | null {
    const state = scene.order?.state ?? 'imported';
    return state === 'imported' ? null : state;
}

/** The short chip of a scene's open order (the scene's page says it in full); none without one. */
export function orderTag(locale: UiLocale, scene: SceneItemPort): TemplateResult {
    const state = openState(scene);
    if (state === null) {
        return EMPTY;
    }
    const label = contentText(locale, `adminContent.orders.tag.${state}`);
    return html`<span class="tag" data-tone=${TONES[state]}>${label}</span>`;
}

/** The orders not imported yet. */
function openOrders(view: ImageryViewState): SceneItemPort[] {
    return view.orders.items.filter((scene) => openState(scene) !== null);
}

/** An order never delivered. */
function needsYou(scene: SceneItemPort): boolean {
    return scene.order !== null && NEEDS_YOU.includes(scene.order.state);
}

function orderRow(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale, view } = context;
    const selected = view.detail?.kind === 'scene' && view.detail.id === scene.id;
    return html`<li data-order=${scene.id}>
        <a class="row" href=${context.href(['scene', scene.id])} aria-current=${current(selected)}>
            <span class="row-title">${scene.sensorName} · ${dayText(locale, scene.date)}</span>
            <span class="chips">${orderTag(locale, scene)}</span>
        </a>
    </li>`;
}

/** Work's orders, the ones that need the admin first; none while there is no open order. */
export function ordersGroup(context: ImageryContext): TemplateResult {
    const orders = openOrders(context.view);
    if (orders.length === 0) {
        return EMPTY;
    }
    return html`<section class="section" aria-labelledby="imagery-orders">
        <h3 id="imagery-orders">${contentText(context.locale, 'adminContent.orders.group')}</h3>
        <ul class="rows">
            ${orders.toSorted((a, b) => Number(needsYou(b)) - Number(needsYou(a))).map((scene) => orderRow(context, scene))}
        </ul>
    </section>`;
}

/** How many orders Work lists (they count in its tab, with the unfinished versions: finding 54 of 2026-11-01). */
export function openOrderCount(view: ImageryViewState): number {
    return openOrders(view).length;
}

/** The open order of a paid frame, when Work's orders know one. */
function openOrder(context: ImageryContext, entityId: string): SceneItemPort | undefined {
    return context.view.orders.items.find((scene) => scene.id === entityId && scene.order !== null);
}

/**
 * The words of a paid frame's link: Buy this scan without an order, Order it again once its order expired (the order
 * card offers it there; the red chip alone read as nothing to do), else Your order.
 */
function paidFrameKey(ordered: SceneItemPort | undefined): AdminContentKey {
    if (ordered === undefined) {
        return 'adminContent.imagery.join.buyFrame';
    }
    return needsYou(ordered) ? 'adminContent.imagery.join.orderAgainFrame' : 'adminContent.imagery.join.orderedFrame';
}

/**
 * One paid frame of the row (2026-11-12: only the first was linked): Buy this scan opens the frame's own page, where the
 * order card (M4) buys it; a frame already ordered says so, with its order's chip, and opens the same page (an expired
 * order reads Order it again).
 * In the Imagery chunk, beside the orders' other rows: the join's chunk has no room for it.
 */
function paidFrame(context: ImageryContext, entityId: string, cloudy: number | undefined): TemplateResult {
    const { locale } = context;
    const ordered = openOrder(context, entityId);
    const key = paidFrameKey(ordered);
    return html`<li data-paid=${entityId}>
        <a class="external" href=${context.href(['scene', entityId])} data-state="join-buy"
            >${contentText(locale, key, { frame: frameName(entityId) })}</a
        >
        ${withValue(ordered, (scene) => orderTag(locale, scene))}
        ${withValue(
            cloudy,
            (percent) =>
                html`<p class="note" data-state="join-cloudy">
                    ${contentText(locale, 'adminContent.imagery.cloudy.beforeBuying', { percent: String(percent) })}
                </p>`,
        )}
    </li>`;
}

/** A frame the plan found probably cloudy over the city (`cloudyFrames` of the row). */
interface CloudyFrame {
    readonly entityId: string;
    readonly percent: number;
}

/**
 * Every paid frame of a whole-city date, each with its own Buy this scan (M8's row, `join-card.ts`); one probably cloudy over the
 * city warns before anyone buys it (the owner's report of 2026-11-13).
 */
export function paidFrameList(context: ImageryContext, entityIds: readonly string[], cloudy: readonly CloudyFrame[] = []): TemplateResult {
    return html`<ul class="steps" data-join-paid-frames>
        ${entityIds.map((entityId) => paidFrame(context, entityId, cloudy.find((frame) => frame.entityId === entityId)?.percent))}
    </ul>`;
}
