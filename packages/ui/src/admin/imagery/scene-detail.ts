/**
 * A scene's page (`#/imagery/scene/<entityId>`, `docs/research/M3-interfaces.md` §3.2–§3.4, §10.2; behaviours A11,
 * A12): its browse image (copied into our bucket first; unavailable says so with Try again), what USGS says of it, every
 * reason of its rank in plain words, and **Import** in one click for a free scene. A scene imported already, and a city
 * whose USGS downloads are not approved yet each say why Import is not offered. M4 (A13): a scene that must be bought has
 * the order card instead (`orders/order-card.ts`, a chunk fetched on first need: `orders/lazy-card.ts`), and so has one
 * USGS just delivered (the server imports it). M8: a frame that leaves part of the city out is offered its date's others.
 * The owner's report of 2026-11-13: a frame probably cloudy over the city says so before Import or Buy, and Not useful sets a
 * scene aside (`scene-unusable.ts`).
 */
import { html, type TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate } from '../editing/states.js';
import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { SceneItemPort } from './imagery-port.js';
import { dayText, reasonText } from './imagery-text.js';
import { lazyJoin } from './join/lazy-card.js';
import { chunkLoader, chunkTemplate, lazyOrderCard, type ChunkLoader } from './orders/lazy-card.js';
import { notFoundPane } from './not-found.js';
import { sceneRefusal } from './scene-refusal.js';
import type { SceneUseChunk } from './scene-unusable.js';
import { when } from './when.js';

/** M4: an order USGS delivered is imported by the server, and its card says so and links to the import. */
const ORDER_IMPORTS: readonly SceneItemPort['acquisition'][] = ['delivered', 'importing'];

/** M4: a free scene, or an imported one, whose order (if any) is not the server's to import; one to buy has its card. */
function importShown(scene: SceneItemPort): boolean {
    return (scene.free || scene.status === 'imported') && !ORDER_IMPORTS.includes(scene.acquisition);
}

/** Import offered: a free scene not imported yet, once USGS lets the city download (the list's cards and the scene). */
export function importable(context: ImageryContext, scene: SceneItemPort): boolean {
    return importShown(scene) && scene.status !== 'imported' && context.view.usgs === 'ok';
}

async function importScene(context: ImageryContext, id: string, again = false): Promise<void> {
    const intents = context.intents;
    if (intents === null) {
        return;
    }
    const versionId = again ? await intents.importScene(id, true) : await intents.importScene(id);
    if (versionId !== null) {
        context.go(['version', versionId]);
    }
}

/** **Import** (one click, `importScene`); `named` adds the scene's name for the list, where every card has one. */
export function importButton(context: ImageryContext, scene: SceneItemPort, named = ''): TemplateResult {
    const importing = context.view.importing === scene.id;
    const key = importing ? 'adminContent.imagery.importing' : 'adminContent.imagery.import';
    return html`<div class="actions">
        <hcm-button
            variant=${named === '' ? 'filled' : 'tonal'}
            icon="download"
            ?disabled=${context.view.importing !== null || context.readOnly}
            @click=${() => void importScene(context, scene.id)}
            >${contentText(context.locale, key)}${when(named !== '', () => html`<span class="visually-hidden"> ${named}</span>`)}</hcm-button
        >
    </div>`;
}

export function importRefusal(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    return sceneRefusal(context, context.view.importRefusal, scene);
}

/**
 * The scene page's own parts, a chunk fetched when a scene's page opens (`scene-unusable.ts`): what USGS says of it, why Import is
 * not offered, Not useful and the cloudy warning.
 */
export const SCENE_USE_CHUNK: ChunkLoader<SceneUseChunk> = chunkLoader(async () => import('./scene-unusable.js'));

/** What the scene page's chunk renders, once it is in (Loading until then). */
function sceneUse(context: ImageryContext, render: (chunk: SceneUseChunk) => TemplateResult): TemplateResult {
    return chunkTemplate(context, SCENE_USE_CHUNK, render);
}

function notFound(context: ImageryContext): TemplateResult {
    return notFoundPane(context, 'adminContent.imagery.sceneNotFound');
}

function sceneBody(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    return html`<div class="pane" data-scene=${scene.id}>
        <h2 tabindex="-1" data-detail-heading>${scene.sensorName} · ${dayText(locale, scene.date)}</h2>
        <p>${contentText(locale, 'adminContent.imagery.score', { score: String(scene.score) })}</p>
        ${sceneUse(context, (chunk) => chunk.browseImage(context, scene))} ${lazyOrderCard(context, scene)}
        ${when(importShown(scene), () => sceneUse(context, (chunk) => chunk.noImport(context, scene) ?? importButton(context, scene)))}
        ${importRefusal(context, scene)} ${lazyJoin(context, null, (chunk) => chunk.sceneOffer(context, scene))}
        ${sceneUse(context, (chunk) => html`${chunk.cloudyWarning(locale, scene)} ${chunk.unusableSection(context, scene)}`)}
        <h3>${contentText(locale, 'adminContent.imagery.why')}</h3>
        <ul class="reasons">
            ${scene.reasons.map((reason) => html`<li>${reasonText(locale, reason)}</li>`)}
        </ul>
        ${sceneUse(context, (chunk) => chunk.facts(locale, scene))}
    </div>`;
}

export function sceneDetail(context: ImageryContext, scene: SceneItemPort | null): TemplateResult {
    if (scene !== null) {
        return sceneBody(context, scene);
    }
    const { locale, view, intents } = context;
    if (view.scenes.status === 'loading' || view.named.loading) {
        return loadingTemplate(locale);
    }
    return view.named.failure === null ? notFound(context) : errorTemplate(locale, view.named.failure, () => intents?.retry());
}
