/**
 * A scene's order card (`docs/research/M4-interfaces.md` §1.7; behaviour A13): on a scene USGS has not scanned yet, what
 * the scan costs (paid to USGS by the admin: never by this app), how to order it in EarthExplorer, the scene's own
 * EarthExplorer page (a new tab) and **I ordered it**: the flow's two inputs. Once ordered: where the order stands, when
 * USGS is asked next (in the admin's own time zone), the last failed check in words, **Check now** and **Take the mark
 * back**; a reminder to pay; a delivered scan's import; and, for an order never delivered, **Order it again** or **Take
 * the mark back**. Before USGS approves the account's downloads, both cards say the daily check waits for it and link to
 * Setup's USGS step. A scene USGS offers has no card (Import is free).
 */
import { orderEstimateUsd, type UiLocale, type SceneAcquisitionState } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { formatDay, formatWhen } from '../../editing/states.js';
import { EMPTY } from '../../shell/empty.js';
import { contentText, noticeOf } from '../../shell/text.js';
import type { ImageryContext } from '../context.js';
import type { SceneItemPort, SceneOrderPort } from '../imagery-port.js';
import { numberText } from '../imagery-text.js';
import { sceneRefusal, usgsSetupLink } from '../scene-refusal.js';
import { when, withValue } from '../when.js';

/** EarthExplorer's home, for a scene whose page is not known yet (the admin searches its entity id there). */
export const EARTH_EXPLORER_HOME = 'https://earthexplorer.usgs.gov/';

/**
 * The steps of an on-demand order from the scene's EarthExplorer page, as the owner ordered D3C1216-100235F038 on
 * 2026-11-08 (`M4-interfaces.md` §10): Login, Order at the page's bottom, the Scene List's 7 Micron and Submit Product
 * Selections, then USGS's form and pay.gov. The scene page has no basket: the Item Basket path is for search results.
 */
const GUIDE = [
    'adminContent.orders.guide.signIn',
    'adminContent.orders.guide.order',
    'adminContent.orders.guide.selections',
    'adminContent.orders.guide.pay',
] as const;

/**
 * A reminder waits like any order once it is sent (the push and the inbox said it): an admin who paid has nothing to do,
 * so it is no error.
 */
const TONES: Readonly<Record<SceneAcquisitionState, 'good' | 'wait' | 'error'>> = {
    available: 'good',
    needsOrder: 'wait',
    ordered: 'wait',
    reminder: 'wait',
    delivered: 'good',
    importing: 'good',
    imported: 'good',
    expired: 'error',
};

/** The scene's state in words, as a chip. */
function stateChip(locale: UiLocale, state: SceneAcquisitionState): TemplateResult {
    return html`<p class="chips">
        <span class="tag" data-tone=${TONES[state]}>${contentText(locale, `adminContent.orders.state.${state}`)}</span>
    </p>`;
}

/** The scene's EarthExplorer page in a new tab, or (unknown) its entity id to search for on EarthExplorer's home. */
function earthExplorerLink(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    const newTab = html`<span class="visually-hidden"> ${contentText(locale, 'adminContent.orders.newTab')}</span>`;
    if (scene.earthExplorerUrl !== null) {
        return html`<a class="ee-link" href=${scene.earthExplorerUrl} target="_blank" rel="noopener noreferrer"
            >${contentText(locale, 'adminContent.orders.open')}${newTab}</a
        >`;
    }
    return html`<p class="note" data-state="no-link">${contentText(locale, 'adminContent.orders.noLink', { entityId: scene.id })}</p>
        <a class="external" href=${EARTH_EXPLORER_HOME} target="_blank" rel="noopener noreferrer"
            >${contentText(locale, 'adminContent.orders.searchEarthExplorer')}${newTab}<hcm-icon name="open_in_new"></hcm-icon
        ></a>`;
}

