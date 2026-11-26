import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { START_RELEASE_FORMAT, type StartRelease } from '@hcm/shared';
import { createUpstreamFakes, GOOGLE_TOKENS, type UpstreamFakes } from '@hcm/test-support/fakes';

import type { StartDeps } from '../../src/start/controller.js';
import { START_SCOPES } from '../../src/start/consent.js';
import { testLog } from '../app/fakes.js';

/** The start site and Google in one fetch: the fake upstreams answer Google's, this answers the site's own files. */
export const BASE = 'https://start.example.test/';
export const SLUG = '1-0-0-abc1234';

export const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const TEMPLATE = text('bucket: __HCM_PROJECT_ID__-public\n');
export const PLAIN = text('<!doctype html>\n');

export function releaseOf(overrides: Partial<StartRelease> = {}): StartRelease {
    return {
        format: START_RELEASE_FORMAT,
        release: '1.0.0+abc1234',
        releaseTime: null,
        slug: SLUG,
        hosting: {
            rewrites: [{ glob: '/admin/**', path: '/admin/index.html' }],
            headers: [{ glob: '**', headers: { 'X-Site': '__HCM_PROJECT_ID__' } }],
        },
        files: [
            { path: 'index.html', bytes: PLAIN.length, sha256: sha(PLAIN) },
            { path: 'city/config.js', bytes: TEMPLATE.length, sha256: sha(TEMPLATE), template: true },
        ],
        ...overrides,
    };
}

export interface StartWorld {
    readonly fakes: UpstreamFakes;
    deps: StartDeps;
    readonly session: Map<string, string>;
    /** The visitor's `localStorage` (the language choice). */
    readonly local: Map<string, string>;
    readonly assigned: string[];
    /** The fragment the next `start()` reads. */
    fragment: string;
    /** Files the site does not serve, or serves with other bytes. */
    readonly files: Map<string, Uint8Array>;
    /** The upload host fails like a browser that cannot reach it. */
    uploadDown: boolean;
    configBody: unknown;
    releaseBody: unknown;
    now: number;
}

function json(value: unknown): Response {
    return new Response(JSON.stringify(value), { status: value === undefined ? 404 : 200 });
}

/** One world of the fake Google, a start site beside it, and the browser's other parts as plain objects. */
export function startWorld(): StartWorld {
    const fakes = createUpstreamFakes();
    fakes.scenario('firebase-hosting.fresh');
    const session = new Map<string, string>();
    const local = new Map<string, string>();
    const assigned: string[] = [];
    const world: StartWorld = {
        fakes,
        session,
        local,
        assigned,
        fragment: '',
        files: new Map([
            [`release/${SLUG}/tree/index.html`, PLAIN],
            [`release/${SLUG}/tree/city/config.js`, TEMPLATE],
        ]),
        uploadDown: false,
        configBody: { oauthClientId: 'client.apps.googleusercontent.com', release: SLUG },
        releaseBody: releaseOf(),
        now: 1_000_000,
        deps: undefined as unknown as StartDeps,
    };
    const siteFile = (path: string): Response => {
        if (path === 'start-config.json') {
            return json(world.configBody);
        }
        if (path === `release/${SLUG}/start-release.json`) {
            return json(world.releaseBody);
        }
        const bytes = world.files.get(path);
        return bytes === undefined ? new Response('', { status: 404 }) : new Response(bytes as Uint8Array<ArrayBuffer>);
    };
    const fetchAny: typeof fetch = (input, init) => {
        const url = new Request(input).url;
        if (url.startsWith(BASE)) {
            return Promise.resolve(siteFile(url.slice(BASE.length)));
        }
        if (world.uploadDown && url.includes('upload-firebasehosting')) {
            return Promise.reject(new TypeError('Failed to fetch'));
        }
        const hash = url.split('/').at(-1) ?? '';
        const headers = url.includes('upload-firebasehosting') ? { ...headersOf(init), 'x-hcm-checked': hash } : headersOf(init);
        return fakes.fetch(input, { ...init, headers });
    };
    const storeOf = (map: Map<string, string>): StartDeps['session'] => ({
        get: (key: string) => map.get(key) ?? null,
        set: (key: string, value: string) => {
            map.set(key, value);
        },
        remove: (key: string) => {
            map.delete(key);
        },
        keys: () => [...map.keys()],
    });
    const store = storeOf(session);
    world.deps = {
        fetch: fetchAny,
        tools: {
            fetch: fetchAny,
            digest: (bytes: Uint8Array) => Promise.resolve(sha(bytes)),
            gzip: (bytes: Uint8Array) => Promise.resolve(new Uint8Array(gzipSync(bytes))),
        },
        clock: {
            now: () => world.now,
            setTimeout: (run: () => void) => {
                queueMicrotask(run);
                return 0;
            },
            clearTimeout: () => undefined,
        },
        session: store,
        local: storeOf(local),
        log: testLog().log,
        baseUrl: BASE,
        fragment: () => world.fragment,
        clearFragment: () => {
            world.fragment = '';
        },
        assign: (url: string) => {
            assigned.push(url);
        },
        random: () => 'state-1',
        search: '?lang=en',
        languages: ['en'],
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        command: 'npx create-historic-city@1 self-host',
    };
    return world;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
    return Object.fromEntries(new Headers(init?.headers).entries());
}

/** The fragment Google's redirect leaves for this world's token. */
export function grantFragment(state: string, scopes: readonly string[] = START_SCOPES): string {
    return `#${new URLSearchParams({ access_token: GOOGLE_TOKENS.owner, token_type: 'Bearer', expires_in: '3600', scope: scopes.join(' '), state }).toString()}`;
}
