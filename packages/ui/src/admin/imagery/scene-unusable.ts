/**
 * A scene's usefulness (the owner's report of 2026-11-13: "This scan is useless, too many clouds", a 1964 frame the whole-city plan
 * kept offering to buy): the warning of a frame its browse image shows probably cloudy over the city, on its card and its page, and
 * on its page **Not useful** with why (clouds, haze or blur, wrong area, other), or, once marked, what that did and Undo. With
 * them the page's other parts no list needs: what USGS says of the scene, and why Import is not offered (imported, or downloads
 * not approved). A chunk of its own (`scene-unusable-<hash>.js`, fetched when a scene's page opens), so the Imagery area keeps
 * its budget; the card's chips are `scene-tags.ts`'s.
 */

import { CLOUDY_CITY_PERCENT, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { AdminNoticeInputPort } from '../notice-port.js';
import type { ImageryContext } from './context.js';
import type { SceneItemPort, UnusableReasonPort } from './imagery-port.js';
import { datasetText, dayText, numberText } from './imagery-text.js';
import { sceneRefusal, usgsSetupLink } from './scene-refusal.js';
import { when } from './when.js';

/** What the chunk gives the scene's page. */
export interface SceneUseChunk {
    readonly cloudyWarning: typeof cloudyWarning;
    readonly unusableSection: typeof unusableSection;
    readonly facts: typeof facts;
    readonly noImport: typeof noImport;
    readonly browseImage: typeof browseImage;
}

const REASONS: readonly UnusableReasonPort[] = ['clouds', 'haze', 'area', 'other'];

/** The page's warning of a frame probably cloudy over the city: what is wrong, why, what to do (before an import or a purchase). */
export function cloudyWarning(locale: UiLocale, scene: SceneItemPort): TemplateResult {
    const share = scene.cloudCity !== null && scene.cloudCity >= CLOUDY_CITY_PERCENT ? scene.cloudCity : null;
    return share === null || scene.unusable !== null
        ? EMPTY
        : html`<div class="alert" role="note" data-state="cloudy-warning">
              <hcm-icon name="cloud"></hcm-icon>
              <div class="alert-body">
                  <p>
                      <strong>${contentText(locale, 'adminContent.imagery.cloudy.tag', { percent: numberText(locale, share, 0) })}</strong>
                  </p>
                  <p>${contentText(locale, 'adminContent.imagery.cloudy.warning')}</p>
                  <p>${contentText(locale, 'adminContent.imagery.cloudy.todo')}</p>
              </div>
          </div>`;
}

async function mark(context: ImageryContext, scene: SceneItemPort, reason: UnusableReasonPort | null): Promise<void> {
    await context.intents?.markUnusable(scene.id, reason);
}

/** The four reasons, each one click (the snackbar's Undo takes it back). */
function reasonButtons(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    const off = context.view.ordering !== null || context.readOnly;
    return html`<p>${contentText(locale, 'adminContent.imagery.unusable.hint')}</p>
        <p>${contentText(locale, 'adminContent.imagery.unusable.hidden')}</p>
        <div class="actions" role="group" aria-labelledby="scene-unusable">
            ${REASONS.map(
                (reason) =>
                    html`<hcm-button
                        variant="outlined"
                        ?disabled=${off}
                        data-unusable=${reason}
                        @click=${() => void mark(context, scene, reason)}
                        ><span class="visually-hidden">${contentText(locale, 'adminContent.imagery.unusable.prefix')} </span>${contentText(
                            locale,
                            `adminContent.imagery.unusable.${reason}`,
                        )}</hcm-button
                    >`,
            )}
        </div>`;
}

/** What the mark did, and Undo. */
function marked(context: ImageryContext, scene: SceneItemPort, reason: UnusableReasonPort): TemplateResult {
    const { locale } = context;
    return html`<p data-state="unusable-marked">
            ${contentText(locale, 'adminContent.imagery.unusable.state', {
                reason: contentText(locale, `adminContent.imagery.unusable.${reason}`),
            })}
        </p>
        <div class="actions">
            <hcm-button
                variant="tonal"
                icon="undo"
                ?disabled=${context.view.ordering !== null || context.readOnly}
                @click=${() => void mark(context, scene, null)}
                >${contentText(locale, 'adminContent.imagery.unusable.undo')}</hcm-button
            >
        </div>`;
}

/**
 * The page's section: Not useful? with the four reasons, or the mark and Undo. An imported scene has none (its layer is what to
 * reject or delete). Its refusal shows here, never on the order card.
 */
export function unusableSection(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    return when(
        scene.status !== 'imported',
        () =>
            html`<section class="section" data-scene-unusable>
                <h3 id="scene-unusable">${contentText(locale, 'adminContent.imagery.unusable.title')}</h3>
                ${scene.unusable === null ? reasonButtons(context, scene) : marked(context, scene, scene.unusable)}
                ${sceneRefusal(context, context.view.orderRefusal?.action === 'unusable' ? context.view.orderRefusal : null, scene)}
            </section>`,
    );
}

function fact(locale: UiLocale, key: Parameters<typeof contentText>[1], value: string): TemplateResult {
    return html`<dt>${contentText(locale, key)}</dt>
        <dd>${value}</dd>`;
}

export function facts(locale: UiLocale, scene: SceneItemPort): TemplateResult {
    const cloud =
        scene.cloudCover === null
            ? contentText(locale, 'adminContent.imagery.cloudUnknown')
            : `${numberText(locale, scene.cloudCover, 0)} %`;
    return html`<dl class="facts">
        ${fact(locale, 'adminContent.imagery.fact.dataset', datasetText(locale, scene.dataset))}
        ${fact(locale, 'adminContent.imagery.fact.camera', scene.sensorName)}
        ${fact(locale, 'adminContent.imagery.fact.date', dayText(locale, scene.date))}
        ${fact(locale, 'adminContent.imagery.fact.cloud', cloud)}
        ${fact(locale, 'adminContent.imagery.fact.resolution', `${numberText(locale, scene.resolutionM)} m`)}
        ${fact(locale, 'adminContent.imagery.fact.coverage', `${numberText(locale, scene.coverage * 100, 0)} %`)}
        ${fact(locale, 'adminContent.imagery.fact.id', scene.displayId)}
    </dl>`;
}

/** An imported scene's link: its version while it is unfinished, else its layer; and, while it is free, Import again. */
function importedLink(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const version = context.view.versions.items.find((candidate) => candidate.layerId === scene.layerId);
    const href = version === undefined ? ['#/layers', scene.layerId ?? ''].join('/') : context.href(['version', version.id]);
    return html`<p><a href=${href}>${contentText(context.locale, 'adminContent.imagery.importedOpen')}</a></p>
        ${when(scene.free && scene.layerId !== null && context.view.usgs === 'ok', () => importAgainButton(context, scene))}`;
}

/** Import again's click: the new version's page opens (this chunk imports nothing of the Imagery chunk: `editor-shared` would take it). */
async function importAgain(context: ImageryContext, id: string): Promise<void> {
    const versionId = (await context.intents?.importScene(id, true)) ?? null;
    if (versionId !== null) {
        context.go(['version', versionId]);
    }
}

/** Import again (lesson 645): the scene downloaded and processed once more, a new version that replaces the old one once approved. */
function importAgainButton(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    return html`<div class="actions">
            <hcm-button
                variant="tonal"
                icon="refresh"
                ?disabled=${context.view.importing !== null || context.readOnly}
                @click=${() => void importAgain(context, scene.id)}
                >${contentText(locale, 'adminContent.imagery.importAgain')}</hcm-button
            >
        </div>
        <p>${contentText(locale, 'adminContent.imagery.importAgainHint')}</p>`;
}

/**
 * USGS has not approved the account's downloads yet: Import stays off, with why (`apiError.usgs.accessPending`) and the
 * way to Setup's USGS step (S-A11-BAD-DOWNLOAD-NOT-APPROVED).
 */
function downloadsPending(context: ImageryContext): TemplateResult {
    const { locale } = context;
    return html`<div class="actions">
            <hcm-button variant="filled" icon="download" disabled>${contentText(locale, 'adminContent.imagery.import')}</hcm-button>
        </div>
        <div class="alert" role="alert" data-state="downloads-pending">
            <hcm-icon name="schedule"></hcm-icon>
            <div class="alert-body">
                <p>${noticeOf(locale, { key: 'apiError.usgs.accessPending' })}</p>
                ${usgsSetupLink(locale)}
            </div>
        </div>`;
}

/** Why Import is not offered, or null when it is. */
export function noImport(context: ImageryContext, scene: SceneItemPort): TemplateResult | null {
    if (scene.status === 'imported') {
        return importedLink(context, scene);
    }
    return context.view.usgs === 'ok' ? null : downloadsPending(context);
}

/** Why there is no image, with Try again; a preview that could not be made too: the row's small crop is not the browse image. */
function browseFailure(context: ImageryContext, scene: SceneItemPort, error: AdminNoticeInputPort | undefined): TemplateResult {
    return html`<p class="alert" role="alert" data-state="browse-unavailable">
            <hcm-icon name="broken_image"></hcm-icon><span>${noticeOf(context.locale, error ?? null)}</span>
        </p>
        <div class="actions">
            <hcm-button
                variant="tonal"
                icon="refresh"
                @click=${() => {
                    context.intents?.retryBrowse(scene.id);
                }}
                >${contentText(context.locale, 'adminContent.common.retry')}</hcm-button
            >
        </div>`;
}

/** The page's picture, the row's until it is made. */
function largest(image: { readonly url: string; readonly preview?: string | null }): string {
    return image.preview ?? image.url;
}

export function browseImage(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const image = context.view.browse[scene.id] ?? { status: 'loading' };
    if (image.status === 'loading') {
        return html`<p class="note" role="status">${contentText(context.locale, 'adminContent.imagery.browseLoading')}</p>`;
    }
    return image.status === 'ready' && image.error === undefined
        ? html`<img
              class="browse"
              src=${largest(image)}
              alt=${contentText(context.locale, 'adminContent.imagery.browseAlt', { name: scene.displayId })}
          />`
        : browseFailure(context, scene, image.error);
}
