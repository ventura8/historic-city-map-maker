/**
 * The order card's chunk (`packages/ui/src/admin/imagery/orders/lazy-card.ts`, DECISIONS-for-review.md §56b): fetched
 * once, on the first scene that needs a card, never for a scene USGS offers; Loading until it is in, then the card once
 * the page renders again; a failed fetch says so with Try again, which fetches again. The page itself
 * (`<hcm-imagery-page>`) is the fixtures' and `orders.test.ts`'s.
 */
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryContext } from '../../../src/admin/imagery/context.js';
import type { SceneItemPort } from '../../../src/admin/imagery/imagery-port.js';
import { chunkLoader, lazyOrderCard, type ChunkLoader, type OrderCardChunk } from '../../../src/admin/imagery/orders/lazy-card.js';
import { orderCard } from '../../../src/admin/imagery/orders/order-card.js';
import { cleanup, deep, deepAll, defineAll } from '../shell/fake-app.js';
import { imageryState, scene } from './fixtures.js';

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

/** A chunk whose fetches the test settles one by one. */
function scriptedChunk(): { readonly chunk: ChunkLoader<OrderCardChunk>; readonly fetches: Deferred<OrderCardChunk>[] } {
    const fetches: Deferred<OrderCardChunk>[] = [];
    const chunk = chunkLoader(() => {
        const next = deferred<OrderCardChunk>();
        fetches.push(next);
        return next.promise;
    });
    return { chunk, fetches };
}

const PAID: SceneItemPort = scene({ id: 'DS1105-1071DF076', displayId: 'DS1105-1071DF076', free: false });

function contextOf(refresh: () => void): ImageryContext {
    return {
        locale: 'en',
        view: imageryState(),
        intents: null,
        href: (params) => ['#/imagery', ...params].join('/'),
        go: () => undefined,
        readOnly: false,
        ask: () => undefined,
        refresh,
        focusDetail: () => undefined,
        showMap: () => undefined,
    };
}

/**
 * The card's place as the page renders it: rendered once now and again on every `refresh` (the page's `requestUpdate`),
 * counting the refreshes.
 */
function place(item: SceneItemPort, chunk: ChunkLoader<OrderCardChunk>): { readonly root: HTMLElement; readonly refreshes: () => number } {
    const root = document.createElement('div');
    document.body.append(root);
    let refreshes = 0;
    const holder: { context: ImageryContext | null } = { context: null };
    const draw = (): void => {
        if (holder.context !== null) {
            render(lazyOrderCard(holder.context, item, chunk), root);
        }
    };
    holder.context = contextOf(() => {
        refreshes += 1;
        draw();
    });
    draw();
    return { root, refreshes: () => refreshes };
}

/** Lets a settled fetch's handlers run. */
async function settle(): Promise<void> {
    await new Promise((done) => setTimeout(done, 0));
}

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

describe('chunkLoader', () => {
    it('happyPath_fetchesOnceAndKeepsTheModule', async () => {
        let fetched = 0;
        const loader = chunkLoader(() => {
            fetched += 1;
            return Promise.resolve('module');
        });

        expect(loader.loaded()).toBeUndefined();
        const [first, second] = await Promise.all([loader.load(), loader.load()]);

        expect([first, second, loader.loaded(), loader.failed(), fetched]).toEqual(['module', 'module', 'module', false, 1]);
    });

    it('badPath_aFailedFetchIsForgottenAndTheNextLoadFetchesAgain', async () => {
        let fetched = 0;
        const loader = chunkLoader(() => {
            fetched += 1;
            return fetched === 1 ? Promise.reject(new Error('offline')) : Promise.resolve('module');
        });

        await expect(loader.load()).rejects.toThrow('offline');
        expect([loader.loaded(), loader.failed()]).toEqual([undefined, true]);
        const again = loader.load();
        expect(loader.failed()).toBe(false);
        await expect(again).resolves.toBe('module');
        expect(fetched).toBe(2);
    });
});

describe('lazyOrderCard', () => {
    beforeAll(defineAll);

    it('happyPath_loadingUntilTheChunkIsInThenTheCardOnceThePageRendersAgain', async () => {
        const { chunk, fetches } = scriptedChunk();
        const { root, refreshes } = place(PAID, chunk);

        expect(deep(root, '[role="status"]').textContent).toContain('Loading');
        fetches[0]?.resolve({ orderCard });
        await settle();

        expect(deep(root, '.order-card[data-state="needs-order"] h3').textContent).toBe('Buy this scan');
        expect([fetches.length, refreshes()]).toEqual([1, 1]);
    });

    it('happyPath_aCardOfALoadedChunkRendersAtOnceWithoutAFetch', async () => {
        const { chunk, fetches } = scriptedChunk();
        place(PAID, chunk);
        fetches[0]?.resolve({ orderCard });
        await settle();

        const second = place(PAID, chunk);

        expect(deepAll(second.root, '.order-card')).toHaveLength(1);
        expect([fetches.length, second.refreshes()]).toEqual([1, 0]);
    });

    it('badPath_aSceneUsgsOffersOrAnImportedOrderHasNoCardAndFetchesNothing', () => {
        const { chunk, fetches } = scriptedChunk();
        const offered = place(scene(), chunk);
        const imported = place({ ...PAID, acquisition: 'imported' }, chunk);

        expect([offered.root.textContent.trim(), imported.root.textContent.trim(), fetches.length]).toEqual(['', '', 0]);
    });

    it('badPath_theCardItselfHasNothingForASceneUsgsOffers', () => {
        const root = document.createElement('div');
        render(
            orderCard(
                contextOf(() => undefined),
                scene(),
            ),
            root,
        );

        expect(root.textContent.trim()).toBe('');
    });

    it('badPath_aFailedFetchSaysSoAndTryAgainFetchesAgain', async () => {
        const { chunk, fetches } = scriptedChunk();
        const { root } = place(PAID, chunk);
        fetches[0]?.reject(new Error('offline'));
        await settle();

        expect(deep(root, '[role="alert"]').textContent).toContain('This could not be read. Try again.');
        deep(root, 'hcm-button').click();
        expect(deep(root, '[role="status"]').textContent).toContain('Loading');
        fetches[1]?.resolve({ orderCard });
        await settle();

        expect(deepAll(root, '.order-card')).toHaveLength(1);
        expect(fetches).toHaveLength(2);
    });
});
