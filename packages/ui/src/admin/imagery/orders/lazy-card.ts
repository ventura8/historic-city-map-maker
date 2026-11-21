/**
 * The order card as a chunk of its own (M4, `docs/research/M4-interfaces.md` §1.7; DECISIONS-for-review.md §56b): a scene
 * USGS offers, the usual one, never needs it, so the Imagery area's chunk keeps M3's budget, and `order-card.ts` (the
 * admin's `order-card-<hash>.js`) is fetched the first time a scene that must be bought, or one with an order, opens.
 * Until the chunk is in, the card's place says Loading; a failed fetch says so with Try again; once it is in, every render
 * is synchronous. The page renders again when a fetch settles (`ImageryContext.refresh`).
 */
import type { SceneAcquisitionState } from '@hcm/shared';
import type { TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate } from '../../editing/states.js';
import { EMPTY } from '../../shell/empty.js';
import type { ImageryContext } from '../context.js';
import type { SceneItemPort } from '../imagery-port.js';
import type { orderCard } from './order-card.js';

/** What the chunk gives the scene's page: the card's template. */
export interface OrderCardChunk {
    readonly orderCard: typeof orderCard;
}

/**
 * A module fetched once: `loaded()` once it is in, `failed()` after a fetch failed (the next `load()` tries again);
 * `load()` while a fetch runs is that fetch.
 */
export interface ChunkLoader<T> {
    readonly loaded: () => T | undefined;
    readonly failed: () => boolean;
    readonly load: () => Promise<T>;
}

export function chunkLoader<T>(fetchChunk: () => Promise<T>): ChunkLoader<T> {
    let loaded: T | undefined;
    let failed = false;
    let pending: Promise<T> | undefined;
    const settle = (chunk: T): T => {
        loaded = chunk;
        return chunk;
    };
    const forget = (error: unknown): never => {
        pending = undefined;
        failed = true;
        throw error;
    };
    return {
        loaded: () => loaded,
        failed: () => failed,
        load: () => {
            failed = false;
            pending ??= fetchChunk().then(settle, forget);
            return pending;
        },
    };
}

/** The order card's chunk: one dynamic `import()`, so the bundler splits it. */
export const ORDER_CARD_CHUNK: ChunkLoader<OrderCardChunk> = chunkLoader(async () => import('./order-card.js'));

/** The states without a card, which never fetch it: a scene USGS offers (M3's free Import) and an order imported. */
const NO_CARD: ReadonlySet<SceneAcquisitionState> = new Set<SceneAcquisitionState>(['available', 'imported']);

/** Why the card is not there: its chunk could not be fetched (offline, or a deploy replaced it). */
const CHUNK_FAILURE = { kind: 'unavailable', code: 'network' } as const;

/** Fetches the chunk (or joins the running fetch); the page renders again when it settles, either way. */
function fetchChunk<T>(context: ImageryContext, chunk: ChunkLoader<T>): void {
    chunk.load().then(context.refresh, context.refresh);
}

/** `render` over a chunk once it is in; until then Loading (fetching it), or after a failed fetch why not, with Try again. */
export function chunkTemplate<T>(context: ImageryContext, chunk: ChunkLoader<T>, render: (loaded: T) => TemplateResult): TemplateResult {
    const loaded = chunk.loaded();
    if (loaded !== undefined) {
        return render(loaded);
    }
    if (chunk.failed()) {
        return errorTemplate(context.locale, CHUNK_FAILURE, () => {
            fetchChunk(context, chunk);
            context.refresh();
        });
    }
    fetchChunk(context, chunk);
    return loadingTemplate(context.locale);
}

/**
 * The scene's order card, fetched on first need (none for a scene USGS offers or an order imported: a frame that turned
 * free while being marked says why in the snackbar, `OrderActions.markOrdered`).
 */
export function lazyOrderCard(
    context: ImageryContext,
    scene: SceneItemPort,
    chunk: ChunkLoader<OrderCardChunk> = ORDER_CARD_CHUNK,
): TemplateResult {
    return NO_CARD.has(scene.acquisition) ? EMPTY : chunkTemplate(context, chunk, (loaded) => loaded.orderCard(context, scene));
}
