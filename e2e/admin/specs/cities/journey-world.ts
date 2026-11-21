import { gunzipSync } from 'node:zlib';

import type { APIRequestContext, Page } from '@playwright/test';

import { E2E_TOKEN } from '../../../fixtures/world.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { encodeFields } from '../../support/firestore-rest.js';
import { ADMIN_WEB_CONFIG, E2E_PROJECT_ID, emulatorOrigin } from '../../world.js';

/**
 * The world of the integrator's cross-app journey (M5, behaviour A54): what the photo pipeline and Setup's Mapbox card
 * leave for a new city (its photo's two files in the public bucket, its viewer token), the public bucket served to the
 * city's public page from the Storage emulator as Google's host serves it, and another city's admin acting with their own
 * credentials outside the app (the Firestore, Storage and Functions emulators' own REST, as any client of theirs could).
 * Every value is a generated test value.
 */

export const PUBLIC_BUCKET = `${E2E_PROJECT_ID}-public`;
export const PRIVATE_BUCKET = ADMIN_WEB_CONFIG.storageBucket;
const PUBLIC_HOST = `https://storage.googleapis.com/${PUBLIC_BUCKET}/`;
const EMULATOR_ADMIN = { authorization: 'Bearer owner' } as const;
const FIRESTORE_DOCUMENTS = `${emulatorOrigin('firestore')}/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents`;
const STORAGE = `${emulatorOrigin('storage')}/v0/b`;
const FUNCTIONS = `${emulatorOrigin('functions')}/${E2E_PROJECT_ID}/us-central1`;
/** A tiny WebP (RIFF header and a VP8L frame of one pixel): what the photo pipeline would have written. */
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const TYPES: Readonly<Record<string, string>> = { json: 'application/json', webp: 'image/webp' };

/** Writes `bytes` to `gs://<bucket>/<path>` past the rules. */
async function upload(api: APIRequestContext, bucket: string, path: string, bytes: Buffer, type: string): Promise<void> {
    const query = new URLSearchParams({ uploadType: 'media', name: path });
    const response = await api.post(`${emulatorOrigin('storage')}/upload/storage/v1/b/${bucket}/o?${query.toString()}`, {
        headers: { ...EMULATOR_ADMIN, 'content-type': type },
        data: bytes,
    });
    if (!response.ok()) {
        throw new Error(`upload of gs://${bucket}/${path}: ${String(response.status())} ${await response.text()}`);
    }
}

/** A photo's two derivatives where the photo pipeline leaves them (`photos/<city>/<id>/{web,thumb}.webp`). */
export async function uploadPhotoFiles(api: APIRequestContext, cityId: string, photoId: string): Promise<void> {
    for (const variant of ['web', 'thumb']) {
        await upload(api, PUBLIC_BUCKET, `photos/${cityId}/${photoId}/${variant}.webp`, WEBP, 'image/webp');
    }
}

/** An object of the private bucket, as a server would have left it (an export's zip, say). */
export async function uploadPrivate(api: APIRequestContext, path: string): Promise<void> {
    await upload(api, PRIVATE_BUCKET, path, Buffer.from('PK\u0005\u0006'), 'application/zip');
}

/** The city's viewer token as Setup's Mapbox card writes it (this project has no Mapbox, so `cities.create` minted none). */
export async function giveViewerToken(emulators: EmulatorWorld, cityId: string): Promise<void> {
    await emulators.updateFields(`cities/${cityId}`, { mapbox: { user: 'e2e-user', publicToken: E2E_TOKEN } }, ['mapbox']);
}

/**
 * The public bucket as a visitor's browser reaches it (`https://storage.googleapis.com/<project>-public/...`), answered
 * from the Storage emulator: the manifest the server built (stored gzip, served decoded with its type) and the photos'
 * files, with the bucket's CORS answer; anything the emulator does not hold is a 404, as Google's would be.
 */
export async function servePublicBucket(page: Page, emulators: EmulatorWorld): Promise<void> {
    await page.route(`${PUBLIC_HOST}**`, async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(`/${PUBLIC_BUCKET}/`.length));
        const stored = await emulators.storageObject(PUBLIC_BUCKET, path);
        const headers = { 'access-control-allow-origin': '*' };
        if (stored === undefined) {
            await route.fulfill({ status: 404, contentType: 'text/plain', headers, body: 'No such object.' });
            return;
        }
        const body = stored[0] === 0x1f && stored[1] === 0x8b ? gunzipSync(stored) : stored;
        const type = TYPES[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
        await route.fulfill({ status: 200, contentType: type, headers, body });
    });
}

/** A callable's answer: its HTTP status and, for a refusal, its error code (the message of `HttpsError`). */
export interface CallableAnswer {
    readonly status: number;
    readonly code: string | null;
}

/** Another city's admin, with their own ID token, outside the app: each request answers its HTTP status. */
export class Outsider {
    readonly #api: APIRequestContext;
    readonly #token: string;

    constructor(api: APIRequestContext, idToken: string) {
        this.#api = api;
        this.#token = idToken;
    }

    async read(path: string): Promise<number> {
        return (await this.#api.get(`${FIRESTORE_DOCUMENTS}/${path}`, { headers: this.#bearer() })).status();
    }

    async write(path: string, data: Readonly<Record<string, unknown>>): Promise<number> {
        const mask = Object.keys(data)
            .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
            .join('&');
        const response = await this.#api.patch(`${FIRESTORE_DOCUMENTS}/${path}?${mask}`, {
            headers: this.#bearer(),
            data: { fields: encodeFields(data) },
        });
        return response.status();
    }

    async download(bucket: string, path: string): Promise<number> {
        const url = `${STORAGE}/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
        return (await this.#api.get(url, { headers: this.#firebase() })).status();
    }

    async upload(bucket: string, path: string): Promise<number> {
        const response = await this.#api.post(`${STORAGE}/${bucket}/o?${new URLSearchParams({ name: path }).toString()}`, {
            headers: { ...this.#firebase(), 'content-type': 'image/webp' },
            data: WEBP,
        });
        return response.status();
    }

    /** Calls a callable (`export.download`) as the Firebase SDK would. */
    async call(name: string, data: Readonly<Record<string, unknown>>): Promise<CallableAnswer> {
        const response = await this.#api.post(`${FUNCTIONS}/${name.replaceAll('.', '-')}`, {
            headers: { ...this.#bearer(), 'content-type': 'application/json' },
            data: { data },
        });
        const body = (await response.json()) as { readonly error?: { readonly message?: string } };
        return { status: response.status(), code: body.error?.message ?? null };
    }

    #bearer(): Readonly<Record<string, string>> {
        return { authorization: `Bearer ${this.#token}` };
    }

    #firebase(): Readonly<Record<string, string>> {
        return { authorization: `Firebase ${this.#token}` };
    }
}