/** An order action's button, off while any order action runs (or the admin may not write). */
function actionButton(
    context: ImageryContext,
    options: {
        readonly label: Parameters<typeof contentText>[1];
        readonly icon: string;
        readonly variant: string;
        readonly run: () => void;
    },
): TemplateResult {
    const off = context.view.ordering !== null || context.readOnly;
    return html`<hcm-button variant=${options.variant} icon=${options.icon} ?disabled=${off} @click=${options.run}
        >${contentText(context.locale, options.label)}</hcm-button
    >`;
}

/** USGS has not approved the account's downloads: nothing asks USGS about the order until it does (the watch's rule). */
function waitsForApproval(context: ImageryContext): boolean {
    return context.view.usgs === 'pending';
}

/** Why the daily check has not started, and the way to Setup's USGS step. */
function approvalNote(context: ImageryContext): TemplateResult {
    const { locale } = context;
    return when(
        waitsForApproval(context),
        () =>
            html`<div class="alert" role="status" data-state="waits-for-approval">
                <hcm-icon name="schedule"></hcm-icon>
                <div class="alert-body">
                    <p>${contentText(locale, 'adminContent.orders.waitsForApproval')}</p>
                    ${usgsSetupLink(locale)}
                </div>
            </div>`,
    );
}

/** A scene to buy (or an order never delivered, to buy again): the price, the guide, EarthExplorer, I ordered it. */
function buyCard(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    const again = scene.acquisition === 'expired';
    const estimate = { usd: numberText(locale, orderEstimateUsd(1), 0), frames: '1' };
    return html`<section class="order-card" aria-labelledby="order-heading" data-state=${again ? 'expired' : 'needs-order'}>
        <h3 id="order-heading">${contentText(locale, again ? 'adminContent.orders.headingAgain' : 'adminContent.orders.heading')}</h3>
        ${stateChip(locale, scene.acquisition)} ${when(again, () => html`<p>${contentText(locale, 'adminContent.orders.expiredNote')}</p>`)}
        <p>${contentText(locale, 'adminContent.orders.estimate', estimate)}</p>
        <p class="guide-label">${contentText(locale, 'adminContent.orders.guide.label')}</p>
        <ol class="guide">
            ${GUIDE.map((step) => html`<li>${contentText(locale, step)}</li>`)}
        </ol>
        <p>${contentText(locale, 'adminContent.orders.next')}</p>
        <p class="note">${contentText(locale, 'adminContent.orders.timing')} ${contentText(locale, 'adminContent.orders.support')}</p>
        ${approvalNote(context)}
        <div class="actions">
            ${earthExplorerLink(context, scene)}
            ${actionButton(context, {
                label: 'adminContent.orders.markOrdered',
                icon: 'check_circle',
                variant: 'tonal',
                run: () => void markOrdered(context, scene.id),
            })}
            ${when(again, () => takeBack(context, scene))}
        </div>
        ${sceneRefusal(context, orderRefusalOf(context.view), scene)}
    </section>`;
}

/** **I ordered it**; refused, the keyboard goes to the scene's heading (a frame scanned meanwhile takes the card along). */
/** The order card's refusal: Not useful's is its own section's (`scene-unusable.ts`). */
function orderRefusalOf(view: ImageryContext['view']): ImageryContext['view']['orderRefusal'] {
    return view.orderRefusal?.action === 'unusable' ? null : view.orderRefusal;
}

async function markOrdered(context: ImageryContext, id: string): Promise<void> {
    if ((await context.intents?.markOrdered(id)) === false) {
        context.focusDetail();
    }
}

/** **Take the mark back**: an order marked by mistake, cancelled at USGS, or never delivered and no longer wanted. */
function takeBack(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    return actionButton(context, {
        label: 'adminContent.orders.undo',
        icon: 'undo',
        variant: 'text',
        run: () => void context.intents?.cancelOrder(scene.id),
    });
}

/** When USGS is asked next: a time, or after the approval of downloads while there is none. */
function nextCheckText(context: ImageryContext, order: SceneOrderPort): string {
    return waitsForApproval(context)
        ? contentText(context.locale, 'adminContent.orders.fact.afterApproval')
        : formatWhen(context.locale, order.nextCheckAt);
}

