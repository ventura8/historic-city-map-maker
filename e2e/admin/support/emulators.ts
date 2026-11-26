import type { APIRequestContext, APIResponse } from '@playwright/test';
import { inviteIdFor } from '@hcm/shared';

import { ADMIN_ORIGIN, ADMIN_PROJECT, ADMIN_WEB_CONFIG, E2E_PROJECT_ID, emulatorOrigin, PERSONAS, type PersonaName } from '../world.js';
import { isContentCity, isContentEmail } from './content-ids.js';
import { decodeFields, encodeFields, type FirestoreFields } from './firestore-rest.js';
import { resending, type EmulatorApi } from './resend.js';

/** The city of `infra/project.json` the locked admin specs edit, whose memberships the personas' documents carry (M5). */
const BUNDLED_CITY = ADMIN_PROJECT.cities[0];

/**
 * The Firebase emulators of the admin tier, driven over their REST APIs from the test (never from the page): emptied
 * before every locked admin test (docs/research/M2b-interfaces.md §6.2) except the content worlds that run beside it
 * (`content-ids.ts`), Google accounts signed in to the Auth emulator the way Firebase Auth signs a Google credential in
 * (`signInWithIdp` with the unsigned ID token the emulator accepts), and Firestore documents seeded or read with the
 * emulator's owner credential, which bypasses the security rules.
 */

/** The Auth and Firestore emulators' administrator credential (`Authorization: Bearer owner`). */
const EMULATOR_ADMIN = { authorization: 'Bearer owner' } as const;

const AUTH = `${emulatorOrigin('auth')}/identitytoolkit.googleapis.com/v1`;
const FIRESTORE_DATABASE = `projects/${E2E_PROJECT_ID}/databases/(default)`;
const FIRESTORE_DOCUMENTS = `${emulatorOrigin('firestore')}/v1/${FIRESTORE_DATABASE}/documents`;
const STORAGE = emulatorOrigin('storage');

/** Every bucket the admin and the functions write (`functions/src/deps.ts`: the private and the public one). */
const BUCKETS: readonly string[] = [ADMIN_WEB_CONFIG.storageBucket, `${E2E_PROJECT_ID}-public`];

/**
 * How long work of the Functions emulator may take (a history trigger, a manifest build, a photo's processing): one
 * emulator serves every test of a run, and a full parallel run (the tour's admin journeys beside the admin tier) keeps it
 * busy, so a trigger can wait a minute behind the others' (the per-push tour's first run, 2026-10-18).
 */
export const FUNCTIONS_TIMEOUT_MS = 120_000;

/** How many deletes one Firestore commit carries (the API's limit is 500). */
const COMMIT_SIZE = 400;

/** A Google account as the stand-in consent and the Auth emulator know it. */
export interface GoogleAccount {
    readonly email: string;
    /** The Google subject (`sub`): the same account signs in to the same Auth emulator user every time. */
    readonly sub: string;
    readonly displayName: string;
}

/** A Google account signed in to the Auth emulator: what Firebase Auth keeps for its current user. */
export interface SignedInAccount extends GoogleAccount {
    /** The admin tier's persona, or null for a content world's own account. */
    readonly persona: PersonaName | null;
    readonly uid: string;
    /** The Firebase ID token (an unsigned JWT in the emulator) and its refresh token. */
    readonly idToken: string;
    readonly refreshToken: string;
    /** Seconds. */
    readonly expiresIn: number;
}

interface SignInWithIdpResponse {
    readonly localId: string;
    readonly email: string;
    readonly idToken: string;
    readonly refreshToken: string;
    readonly expiresIn: string;
}

/**
 * Attempts at emptying Firestore. A background function of the previous test (a trigger, a manifest task) may still hold
 * a document lock when the next test starts; the emulator then refuses the reset with 409 ABORTED ("Transaction lock
 * timeout") after waiting for the lock itself, so the next attempt starts once that transaction is over.
 */
const FIRESTORE_RESET_ATTEMPTS = 3;

async function ok(response: APIResponse, what: string): Promise<APIResponse> {
    if (!response.ok()) {
        throw new Error(`${what}: ${String(response.status())} ${await response.text()}`);
    }
    return response;
}

interface ListedDocument {
    readonly name: string;
    readonly fields?: FirestoreFields;
}

