/**
 * Test world for the security-rules matrix: personas, emulator contexts, seeding and verdicts.
 *
 * Runs only under `firebase emulators:exec --project demo-hcm --only auth,firestore,storage`
 * (scripts/ci/run-emulated-tests.sh): initializeTestEnvironment discovers the emulators through the
 * hub, and the emulators load firebase/firestore.rules and firebase/storage.rules from firebase.json
 * once at start-up, so the Firestore rule coverage accumulates over every test file (loading rules
 * from a test would reset it). Test files run in parallel against the same emulators, so every file
 * owns a `scope`: its persona uids and its city ids start with it, and nothing is ever cleared.
 */
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment, type TokenOptions } from '@firebase/rules-unit-testing';
import { FIRESTORE_PATHS, inviteIdFor } from '@hcm/shared';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { vi } from 'vitest';

const PROJECT_ID = 'demo-hcm';

// The SDK logs every PERMISSION_DENIED it receives; denials are the expected outcome of half the matrix.
firebase.firestore.setLogLevel('silent');

// Every request is a round trip to the emulators (a 60 MiB upload among them), so each test file that
// uses this world gets generous timeouts (set here rather than in the shared vitest.config.ts).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Who is asking. Every persona but `admin` misses at least one admin condition (docs/research/M2-interfaces.md §3.1):
 * a verified Google account, the `admin` claim and an admins/{uid} document; M5 (docs/research/M5-interfaces.md §1.4)
 * adds `outsider`, a full admin of another city only, and makes `admin` the project's owner and a member of every city
 * its world seeds (the personas with an admins document are members, so their denials come from what they miss).
 */
export type Persona =
    | 'anonymous' // no Firebase Auth user
    | 'stranger' // verified Google account, no claim, no admins doc
    | 'invited' // a stranger with a pending invitation (invites/{sha256}): admin.join has not run yet
    | 'unverified' // claim + admins doc, but email_verified is false
    | 'otherProvider' // claim + admins doc, but signed in with a password, not Google
    | 'revoked' // claim but no admins doc: admins.revoke deleted it and the ID token still carries the claim
    | 'pending' // admins doc but no claim yet: admin.join or admin.claim ran, the ID token is not refreshed
    | 'outsider' // M5: claim + admins doc, an editor of another city only (`<scope>-elsewhere`)
    | 'admin'; // verified Google account with the claim and the admins doc: the project's owner, a member of every city

/** Every persona, `admin` last: a test that lets the admin write runs it after the denials. */
export const EVERYONE: readonly Persona[] = [
    'anonymous',
    'stranger',
    'invited',
    'unverified',
    'otherProvider',
    'revoked',
    'pending',
    'outsider',
    'admin',
];
/** The personas `authed()` accepts: a verified Google sign-in, whatever else they hold. */
export const GOOGLE_ACCOUNTS: readonly Persona[] = ['stranger', 'invited', 'revoked', 'pending', 'outsider', 'admin'];
/** The city's member: what a city path allows. */
export const ADMIN_ONLY: readonly Persona[] = ['admin'];
/** Every admin, whatever their cities: what a project path (setup, the budget guard, the project's usage) allows. */
export const ANY_ADMIN: readonly Persona[] = ['outsider', 'admin'];
export const NOBODY: readonly Persona[] = [];

interface PersonaSpec {
    readonly claims: TokenOptions | null;
    readonly adminDoc: boolean;
    readonly invite: boolean;
    /** The persona's admins/{uid}.role. */
    readonly role?: 'owner' | 'admin';
    /** Gets a role in every city its world seeds (`World.seed` of a path under `cities/`). */
    readonly member?: boolean;
}

const GOOGLE: TokenOptions = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };

const PERSONAS: Readonly<Record<Persona, PersonaSpec>> = {
    anonymous: { claims: null, adminDoc: false, invite: false },
    stranger: { claims: GOOGLE, adminDoc: false, invite: false },
    invited: { claims: GOOGLE, adminDoc: false, invite: true },
    unverified: { claims: { ...GOOGLE, email_verified: false, admin: true }, adminDoc: true, invite: false, member: true },
    otherProvider: {
        claims: { email_verified: true, firebase: { sign_in_provider: 'password' }, admin: true },
        adminDoc: true,
        invite: false,
        member: true,
    },
    revoked: { claims: { ...GOOGLE, admin: true }, adminDoc: false, invite: false },
    pending: { claims: GOOGLE, adminDoc: true, invite: false, member: true },
    outsider: { claims: { ...GOOGLE, admin: true }, adminDoc: true, invite: false },
    admin: { claims: { ...GOOGLE, admin: true }, adminDoc: true, invite: false, role: 'owner', member: true },
};

/** The personas that get a role in every city their world seeds. */
const MEMBERS = (Object.keys(PERSONAS) as Persona[]).filter((persona) => PERSONAS[persona].member === true);

