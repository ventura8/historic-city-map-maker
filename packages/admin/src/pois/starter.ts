/**
 * The starter categories the place editor offers a city that has none (the live manual test of 2026-11-01, finding 35:
 * the migrated Bucharest had no category, so Add place showed an empty Category select and Save refused): one click
 * writes the five of `STARTER_POI_CATEGORIES` in one batch, each id the slug of its Romanian label kept clear of the
 * city's layers and categories (one overlay namespace), after the city's own categories in order. The layers' ids are
 * read once, at the click; a read that fails writes nothing. Settings, Place categories offers the same action to a city
 * that already has categories (finding 41): only the starters no category names yet, as many as `MAX_POI_CATEGORIES`
 * leaves room for.
 */
import {
    FIRESTORE_PATHS,
    MAX_LAYERS,
    MAX_POI_CATEGORIES,
    missingStarterCategories,
    starterCategoryDocs,
    type StarterCategory,
} from '@hcm/shared';
import { z } from 'zod';

import type { BatchWrite, ContentStore, WriteOutcome } from '../content/services.js';

/** Any document: only the ids are read. */
const ANY_DOCUMENT = z.record(z.string(), z.unknown());

/** The ids of a collection's documents, read once (the listener stops at its first answer); null when the read failed. */
export function readIds(store: Pick<ContentStore, 'watchQuery'>, collection: string): Promise<readonly string[] | null> {
    return new Promise((resolve) => {
        const read: { answered: boolean; stop: (() => void) | null } = { answered: false, stop: null };
        const answer = (ids: readonly string[] | null): void => {
            if (!read.answered) {
                read.answered = true;
                resolve(ids);
                read.stop?.();
            }
        };
        const listened = (page: { readonly docs: readonly { readonly id: string }[] }): void => {
            answer(page.docs.map((doc) => doc.id));
        };
        read.stop = store.watchQuery(collection, ANY_DOCUMENT, { limit: MAX_LAYERS }, listened, () => {
            answer(null);
        });
        // An answer given while the listener was being attached could not stop it yet.
        if (read.answered) {
            read.stop();
        }
    });
}

/** What the starters read of a listed category (of the places or of the settings). */
interface ListedCategory {
    readonly id: string;
    readonly label: { readonly ro: string; readonly en?: string | undefined };
    readonly order: number;
}

/** The starters a city with `categories` gets: the ones no category names yet, in starter order, as many as fit. */
export function startersFor(categories: readonly Pick<ListedCategory, 'label'>[]): StarterCategory[] {
    return missingStarterCategories(categories).slice(0, Math.max(0, MAX_POI_CATEGORIES - categories.length));
}

/** The batch that adds the starter categories `categories` lacks after them, clear of `taken` (the layers' ids). */
export function starterWrites(cityId: string, categories: readonly ListedCategory[], taken: readonly string[]): BatchWrite[] {
    const first = categories.reduce((last, category) => Math.max(last, category.order + 1), 0);
    const ids = [...taken, ...categories.map((category) => category.id)];
    return starterCategoryDocs(ids, first, startersFor(categories)).map(({ id, ...data }) => ({
        kind: 'create',
        path: FIRESTORE_PATHS.poiCategory(cityId, id),
        data: { ...data },
    }));
}

/** Writes the starter categories `cityId` lacks in one batch; nothing when the layers could not be read. */
export async function addStarterCategories(
    store: Pick<ContentStore, 'watchQuery' | 'batch'>,
    cityId: string,
    categories: readonly ListedCategory[],
): Promise<WriteOutcome> {
    const layers = await readIds(store, FIRESTORE_PATHS.layers(cityId));
    if (layers === null) {
        return { ok: false, reason: 'offline' };
    }
    return store.batch(starterWrites(cityId, categories, layers));
}