/** A document path (`cities/w-…/photos/p1`) a reset keeps: a content world's city, its manifest state, its admins. */
function keptByReset(path: string, fields: FirestoreFields | undefined): boolean {
    const [collection = '', id = '', ...rest] = path.split('/');
    if (collection === 'cities' || collection === 'manifests') {
        return isContentCity(id);
    }
    return collection === 'admins' && rest.length === 0 && isContentEmail(decodeFields(fields ?? {})['email']);
}

/**
 * The first segments of the Storage paths that name the city second: `STORAGE_PATHS`' public derivatives and manifest,
 * and `RASTER_PATHS`' version files, scratch files and reference cache (M3).
 */
const CITY_FIRST: ReadonlySet<string> = new Set(['cities', 'photos', 'rasters', 'work', 'reference', 'exports']);

/** USGS browse copies are shared by every city (`usgs-browse/<dataset>/<entity>.jpg`): the same image, kept. */
const SHARED_PREFIXES: readonly string[] = ['usgs-browse/'];

/**
 * A Storage object a reset keeps: one of a content world's city, or a shared browse copy. The public derivatives
 * (`photos/<city>/…`), the manifest (`cities/<city>/…`), the raster files (`rasters/<city>/…`, `work/<city>/…`,
 * `reference/<city>/…`) and the static exports (`exports/<city>/<id>.zip`) name it second, the uploads and the originals
 * (`uploads/photos/<city>/…`, `uploads/rasters/<city>/…`, `originals/photos/<city>/…`) third: a reset once read the
 * photo's id as the city of a derivative and deleted every content world's public photos (`docs/LESSONS.md` 116), and
 * an export's file name as its city, deleting a content world's zip while its test downloaded it (CR-M5-25).
 */
function storageKeptByReset(name: string): boolean {
    const parts = name.split('/');
    const city = CITY_FIRST.has(parts[0] ?? '') ? parts[1] : parts[2];
    return SHARED_PREFIXES.some((prefix) => name.startsWith(prefix)) || (parts.length > 2 && isContentCity(city ?? ''));
}

export class EmulatorWorld {
    readonly #api: EmulatorApi;

    constructor(api: APIRequestContext) {
        this.#api = resending(api);
    }

    /**
     * Empties Firestore, Auth and Storage (the rules stay loaded) except the content worlds, which run beside the locked
     * admin tests (`content-ids.ts`): their cities, manifest states, Storage objects and accounts stay.
     */
    async reset(): Promise<void> {
        await this.#resetFirestore();
        await this.#resetAuth();
        for (const bucket of BUCKETS) {
            await this.#resetBucket(bucket);
        }
    }

