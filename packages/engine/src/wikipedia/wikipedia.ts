/**
 * The Wikipedia overlay's lazy chunk (`docs/research/M31-wikipedia.md` §4): `import('./wikipedia/wikipedia.js')` from the entry
 * (`mount.ts`), an extra of its own (`extra-wikipedia-<hash>.js` beside the IIFE, `wikipedia-<hash>.js` beside `engine.mjs`),
 * fetched the first time the overlay shows. It reads the city's `wikipedia.json` from the public bucket (no cookie, no other
 * address) and checks it against `wikipediaFileSchema`; the articles it answers are text only, drawn by the places' own code.
 */
import { validate, wikipediaFileSchema, type WikipediaArticle } from '@hcm/shared';

/** The page's `fetch`, as the chunk uses it. */
export type WikipediaFetch = (url: string, init: { readonly credentials: 'omit' }) => Promise<Response>;

export class WikipediaFileError extends Error {
    override readonly name = 'WikipediaFileError';
}

export interface WikipediaModule {
    load(url: string, fetch: WikipediaFetch): Promise<readonly WikipediaArticle[]>;
}

async function load(url: string, fetch: WikipediaFetch): Promise<readonly WikipediaArticle[]> {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) {
        throw new WikipediaFileError(`the Wikipedia file answered HTTP ${String(response.status)}`);
    }
    const checked = validate(wikipediaFileSchema, await response.json());
    if (!checked.ok) {
        throw new WikipediaFileError(`the Wikipedia file is not valid (${String(checked.issues.length)} issues)`);
    }
    return checked.value.articles;
}

export const wikipediaModule: WikipediaModule = { load };
