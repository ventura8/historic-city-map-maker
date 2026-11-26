import { createLogger } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { BUNDLE_READ, bundleJson } from '../../src/import/bundle.js';
import { withLegacyFixes } from '../../src/import/legacy-fixes.js';
import { createLegacyImport, type LegacyImport, type LegacyImportProgress } from '../../src/import/legacy-import.js';
import { createMemoryStore } from './store.js';

/**
 * The bundle a new release ships is always the one read (the live finding of 2026-11-08: Hosting served
 * `legacy/<city>/photos.json` for a day, so the owner's browser kept the 45 records of the release before the 57 and
 * Setup's step h said every photo was on the map). A browser's HTTP cache is modelled: it answers the copy it holds of a
 * file unless the request asks the server again (`cache` `no-cache`, `no-store` or `reload`).
 */

const BASE = 'https://demo-hcm.web.app/admin/';
const PREFIX = `${BASE}legacy/bucharest/`;
const REVALIDATING: ReadonlySet<RequestCache | undefined> = new Set<RequestCache | undefined>(['no-cache', 'no-store', 'reload']);

function photo(id: string): Readonly<Record<string, unknown>> {
    return { id, title: { ro: id }, license: 'permission-legacy', location: { lat: 44.43, lng: 26.1 }, year: 1936 };
}

const OLD = [{ sourceFile: 'a.jpg', photo: { ...photo('a'), author: 'Dan Perry' } }];
const NEW = [...OLD, { sourceFile: 'b.jpg', photo: { ...photo('b'), author: 'Studiourile Buftea' } }];

/** A browser whose cache holds the earlier release's files; the server has the new release's. */
function browser(cached: Readonly<Record<string, unknown>>, served: Readonly<Record<string, unknown>>) {
    const reads: (RequestCache | undefined)[] = [];
    const fetcher: typeof fetch = (input, init) => {
        reads.push(init?.cache);
        const name = (input instanceof Request ? input.url : String(input)).slice(PREFIX.length);
        const body = REVALIDATING.has(init?.cache) ? served[name] : (cached[name] ?? served[name]);
        return Promise.resolve(body === undefined ? new Response('', { status: 404 }) : Response.json(body));
    };
    return { fetcher, reads };
}

describe('bundleJson', () => {
    it('happyPath_aNewReleasesFileIsReadPastTheCopyTheBrowserHolds', async () => {
        const { fetcher, reads } = browser({ 'photos.json': OLD }, { 'photos.json': NEW });

        await expect(bundleJson(fetcher, BASE, 'bucharest', 'photos.json')).resolves.toEqual(NEW);
        expect(reads).toEqual([BUNDLE_READ.cache]);
        expect(BUNDLE_READ.cache).toBe('no-cache');
    });

    it('badPath_aFileTheServerCannotServeIsUndefined', async () => {
        const { fetcher } = browser({ 'photos.json': OLD }, {});

        await expect(bundleJson(fetcher, BASE, 'bucharest', 'photos.json')).resolves.toBeUndefined();
    });
});

describe('the import over a browser holding the earlier bundle', () => {
    it('happyPath_stepHCountsTheNewBundleNotTheCachedOne', async () => {
        const { fetcher } = browser({ 'photos.json': OLD }, { 'photos.json': NEW });
        const importer = createLegacyImport({
            fetch: fetcher,
            store: createMemoryStore(),
            cityId: 'bucharest',
            baseUrl: BASE,
            uid: () => 'e2eOwnerUid0001',
            nonce: () => 'nonce-0001',
            sleep: () => new Promise(() => undefined),
            log: createLogger('test'),
            reprocess: () => Promise.resolve(),
        });

        await expect(importer.detect()).resolves.toMatchObject({ done: 0, total: 2 });
    });

    it('badPath_theAdditionsAuthorIsNeverMissedForTheCachedRecords', async () => {
        const { fetcher, reads } = browser({ 'photos.json': OLD, 'corrections.json': {} }, { 'photos.json': NEW, 'corrections.json': {} });
        const done: LegacyImportProgress = { done: 2, total: 2, failed: [] };
        const inner: LegacyImport = { detect: () => Promise.resolve(done), run: () => Promise.resolve(done) };
        const store = {
            place: () => Promise.resolve(null),
            history: () => Promise.resolve({ placed: false, aimed: false }),
            aim: () => Promise.resolve(),
            credits: () => Promise.resolve([{ label: { ro: 'Fotografii: Dan Perry', en: 'Photos: Dan Perry' } }]),
            saveCredits: () => Promise.resolve(),
        };
        const fixes = withLegacyFixes(inner, { fetch: fetcher, store, cityId: 'bucharest', baseUrl: BASE, log: createLogger('test') });

        await expect(fixes.detect()).resolves.toMatchObject({ credits: true });
        expect(new Set(reads)).toEqual(new Set(['no-cache']));
    });
});