type Context = ReturnType<RulesTestEnvironment['unauthenticatedContext']>;
type Db = firebase.firestore.Firestore;
type Storage = firebase.storage.Storage;
export type Data = firebase.firestore.DocumentData;
export type Timestamp = firebase.firestore.Timestamp;

/** The rules' answer to one request. */
export type Verdict = 'allow' | 'deny';

export interface World {
    readonly env: RulesTestEnvironment;
    uid(persona: Persona): string;
    email(persona: Persona): string;
    /** M5: the city the `outsider` persona edits (`<scope>-elsewhere`), seeded with every world. */
    readonly elsewhere: string;
    /** The persona's admins/{uid} document as the world seeded it (to put it back after a test removed it). */
    adminDocOf(persona: Persona): Data;
    db(persona: Persona): Db;
    storage(persona: Persona): Storage;
    /**
     * Writes a Firestore document with rules disabled (the Admin SDK's view). A path under `cities/{city}` first gives the
     * member personas a role in that city (M5), so the M2 to M4 tests keep testing what they did.
     */
    seed(path: string, data: Data): Promise<void>;
    /** Uploads an object with rules disabled (what Cloud Functions or the Cloud Run job would write). */
    seedObject(path: string, contentType: string): Promise<void>;
    /** Ends the seeding context, then cleans up the environment: every test file's `afterAll`. */
    close(): Promise<void>;
}

/** A fixed timestamp for seeded documents (never equal to request.time). */
export function past(): Timestamp {
    return firebase.firestore.Timestamp.fromMillis(Date.UTC(2026, 0, 1));
}

/** A fixed later timestamp (an invitation's expiry, a lease). */
export function later(): Timestamp {
    return firebase.firestore.Timestamp.fromMillis(Date.UTC(2026, 0, 15));
}

/** `request.time` on the server: the only accepted value for a client's createdAt/updatedAt. */
export function serverTime(): firebase.firestore.FieldValue {
    return firebase.firestore.FieldValue.serverTimestamp();
}

/** Removes a field in an update. */
export function deleted(): firebase.firestore.FieldValue {
    return firebase.firestore.FieldValue.delete();
}

/**
 * `base` with `changes` applied, where a `deleted()` value removes the field: what an update with the same changes
 * leaves, for writes that replace the whole document (`set`, which refuses the delete sentinel).
 */
export function withChanges(base: Data, changes: Data): Data {
    const removed = new Set(Object.keys(changes).filter((field) => isDeletion(changes[field])));
    return Object.fromEntries(Object.entries({ ...base, ...changes }).filter(([field]) => !removed.has(field)));
}

function isDeletion(value: unknown): boolean {
    return value instanceof firebase.firestore.FieldValue && value.isEqual(deleted());
}

/** The audit fields every client write carries. */
export function stampedBy(uid: string): Data {
    return { updatedBy: uid, updatedAt: serverTime() };
}

/** A server write's stamp (`systemWriter`), at a fixed time in the past. */
export function systemStamp(writer: string): Data {
    return { updatedBy: `system:${writer}`, updatedAt: past() };
}

/** The persona's cities: the outsider's one city, or (for a member) every city granted so far. */
function citiesOf(persona: Persona, elsewhere: string, granted: Iterable<string>): Data {
    if (persona === 'outsider') {
        return { [elsewhere]: 'editor' };
    }
    return PERSONAS[persona].member === true ? Object.fromEntries([...granted].map((city) => [city, 'editor'])) : {};
}

/** The admins/{uid} document of a persona: its project role and its cities. */
function adminDocFor(persona: Persona, account: { readonly email: string; readonly cities: Data }): Data {
    const role = PERSONAS[persona].role ?? 'admin';
    return { role, cities: account.cities, email: account.email, createdAt: past(), updatedBy: 'system:bootstrap', updatedAt: past() };
}

function seedPersonas(world: World): Promise<unknown> {
    const seeds = EVERYONE.flatMap((persona) => {
        const spec = PERSONAS[persona];
        const writes: Promise<void>[] = [];
        if (spec.adminDoc) {
            writes.push(world.seed(FIRESTORE_PATHS.admin(world.uid(persona)), world.adminDocOf(persona)));
        }
        if (spec.invite) {
            const invite = {
                role: 'admin',
                invitedBy: world.uid('admin'),
                createdAt: past(),
                expiresAt: later(),
                ...systemStamp('admins'),
            };
            writes.push(inviteIdFor(world.email(persona)).then((id) => world.seed(FIRESTORE_PATHS.invite(id), invite)));
        }
        return writes;
    });
    return Promise.all(seeds);
}

/** The rules-disabled context the seeds of one world write through, until `release`. */
interface Owner {
    readonly context: Promise<Context>;
    release(): Promise<void>;
}

