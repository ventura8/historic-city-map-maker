/**
 * Every article of the last Wikipedia fetch, the hidden ones too (`docs/research/M31-wikipedia.md` §2): a gzip JSON file in
 * the private bucket (`STORAGE_PATHS.wikipediaArticles`), since a large city's thousands of articles outgrow the state
 * document's 1 MiB. A city fetched before the move keeps its legacy list on the state until the next fetch.
 */
import { gunzipSync, gzipSync } from 'node:zlib';

import {
    STORAGE_PATHS,
    wikipediaArticlesFileSchema,
    type WikipediaArticle,
    type WikipediaArticlesFile,
    type WikipediaStateDoc,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';

export type StoreDeps = Pick<Ports, 'blobs'>;

/** The last fetch's articles: the stored file, else the state's legacy list, else none. */
export async function storedArticles(
    deps: StoreDeps,
    cityId: string,
    state: WikipediaStateDoc | undefined,
): Promise<readonly WikipediaArticle[]> {
    const path = STORAGE_PATHS.wikipediaArticles(cityId);
    if ((await deps.blobs.stat('private', path)) === undefined) {
        return state?.articles ?? [];
    }
    const text = gunzipSync(await deps.blobs.read('private', path)).toString('utf8');
    return wikipediaArticlesFileSchema.parse(JSON.parse(text)).articles;
}

/** Writes the articles of a fetch. */
export async function storeArticles(deps: StoreDeps, cityId: string, articles: readonly WikipediaArticle[]): Promise<void> {
    const file: WikipediaArticlesFile = { version: 1, articles: [...articles] };
    await deps.blobs.write('private', STORAGE_PATHS.wikipediaArticles(cityId), gzipSync(JSON.stringify(file), { level: 9 }), {
        contentType: 'application/gzip',
    });
}