/** When the order was marked, when USGS is asked next and when it was asked last (the admin's own time zone). */
function orderFacts(context: ImageryContext, order: SceneOrderPort): TemplateResult {
    const { locale } = context;
    const last =
        order.lastCheckedAt === null ? contentText(locale, 'adminContent.orders.fact.notChecked') : formatWhen(locale, order.lastCheckedAt);
    return html`<dl class="facts">
        <dt>${contentText(locale, 'adminContent.orders.fact.orderedAt')}</dt>
        <dd>${formatDay(locale, order.orderedAt)}</dd>
        <dt>${contentText(locale, 'adminContent.orders.fact.nextCheck')}</dt>
        <dd>${nextCheckText(context, order)}</dd>
        <dt>${contentText(locale, 'adminContent.orders.fact.lastCheck')}</dt>
        <dd>${last}</dd>
    </dl>`;
}

/** The last check that failed, in words (USGS in maintenance, a refused token). */
function lastError(locale: UiLocale, order: SceneOrderPort): TemplateResult {
    return withValue(
        order.lastError,
        (code) =>
            html`<div class="alert" role="status" data-state="last-error">
                <hcm-icon name="warning"></hcm-icon>
                <div class="alert-body">
                    <p>${contentText(locale, 'adminContent.orders.lastError')}</p>
                    <p>${noticeOf(locale, { key: code })}</p>
                </div>
            </div>`,
    );
}

/** An order USGS has not delivered yet: where it stands, Check now, Take the mark back. */
function watchCard(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale, intents } = context;
    return withValue(
        scene.order,
        (order) =>
            html`<section class="order-card" aria-labelledby="order-heading" data-state=${order.state}>
                <h3 id="order-heading">${contentText(locale, 'adminContent.orders.headingOrdered')}</h3>
                ${stateChip(locale, order.state)}
                ${when(
                    order.state === 'reminder',
                    () =>
                        html`<p>${contentText(locale, 'adminContent.orders.reminderNote')}</p>
                            <p>${contentText(locale, 'adminContent.orders.reminderPaid')}</p>`,
                )}
                ${approvalNote(context)} ${orderFacts(context, order)} ${lastError(locale, order)}
                <div class="actions">
                    ${actionButton(context, {
                        label: 'adminContent.orders.checkNow',
                        icon: 'refresh',
                        variant: 'tonal',
                        run: () => void intents?.checkOrder(scene.id),
                    })}
                    ${takeBack(context, scene)}
                </div>
                ${sceneRefusal(context, orderRefusalOf(context.view), scene)}
            </section>`,
    );
}

/** A delivered scan: its import, started by the server (or waiting for the budget guard or today's cap). */
function deliveredCard(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    const importLink = (jobId: string): TemplateResult =>
        html`<p><a href=${context.href(['version', jobId])}>${contentText(locale, 'adminContent.orders.openImport')}</a></p>`;
    return html`<section class="order-card" aria-labelledby="order-heading" data-state=${scene.acquisition}>
        <h3 id="order-heading">${contentText(locale, 'adminContent.orders.headingOrdered')}</h3>
        ${stateChip(locale, scene.acquisition)} ${withValue(scene.order?.importJobId, importLink)}
    </section>`;
}

type Card = (context: ImageryContext, scene: SceneItemPort) => TemplateResult;

/** The card of each state: none for a scene USGS offers or whose order is imported (M3's Import and its link). */
const CARDS: Readonly<Record<SceneAcquisitionState, Card | null>> = {
    available: null,
    needsOrder: buyCard,
    ordered: watchCard,
    reminder: watchCard,
    delivered: deliveredCard,
    importing: deliveredCard,
    imported: null,
    expired: buyCard,
};

/** The scene's order card, by its acquisition state. */
export function orderCard(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const card = CARDS[scene.acquisition];
    return card === null ? EMPTY : card(context, scene);
}
