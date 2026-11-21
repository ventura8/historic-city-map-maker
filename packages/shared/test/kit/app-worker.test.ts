/**
 * The installable app's service worker (`packages/shared/src/kit/app-worker.ts`), on a worker scope made of plain objects:
 * network first for the page and its shell, the last copy only without a network, never the data, the release's own
 * records, another folder or another origin, and nothing at all for the admin (`offline: false`).
 */
import { describe, expect, it } from 'vitest';

import {
    appWorkerLines,
    appWorkerSource,
    installAppWorker,
    type AppWorkerScope,
    type CacheLike,
    type FetchEventLike,
    type WaitEvent,
} from '../../src/kit/app-worker.js';

const SCOPE = 'https://demo-hcm.web.app/';

interface FakeResponse {
    readonly ok: boolean;
    readonly type: string;
    readonly body: string;
    clone(): FakeResponse;
}

function response(body: string, ok = true, type = 'basic'): FakeResponse {
    const made: FakeResponse = { ok, type, body, clone: () => made };
    return made;
}

/** A worker scope whose network answers `network` (a thrown error: offline), with its caches and listeners. */
function world(network: (url: string) => FakeResponse) {
    const stores = new Map<string, Map<string, FakeResponse>>();
    const listeners = new Map<string, (event: never) => void>();
    const log: string[] = [];
    const keyOf = (request: Request | string): string => (typeof request === 'string' ? request : request.url);
    const open = (name: string): Promise<CacheLike> => {
        const store = stores.get(name) ?? new Map<string, FakeResponse>();
        stores.set(name, store);
        return Promise.resolve({
            match: (request) => Promise.resolve(store.get(keyOf(request)) as Response | undefined),
            put: (request, value) => {
                store.set(keyOf(request), value as unknown as FakeResponse);
                return Promise.resolve();
            },
        });
    };
    const scope: AppWorkerScope = {
        registration: { scope: SCOPE },
        caches: {
            open,
            keys: () => Promise.resolve([...stores.keys()]),
            delete: (name) => Promise.resolve(stores.delete(name)),
        },
        clients: {
            claim: () => {
                log.push('claim');
                return Promise.resolve();
            },
        },
        fetch: (request) => {
            log.push(`fetch ${request.url}`);
            try {
                return Promise.resolve(network(request.url) as unknown as Response);
            } catch (error: unknown) {
                return Promise.reject(error instanceof Error ? error : new Error(String(error)));
            }
        },
        skipWaiting: () => {
            log.push('skipWaiting');
            return Promise.resolve();
        },
        addEventListener: (type: string, listener: (event: never) => void) => {
            listeners.set(type, listener);
        },
    };
    return { scope, stores, listeners, log };
}

type World = ReturnType<typeof world>;

/** Fires `fetch` for `url`; resolves with the worker's answer, or null when it let the browser answer. */
async function request(w: World, url: string, init: { mode?: string; method?: string } = {}): Promise<FakeResponse | null> {
    const answers: Promise<Response>[] = [];
    const event: FetchEventLike = {
        request: { url, mode: init.mode ?? 'no-cors', method: init.method ?? 'GET' } as Request,
        respondWith: (value) => {
            answers.push(value);
        },
        waitUntil: () => undefined,
    };
    w.listeners.get('fetch')?.(event as never);
    const [answer] = answers;
    return answer === undefined ? null : ((await answer) as unknown as FakeResponse);
}

async function fire(w: World, type: 'install' | 'activate'): Promise<void> {
    const work: Promise<unknown>[] = [];
    const event: WaitEvent = { waitUntil: (promise) => work.push(promise) };
    w.listeners.get(type)?.(event as never);
    await Promise.all(work);
}

