/**
 * The Imagery area's work (`docs/research/M3-interfaces.md` §10.2): the unfinished versions, live, those that wait for
 * the admin (points, an approval, a compute-unit choice, a failure to retry) apart from those in progress, each with its
 * job's progress or wait in words. M4: the scans bought and not imported yet come first (`orders/order-list.ts`). M12: a waiting row
 * shows the version's small picture, so the owner knows it at a glance, with no map.
 */
import { html, type TemplateResult } from 'lit';

import { current, errorTemplate, loadingTemplate } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { VersionItemPort } from './imagery-port.js';
import { labelText, versionDetail } from './imagery-text.js';
import { liveJoin, versionMark } from './join/live-join.js';
import { openOrderCount, ordersGroup } from './orders/order-list.js';

/** M8: a frame a live join holds has nothing to ask of the admin but its points; the join's own row asks the rest. */
function waitsForYou(version: VersionItemPort, versions: readonly VersionItemPort[]): boolean {
    return version.needsYou && (version.state === 'needs_gcps' || !liveJoin(versions, version.partOf));
}

/** The row's small picture, once made (decorative: the row's text names the version). */
function thumb(context: ImageryContext, version: VersionItemPort): TemplateResult {
    const url = context.view.thumbs[version.id];
    return url === undefined
        ? html`<span class="thumb" aria-hidden="true"><hcm-icon name="satellite_alt"></hcm-icon></span>`
        : html`<img class="thumb" src=${url} alt="" />`;
}

function versionRow(context: ImageryContext, version: VersionItemPort): TemplateResult {
    const { locale, view } = context;
    const selected = view.detail?.kind === 'version' && view.detail.id === version.id;
    // A join and its frames share a label and a year: this tells them apart.
    const mark = versionMark(locale, version.origin, version.entityIds[0]);
    return html`<li data-version=${version.id} data-state=${version.state}>
        <a class="row scene" href=${context.href(['version', version.id])} aria-current=${current(selected)}>
            ${thumb(context, version)}
            <span>
                <span class="row-title">${labelText(version.label, locale)} · ${version.year}${mark === null ? '' : ` · ${mark}`}</span>
                <span class="row-detail">${versionDetail(locale, version, view.jobs[version.id])}</span>
            </span>
        </a>
    </li>`;
}

type Heading = 'adminContent.imagery.needsYou' | 'adminContent.imagery.inProgress' | 'adminContent.imagery.tooCoarse';

const HEADING_IDS: Readonly<Record<Heading, string>> = {
    'adminContent.imagery.needsYou': 'imagery-needs-you',
    'adminContent.imagery.inProgress': 'imagery-in-progress',
    'adminContent.imagery.tooCoarse': 'imagery-too-coarse',
};

/** Admin sweep 2026-11-14 (bug 5): why the Argon frames are set aside, and that nothing is asked of the owner. */
function coarseNote(context: ImageryContext, heading: Heading): TemplateResult {
    return heading === 'adminContent.imagery.tooCoarse'
        ? html`<p class="note">${contentText(context.locale, 'adminContent.imagery.tooCoarseNote')}</p>`
        : EMPTY;
}

function group(context: ImageryContext, heading: Heading, versions: readonly VersionItemPort[]): TemplateResult {
    if (versions.length === 0) {
        return EMPTY;
    }
    const id = HEADING_IDS[heading];
    return html`<section class="section" aria-labelledby=${id}>
        <h3 id=${id}>${contentText(context.locale, heading)}</h3>
        ${coarseNote(context, heading)}
        <ul class="rows">
            ${versions.map((version) => versionRow(context, version))}
        </ul>
    </section>`;
}

export function workView(context: ImageryContext): TemplateResult {
    const { locale, view, intents } = context;
    const list = view.versions;
    if (list.status === 'error') {
        return errorTemplate(locale, list.failure, () => intents?.retry());
    }
    if (list.items.length === 0 && openOrderCount(view) === 0) {
        return list.status === 'loading'
            ? loadingTemplate(locale)
            : html`<hcm-empty-state icon="pending" .text=${contentText(locale, 'adminContent.imagery.noWork')}></hcm-empty-state>`;
    }
    return html`${ordersGroup(context)}
    ${group(
        context,
        'adminContent.imagery.needsYou',
        list.items.filter((version) => waitsForYou(version, list.items)),
    )}
    ${group(
        context,
        'adminContent.imagery.inProgress',
        list.items.filter((version) => !version.tooCoarse && !waitsForYou(version, list.items)),
    )}
    ${group(
        context,
        'adminContent.imagery.tooCoarse',
        list.items.filter((version) => version.tooCoarse),
    )}`;
}
