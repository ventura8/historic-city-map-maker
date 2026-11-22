import { manageWikipediaFunction, type ManageDeps } from './manage.js';

/**
 * The `wikipedia.*` functions under their registry names (`docs/research/M31-wikipedia.md` §3): the admin's `manage`. The
 * fetch itself runs inside the manifest build (`refresh.ts`), asked for by the imagery tick (`tick.ts`).
 */
export function wikipediaFunctions(getDeps: () => ManageDeps) {
    return { manage: manageWikipediaFunction(getDeps) };
}