describe('installAppWorker', () => {
    it('happyPath_thePageAndItsShellComeFromTheNetworkAndACopyIsKept', async () => {
        const w = world((url) => response(`fresh ${url}`));
        installAppWorker(w.scope, { release: 'r2', offline: true });

        await expect(request(w, SCOPE, { mode: 'navigate' })).resolves.toMatchObject({ body: `fresh ${SCOPE}` });
        await expect(request(w, `${SCOPE}engine/engine.mjs`)).resolves.toMatchObject({ body: `fresh ${SCOPE}engine/engine.mjs` });
        await expect(request(w, `${SCOPE}engine/fonts/roboto.woff2`)).resolves.not.toBeNull();
        expect([...(w.stores.get('hcm-app-/-r2')?.keys() ?? [])]).toEqual([
            SCOPE,
            `${SCOPE}engine/engine.mjs`,
            `${SCOPE}engine/fonts/roboto.woff2`,
        ]);
    });

    it('happyPath_withNoNetworkTheLastCopySeenIsServed', async () => {
        let online = true;
        const w = world((url) => {
            if (!online) {
                throw new TypeError('Failed to fetch');
            }
            return response(`fresh ${url}`);
        });
        installAppWorker(w.scope, { release: 'r2', offline: true });
        await request(w, `${SCOPE}index.html`, { mode: 'navigate' });
        await request(w, `${SCOPE}config.js`);
        online = false;

        await expect(request(w, `${SCOPE}?year=1950`, { mode: 'navigate' })).resolves.toMatchObject({ body: `fresh ${SCOPE}index.html` });
        await expect(request(w, `${SCOPE}config.js`)).resolves.toMatchObject({ body: `fresh ${SCOPE}config.js` });
    });

    it('badPath_withNoNetworkAndNoCopyTheBrowsersErrorIsServed', async () => {
        const w = world(() => {
            throw new TypeError('Failed to fetch');
        });
        installAppWorker(w.scope, { release: 'r2', offline: true });

        await expect(request(w, `${SCOPE}site.css`)).resolves.toMatchObject({ type: 'error' });
    });

    it('badPath_aFailedOrForeignAnswerIsServedButNeverKept', async () => {
        const w = world((url) => (url.endsWith('.css') ? response('missing', false) : response('opaque', true, 'opaque')));
        installAppWorker(w.scope, { release: 'r2', offline: true });

        await expect(request(w, `${SCOPE}site.css`)).resolves.toMatchObject({ body: 'missing' });
        await expect(request(w, `${SCOPE}tab-icon.js`)).resolves.toMatchObject({ body: 'opaque' });
        expect(w.stores.get('hcm-app-/-r2')?.size ?? 0).toBe(0);
    });

    it.each([
        ['the published data', `${SCOPE}data/manifest.json`],
        ["the admin's release record", `${SCOPE}admin/runtime.json`],
        ["the site's release record", `${SCOPE}release.json`],
        ["the admin's entry", `${SCOPE}admin.mjs`],
        ['the app manifest', `${SCOPE}app.webmanifest`],
        ['a photo', `${SCOPE}data/media/p1/w640.webp`],
        ['another city page', `${SCOPE}bacau/config.js`],
        ["the admin's scripts", `${SCOPE}admin/assets/chunk.js`],
        ['Mapbox', 'https://api.mapbox.com/styles/v1/x/y'],
        ['the public bucket', 'https://storage.googleapis.com/demo-hcm-public/cities/bucharest/manifest.json'],
    ])('badPath_%s_isNeverAnsweredByTheWorker', async (_name, url) => {
        const w = world(() => response('fresh'));
        installAppWorker(w.scope, { release: 'r2', offline: true });

        await expect(request(w, url)).resolves.toBeNull();
        expect(w.log).toEqual([]);
    });

    it.each([
        ['another folder', `${SCOPE}admin/`, 'navigate', 'GET'],
        ['a post', `${SCOPE}config.js`, 'cors', 'POST'],
    ])('badPath_%s_isLeftToTheBrowser', async (_name, url, mode, method) => {
        const w = world(() => response('fresh'));
        installAppWorker(w.scope, { release: 'r2', offline: true });

        await expect(request(w, url, { mode, method })).resolves.toBeNull();
    });

    it('happyPath_aNewReleaseTakesOverAtOnceAndDropsTheOlderCopies', async () => {
        const w = world(() => response('fresh'));
        w.stores.set('hcm-app-/-r1', new Map());
        w.stores.set('hcm-app-/bacau/-r1', new Map());
        installAppWorker(w.scope, { release: 'r2', offline: true });

        await fire(w, 'install');
        await fire(w, 'activate');

        expect(w.log).toEqual(['skipWaiting', 'claim']);
        expect([...w.stores.keys()]).toEqual(['hcm-app-/bacau/-r1']);
    });

    it('happyPath_theAdminsWorkerKeepsAndAnswersNothing', async () => {
        const w = world(() => response('fresh'));
        installAppWorker(w.scope, { release: 'r2', offline: false });

        await expect(request(w, SCOPE, { mode: 'navigate' })).resolves.toBeNull();
        expect(w.listeners.has('fetch')).toBe(false);
        expect(w.listeners.has('activate')).toBe(true);
    });
});

describe('appWorkerSource', () => {
    it('happyPath_theFileCallsTheWorkerOnItsOwnScope', () => {
        const source = appWorkerSource({ release: 'abc', offline: true });

        expect(source.startsWith("'use strict';\n// Historic City Map Maker")).toBe(true);
        expect(source).toContain(')(self, {"release":"abc","offline":true});');
        expect(appWorkerLines({ release: 'abc', offline: false })).toContain('"offline":false');
    });
});