/**
 * `withSecurityRulesDisabled` starts a Firebase app, and with it a new connection to the emulators, for every call, which
 * costs more than the write: one call held open for the world's lifetime makes each seed a single write (the rules
 * project ran about a sixth faster, docs/research/pipeline-baseline.md, the tests addendum). `release` lets the call
 * end, and the environment then deletes its app.
 */
function holdOwner(env: RulesTestEnvironment): Owner {
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    let held: Promise<void> | undefined;
    const context = new Promise<Context>((resolve, reject) => {
        held = env.withSecurityRulesDisabled(async (owner) => {
            resolve(owner);
            await released;
        });
        held.catch(reject);
    });
    return {
        context,
        release: async () => {
            release();
            await held;
        },
    };
}

export async function createWorld(scope: string): Promise<World> {
    const env = await initializeTestEnvironment({ projectId: PROJECT_ID });
    const uid = (persona: Persona): string => `${scope}-${persona}`;
    const email = (persona: Persona): string => `${uid(persona)}@example.test`;
    // One context per persona: every context starts its own Firebase app, which costs more than the request.
    const contexts = new Map<Persona, Context>();
    const context = (persona: Persona): Context => {
        const known = contexts.get(persona);
        if (known !== undefined) {
            return known;
        }
        const { claims } = PERSONAS[persona];
        const created =
            claims === null ? env.unauthenticatedContext() : env.authenticatedContext(uid(persona), { ...claims, email: email(persona) });
        contexts.set(persona, created);
        return created;
    };
    const owner = holdOwner(env);
    const elsewhere = `${scope}-elsewhere`;
    const granted = new Map<string, Promise<void>>();
    const adminDocOf = (persona: Persona): Data =>
        adminDocFor(persona, { email: email(persona), cities: citiesOf(persona, elsewhere, granted.keys()) });
    // M5: the member personas get a role in a city before anything of it is seeded, once per city.
    const grant = (city: string): Promise<void> => {
        const known = granted.get(city);
        if (known !== undefined) {
            return known;
        }
        const granting = owner.context.then(async (context) => {
            const role = new firebase.firestore.FieldPath('cities', city);
            await Promise.all(
                MEMBERS.map((persona) =>
                    context
                        .firestore()
                        .doc(FIRESTORE_PATHS.admin(uid(persona)))
                        .update(role, 'editor'),
                ),
            );
        });
        granted.set(city, granting);
        return granting;
    };
    const seed = async (path: string, data: Data): Promise<void> => {
        const city = CITY_PATH.exec(path)?.[1];
        if (city !== undefined && city !== elsewhere) {
            await grant(city);
        }
        await (await owner.context).firestore().doc(path).set(data);
    };
    const seedObject = async (path: string, contentType: string): Promise<void> => {
        await (await owner.context).storage().ref(path).put(bytes(16), { contentType });
    };
    const close = async (): Promise<void> => {
        await owner.release();
        await env.cleanup();
    };
    const world: World = {
        env,
        uid,
        email,
        elsewhere,
        adminDocOf,
        db: (persona) => context(persona).firestore(),
        storage: (persona) => context(persona).storage(),
        seed,
        seedObject,
        close,
    };
    await seedPersonas(world);
    await seed(FIRESTORE_PATHS.city(elsewhere), {
        name: { ro: elsewhere },
        bounds: ELSEWHERE_BOUNDS,
        published: false,
        ...systemStamp('cities'),
    });
    return world;
}

/** `cities/{city}` and every path below it. */
const CITY_PATH = /^cities\/([^/]+)/;

/** The outsider's city: somewhere far from every test city. */
const ELSEWHERE_BOUNDS = { west: 23.5, south: 46.72, east: 23.7, north: 46.82 };

export function bytes(size: number): Uint8Array {
    return new Uint8Array(size);
}

/**
 * Runs a request and reports whether the rules allowed it. Any failure other than a permission
 * denial (emulator down, bad request) is rethrown by assertFails, so a broken test never reads as "deny".
 */
export async function verdict(request: Promise<unknown>): Promise<Verdict> {
    try {
        await request;
        return 'allow';
    } catch (error) {
        await assertFails(Promise.reject(error instanceof Error ? error : new Error(String(error))));
        return 'deny';
    }
}

/** The verdict of the same request for each persona, in order (sequential: writes may touch one document). */
export async function verdicts(
    personas: readonly Persona[],
    request: (persona: Persona) => Promise<unknown>,
): Promise<Partial<Record<Persona, Verdict>>> {
    const result: Partial<Record<Persona, Verdict>> = {};
    for (const persona of personas) {
        result[persona] = await verdict(request(persona));
    }
    return result;
}

/** `{persona: verdict}` where only `allowed` personas get 'allow'. */
export function expected(personas: readonly Persona[], allowed: readonly Persona[]): Partial<Record<Persona, Verdict>> {
    return Object.fromEntries(personas.map((persona) => [persona, allowed.includes(persona) ? 'allow' : 'deny']));
}
