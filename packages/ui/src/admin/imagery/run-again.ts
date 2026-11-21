/**
 * Lesson 728 (the owner's request of 2026-11-14): **Run again with the latest pipeline**. A USGS scene (a declassified frame or a
 * Landsat scene) whose version waits for approval, was cancelled or failed is downloaded again for free and run on the current
 * pipeline (`imagery.import` with `again`): a new version of the same layer, the old one kept in its history, no new purchase.
 * Offered on the version's page and, as **Imported: run again**, on Find's card of a scene that already has a version; Find also
 * says the state of an imported scene's unfinished version. The Jobs page has the same button (`../jobs/raster-parts.ts`).
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText, noticeOf } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { SceneItemPort, VersionItemPort, VersionViewPort } from './imagery-port.js';
import { versionStateText } from './imagery-text.js';
import { when, withValue } from './when.js';

/** The version states a run again is offered on: one that waits for approval, was cancelled or failed. */
const RUN_AGAIN_STATES: ReadonlySet<VersionViewPort['state']> = new Set(['awaiting_approval', 'cancelled', 'failed']);

/** An imported scene's unfinished version (the layer it reserved), or undefined for one that has none open. */
function openVersionOf(context: ImageryContext, scene: SceneItemPort): VersionItemPort | undefined {
    return scene.layerId === null ? undefined : context.view.versions.items.find((version) => version.layerId === scene.layerId);
}

/** The USGS scene a version is made of, when it may run again; else null. */
function rerunScene(context: ImageryContext, version: VersionViewPort): string | null {
    const offered = version.origin === 'usgs' && RUN_AGAIN_STATES.has(version.state) && context.view.usgs === 'ok';
    return offered ? version.entityId : null;
}

/** An imported scene Find may run again: free, and its version (if one is open) waits for approval or failed. */
function sceneRerunnable(context: ImageryContext, scene: SceneItemPort): boolean {
    const open = openVersionOf(context, scene);
    const settled = open === undefined || RUN_AGAIN_STATES.has(open.state);
    return scene.status === 'imported' && scene.free && settled && context.view.usgs === 'ok';
}

/** The click: the new version's page opens; a refusal is shown beside the button (`importRefusal`). */
async function runAgain(context: ImageryContext, entityId: string): Promise<void> {
    const versionId = (await context.intents?.importScene(entityId, true)) ?? null;
    if (versionId !== null) {
        context.go(['version', versionId]);
    }
}

function refusal(context: ImageryContext, entityId: string): TemplateResult {
    const refused = context.view.importRefusal;
    return withValue(
        refused?.id === entityId ? refused.notice : null,
        (notice) =>
            html`<p class="alert" role="alert" data-state="run-again-refused">
                <hcm-icon name="error"></hcm-icon><span>${noticeOf(context.locale, notice)}</span>
            </p>`,
    );
}

type RunAgainLabel = 'adminContent.imagery.runAgain' | 'adminContent.imagery.importedRunAgain';

function button(context: ImageryContext, entityId: string, label: RunAgainLabel, named = ''): TemplateResult {
    const busy = context.view.importing === entityId;
    return html`<hcm-button
        variant="tonal"
        icon="refresh"
        data-run-again
        ?disabled=${context.view.importing !== null || context.readOnly}
        @click=${() => void runAgain(context, entityId)}
        >${contentText(context.locale, busy ? 'adminContent.imagery.importing' : label)}${when(
            named !== '',
            () => html`<span class="visually-hidden"> ${named}</span>`,
        )}</hcm-button
    >`;
}

/** The version page's button with what it does, and its refusal; nothing when not offered. */
export function versionRunAgain(context: ImageryContext, version: VersionViewPort | null): TemplateResult {
    return withValue(
        version === null ? null : rerunScene(context, version),
        (entityId) =>
            html`<div class="run-again">
                <div class="actions">${button(context, entityId, 'adminContent.imagery.runAgain')}</div>
                <p class="note">${contentText(context.locale, 'adminContent.imagery.runAgainHint')}</p>
                ${refusal(context, entityId)}
            </div>`,
    );
}

/** Find's card of an imported scene: **Imported: run again** (`title` names the scene for a screen reader). */
export function cardRunAgain(context: ImageryContext, scene: SceneItemPort, title: string): TemplateResult {
    return when(
        sceneRerunnable(context, scene),
        () =>
            html`<div class="card-import">
                ${button(context, scene.id, 'adminContent.imagery.importedRunAgain', title)} ${refusal(context, scene.id)}
            </div>`,
    );
}

/** Find's tag of an imported scene: its unfinished version's state when one is open, else Imported. */
export function importedTag(context: ImageryContext, locale: UiLocale, scene: SceneItemPort): TemplateResult {
    const open = openVersionOf(context, scene);
    const text =
        open === undefined
            ? contentText(locale, 'adminContent.imagery.tag.imported')
            : contentText(locale, 'adminContent.imagery.tag.importedState', { state: versionStateText(locale, open.state) });
    return html`<span class="tag" data-imported=${open?.state ?? 'imported'}>${text}</span>`;
}