    /** Deletes every document a content world does not own; a 409 (a lock still held by background work) is tried again. */
    async #resetFirestore(): Promise<void> {
        await this.#deleteAll(await this.#documentsBelow('', keptByReset));
    }

    async #deleteAll(names: readonly string[]): Promise<void> {
        for (let start = 0; start < names.length; start += COMMIT_SIZE) {
            await this.#commitDeletes(names.slice(start, start + COMMIT_SIZE));
        }
    }

    async #commitDeletes(names: readonly string[]): Promise<void> {
        const commit = (): Promise<APIResponse> =>
            this.#api.post(`${FIRESTORE_DOCUMENTS}:commit`, {
                headers: EMULATOR_ADMIN,
                data: { writes: names.map((name) => ({ delete: name })) },
                timeout: 30_000,
            });
        for (let attempt = 1; attempt < FIRESTORE_RESET_ATTEMPTS; attempt += 1) {
            const response = await commit();
            if (response.status() !== 409) {
                await ok(response, 'Firestore reset');
                return;
            }
        }
        await ok(await commit(), 'Firestore reset');
    }

    /** The full names of the documents below `parent` (`''`: the root) that `kept` does not keep, deepest first. */
    async #documentsBelow(parent: string, kept: (path: string, fields: FirestoreFields | undefined) => boolean): Promise<string[]> {
        const collections = await this.#collectionIds(parent);
        const found = await Promise.all(
            collections.map(async (collection) => {
                const path = parent === '' ? collection : `${parent}/${collection}`;
                const documents = await this.#listDocuments(path);
                const below = await Promise.all(
                    documents
                        .map((document) => ({ document, docPath: document.name.slice(document.name.indexOf('/documents/') + 11) }))
                        .filter(({ document, docPath }) => !kept(docPath, document.fields))
                        .map(async ({ document, docPath }) => [...(await this.#documentsBelow(docPath, kept)), document.name]),
                );
                return below.flat();
            }),
        );
        return found.flat();
    }

    async #collectionIds(parent: string): Promise<string[]> {
        const url = parent === '' ? `${FIRESTORE_DOCUMENTS}:listCollectionIds` : `${FIRESTORE_DOCUMENTS}/${parent}:listCollectionIds`;
        const ids: string[] = [];
        let pageToken = '';
        do {
            const response = await this.#api.post(url, { headers: EMULATOR_ADMIN, data: { pageSize: 1000, pageToken } });
            const body = (await (await ok(response, `collections of ${parent || 'the root'}`)).json()) as {
                readonly collectionIds?: readonly string[];
                readonly nextPageToken?: string;
            };
            ids.push(...(body.collectionIds ?? []));
            pageToken = body.nextPageToken ?? '';
        } while (pageToken !== '');
        return ids;
    }

    /** Every document of a collection, those that exist only as the parent of a subcollection included. */
    async #listDocuments(collection: string): Promise<ListedDocument[]> {
        const documents: ListedDocument[] = [];
        let pageToken = '';
        do {
            const query = new URLSearchParams({ pageSize: '1000', showMissing: 'true', pageToken });
            const response = await this.#api.get(`${FIRESTORE_DOCUMENTS}/${collection}?${query.toString()}`, { headers: EMULATOR_ADMIN });
            const body = (await (await ok(response, `list of ${collection}`)).json()) as {
                readonly documents?: readonly ListedDocument[];
                readonly nextPageToken?: string;
            };
            documents.push(...(body.documents ?? []));
            pageToken = body.nextPageToken ?? '';
        } while (pageToken !== '');
        return documents;
    }

    /** Deletes every Auth account but the content worlds'. */
    async #resetAuth(): Promise<void> {
        const response = await this.#api.post(`${AUTH}/projects/${E2E_PROJECT_ID}/accounts:query`, {
            headers: EMULATOR_ADMIN,
            data: { returnUserInfo: true },
        });
        const body = (await (await ok(response, 'Auth accounts')).json()) as {
            readonly userInfo?: readonly { readonly localId: string; readonly email?: string }[];
        };
        const localIds = (body.userInfo ?? []).filter((user) => !isContentEmail(user.email)).map((user) => user.localId);
        if (localIds.length > 0) {
            const deleted = await this.#api.post(`${AUTH}/projects/${E2E_PROJECT_ID}/accounts:batchDelete`, {
                headers: EMULATOR_ADMIN,
                data: { localIds, force: true },
            });
            await ok(deleted, 'Auth reset');
        }
    }

    /** Deletes every object of `bucket` but the content worlds'. */
    async #resetBucket(bucket: string): Promise<void> {
        await this.#deleteObjects(bucket, (name) => !storageKeptByReset(name));
    }

    /** Deletes the objects of `bucket` whose name `doomed` picks. */
    async #deleteObjects(bucket: string, doomed: (name: string) => boolean): Promise<void> {
        const names: string[] = [];
        let pageToken = '';
        do {
            const query = pageToken === '' ? '' : `?pageToken=${encodeURIComponent(pageToken)}`;
            const response = await this.#api.get(`${STORAGE}/storage/v1/b/${bucket}/o${query}`, { headers: EMULATOR_ADMIN });
            const body = (await (await ok(response, `objects of ${bucket}`)).json()) as {
                readonly items?: readonly { readonly name: string }[];
                readonly nextPageToken?: string;
            };
            names.push(...(body.items ?? []).map((item) => item.name).filter(doomed));
            pageToken = body.nextPageToken ?? '';
        } while (pageToken !== '');
        for (const name of names) {
            const response = await this.#api.delete(`${STORAGE}/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}`, {
                headers: EMULATOR_ADMIN,
            });
            if (response.status() !== 404) {
                await ok(response, `delete of gs://${bucket}/${name}`);
            }
        }
    }

    /** Signs `persona` in with Google (creating the account on first use) and returns its fresh tokens. */
    async signIn(persona: PersonaName): Promise<SignedInAccount> {
        return this.signInAs(PERSONAS[persona], persona);
    }

    /** Signs any Google account in (a content world's own: `persona` null) and returns its fresh tokens. */
    async signInAs(account: GoogleAccount, persona: PersonaName | null = null): Promise<SignedInAccount> {
        const { email, sub, displayName } = account;
        const idToken = JSON.stringify({ sub, email, email_verified: true, name: displayName });
        const response = await this.#api.post(`${AUTH}/accounts:signInWithIdp?key=${ADMIN_WEB_CONFIG.apiKey}`, {
            data: {
                postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`,
                requestUri: ADMIN_ORIGIN,
                returnIdpCredential: true,
                returnSecureToken: true,
            },
        });
        const body = (await (await ok(response, `sign-in of ${email}`)).json()) as SignInWithIdpResponse;
        return {
            persona,
            sub,
            displayName,
            uid: body.localId,
            email: body.email,
            idToken: body.idToken,
            refreshToken: body.refreshToken,
            expiresIn: Number(body.expiresIn),
        };
    }

    /** Sets an account's custom claims (`{admin: true}`), as `admin.claim` and `admin.join` do. */
    async setClaims(uid: string, claims: Readonly<Record<string, unknown>>): Promise<void> {
        const response = await this.#api.post(`${AUTH}/projects/${E2E_PROJECT_ID}/accounts:update`, {
            headers: EMULATOR_ADMIN,
            data: { localId: uid, customAttributes: JSON.stringify(claims) },
        });
        await ok(response, `claims of ${uid}`);
    }

    /** An account's custom claims and the time before which its sessions are revoked (`validSince`, seconds). */
    async account(uid: string): Promise<{ readonly claims: Readonly<Record<string, unknown>>; readonly validSince: number }> {
        const response = await this.#api.post(`${AUTH}/projects/${E2E_PROJECT_ID}/accounts:lookup`, {
            headers: EMULATOR_ADMIN,
            data: { localId: [uid] },
        });
        const body = (await (await ok(response, `lookup of ${uid}`)).json()) as {
            readonly users?: readonly { readonly customAttributes?: string; readonly validSince?: string }[];
        };
        const [user] = body.users ?? [];
        return {
            claims: JSON.parse(user?.customAttributes ?? '{}') as Readonly<Record<string, unknown>>,
            validSince: Number(user?.validSince ?? '0'),
        };
    }

    /** Writes a whole document (`setup/owner`, `admins/<uid>`), bypassing the rules. */
    async setDocument(path: string, data: Readonly<Record<string, unknown>>): Promise<void> {
        const response = await this.#api.patch(`${FIRESTORE_DOCUMENTS}/${path}`, {
            headers: EMULATOR_ADMIN,
            data: { fields: encodeFields(data) },
        });
        await ok(response, `write of ${path}`);
    }

    /** Changes some fields of a document (dotted paths of `data`'s top-level keys stay as given), bypassing the rules. */
    async updateFields(path: string, data: Readonly<Record<string, unknown>>, fieldPaths: readonly string[]): Promise<void> {
        const mask = fieldPaths.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&');
        const response = await this.#api.patch(`${FIRESTORE_DOCUMENTS}/${path}?${mask}`, {
            headers: EMULATOR_ADMIN,
            data: { fields: encodeFields(data) },
        });
        await ok(response, `update of ${path}`);
    }

    /**
     * Runs the scheduled `ops.tick` once, as Cloud Scheduler would: the Functions emulator cannot trigger a v2 scheduled
     * function from its Pub/Sub topic (its signature is `http`), so the event goes to the function's trigger route, whose
     * key carries the emulator's trigger generation (0 until the functions are reloaded). The server's clock cannot be
     * moved from a test.
     */
    async runOpsTick(): Promise<void> {
        const trigger = `${emulatorOrigin('functions')}/functions/projects/${E2E_PROJECT_ID}/triggers/us-central1-ops-tick-0`;
        const response = await this.#api.post(trigger, {
            headers: { 'content-type': 'application/cloudevents+json; charset=UTF-8' },
            data: { specversion: '1.0', id: 'e2e-ops-tick', source: 'e2e', type: 'google.cloud.scheduler.job.v1.executed', data: {} },
            timeout: 60_000,
        });
        await ok(response, 'ops.tick (restart the emulators if the functions were reloaded)');
    }

    /** Deletes a document as another admin or the server would (the history trigger records it), bypassing the rules. */
    async deleteDocument(path: string): Promise<void> {
        const response = await this.#api.delete(`${FIRESTORE_DOCUMENTS}/${path}`, { headers: EMULATOR_ADMIN });
        await ok(response, `delete of ${path}`);
    }

    /** A document's data, or undefined when it does not exist. */
    async document(path: string): Promise<Record<string, unknown> | undefined> {
        const response = await this.#api.get(`${FIRESTORE_DOCUMENTS}/${path}`, { headers: EMULATOR_ADMIN });
        if (response.status() === 404) {
            return undefined;
        }
        const body = (await (await ok(response, `read of ${path}`)).json()) as { readonly fields?: FirestoreFields };
        return decodeFields(body.fields ?? {});
    }

    /**
     * An object of the Storage emulator's bucket `bucket` (`demo-hcm-public`: what the viewer reads), read past the rules,
     * or undefined when it does not exist. A gzip-encoded object (the manifest) comes back as it is stored.
     */
    async storageObject(bucket: string, path: string): Promise<Buffer | undefined> {
        const url = `${emulatorOrigin('storage')}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
        const response = await this.#api.get(url, { headers: EMULATOR_ADMIN });
        if (response.status() === 404) {
            return undefined;
        }
        return (await ok(response, `read of gs://${bucket}/${path}`)).body();
    }

    /** The names of the objects of a bucket (the private one by default) below `prefix`, sorted. */
    async objectNames(prefix: string, bucket: string = ADMIN_WEB_CONFIG.storageBucket): Promise<string[]> {
        const query = new URLSearchParams({ prefix });
        const response = await this.#api.get(`${STORAGE}/storage/v1/b/${bucket}/o?${query.toString()}`, { headers: EMULATOR_ADMIN });
        const body = (await (await ok(response, `objects of ${bucket}`)).json()) as {
            readonly items?: readonly { readonly name: string }[];
        };
        return (body.items ?? []).map((item) => item.name).sort((a, b) => a.localeCompare(b));
    }

    /** Every document of a collection (`cities/bucharest/photos`), by id, read past the rules. */
    async collection(path: string): Promise<Record<string, Record<string, unknown>>> {
        const response = await this.#api.get(`${FIRESTORE_DOCUMENTS}/${path}?pageSize=1000`, { headers: EMULATOR_ADMIN });
        const body = (await (await ok(response, `list of ${path}`)).json()) as {
            readonly documents?: readonly { readonly name: string; readonly fields?: FirestoreFields }[];
        };
        return Object.fromEntries(
            (body.documents ?? []).map((document) => [
                document.name.slice(document.name.lastIndexOf('/') + 1),
                decodeFields(document.fields ?? {}),
            ]),
        );
    }

    /**
     * The map claimed by `account`, as `admin.claim` leaves it: `setup/owner`, the owner's `admins/<uid>` and the
     * `admin` claim (`functions/src/admin/claim.ts`).
     */
    async claimFor(account: SignedInAccount, at: Date): Promise<void> {
        const stamp = { updatedBy: account.uid, updatedAt: at };
        await this.setDocument('setup/owner', { uid: account.uid, claimedAt: at, ...stamp });
        // M5 (CR-M5-3): the project's owner owns the bundled city, as `setup.createCity` or the migration leave them.
        const cities = { [BUNDLED_CITY]: 'owner' };
        await this.setDocument(`admins/${account.uid}`, { role: 'owner', cities, email: account.email, createdAt: at, ...stamp });
        await this.setClaims(account.uid, { admin: true });
    }

    /** An invitation of `email` by `inviter`, as `admins.invite` stores it (the address hashed, never stored). */
    async invite(email: string, inviter: SignedInAccount, at: Date, expiresAt: Date): Promise<void> {
        const stamp = { updatedBy: inviter.uid, updatedAt: at };
        await this.setDocument(`invites/${await inviteIdFor(email)}`, {
            role: 'admin',
            // M5 (CR-M5-3): an invitation names its city and role, as `admins.invite` stores it.
            cities: { [BUNDLED_CITY]: 'editor' },
            invitedBy: inviter.uid,
            createdAt: at,
            expiresAt,
            ...stamp,
        });
    }

    /** `account` as an admin who already joined, as `admin.join` leaves it: `admins/<uid>` and the `admin` claim. */
    async addAdmin(account: SignedInAccount, inviter: SignedInAccount, at: Date): Promise<void> {
        const record = {
            role: 'admin',
            // M5 (CR-M5-3): an editor of the bundled city, as `admin.join` of its invitation leaves them.
            cities: { [BUNDLED_CITY]: 'editor' },
            email: account.email,
            invitedBy: inviter.uid,
            createdAt: at,
            updatedBy: account.uid,
            updatedAt: at,
        };
        await this.setDocument(`admins/${account.uid}`, record);
        await this.setClaims(account.uid, { admin: true });
    }
}
