import { describe, expect, it, vi } from 'vitest';

import {
    authPort,
    callableFailureOf,
    callablesPort,
    credentialSignIn,
    documentsPort,
    firebasePopup,
    firebasePorts,
    storagePort,
} from '../../src/firebase/adapters.js';
import type { FirebaseHandles } from '../../src/firebase/app.js';
import { CallableFailure } from '../../src/firebase/ports.js';
import type { FirebaseSdk } from '../../src/firebase/sdk.js';
import { SESSION } from '../app/fakes.js';

const USER = { uid: 'owner-uid', email: 'owner@e2e.test', displayName: 'Owner', getIdToken: vi.fn(() => Promise.resolve('id-token')) };

interface FakeAuthHandle {
    currentUser: typeof USER | null;
}

function snapshot(data: Record<string, unknown> | null) {
    return { exists: () => data !== null, data: () => data };
}

/** A fake SDK table: only what each test needs, recorded. */
function world() {
    const auth: FakeAuthHandle = { currentUser: null };
    const answers = new Map<string, (data: unknown) => Promise<{ data: unknown }>>();
    const sdk = {
        onAuthStateChanged: vi.fn((_auth: unknown, next: (user: typeof USER | null) => void) => {
            next(auth.currentUser);
            return () => undefined;
        }),
        signOut: vi.fn(() => Promise.resolve()),
        httpsCallable: vi.fn((...args: [unknown, string, unknown]) => {
            const name = args[1];
            return (data: unknown) => answers.get(name)?.(data) ?? Promise.reject(new Error('unknown callable'));
        }),
        doc: vi.fn((_firestore: unknown, path: string) => ({ path })),
        getDoc: vi.fn((ref: { path: string }) => Promise.resolve(snapshot(ref.path === 'cities/bucharest' ? { published: true } : null))),
        onSnapshot: vi.fn(
            (_ref: unknown, next: (value: ReturnType<typeof snapshot>) => void, error: (failure: { code: string }) => void) => {
                next(snapshot({ a: 1 }));
                next(snapshot(null));
                error({ code: 'permission-denied' });
                return () => undefined;
            },
        ),
        setDoc: vi.fn(() => Promise.resolve()),
        deleteDoc: vi.fn(() => Promise.resolve()),
        collection: vi.fn((_firestore: unknown, path: string) => ({ collection: path })),
        where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
        query: vi.fn((...parts: unknown[]) => parts),
        getDocs: vi.fn(() => Promise.resolve({ docs: [{ id: 'p1', data: () => ({ legacyId: 'x' }) }] })),
        serverTimestamp: vi.fn(() => 'SERVER_TIME'),
        ref: vi.fn((_storage: unknown, path: string) => ({ path })),
        uploadBytes: vi.fn(() => Promise.resolve({})),
        GoogleAuthProvider: Object.assign(
            class {
                readonly scopes: string[] = [];
                parameters: Record<string, string> = {};

                addScope(scope: string): void {
                    this.scopes.push(scope);
                }

                setCustomParameters(parameters: Record<string, string>): void {
                    this.parameters = parameters;
                }
            },
            {
                credentialFromResult: vi.fn((result: { readonly token?: string }) =>
                    result.token === undefined ? null : { accessToken: result.token },
                ),
                credential: vi.fn((idToken: string, accessToken: string) => ({ idToken, accessToken })),
            },
        ),
        browserPopupRedirectResolver: 'popup-resolver',
        signInWithPopup: vi.fn(() => Promise.resolve({ user: USER, token: 'ya29.e2e-owner-access-token' })),
        reauthenticateWithPopup: vi.fn(() => Promise.resolve({ user: USER })),
        signInWithCredential: vi.fn(() => Promise.resolve({ user: USER })),
        reauthenticateWithCredential: vi.fn(() => Promise.resolve({ user: { ...USER, email: null } })),
    };
    const handles = {
        app: {},
        auth,
        functions: { functions: true },
        firestore: () => ({ firestore: true }),
        storage: () => ({ storage: true }),
    } as unknown as FirebaseHandles;
    return { sdk, typed: sdk as unknown as FirebaseSdk, handles, auth, answers };
}

describe('authPort', () => {
    it('happyPath_followsTheUserRefreshesAndSignsOut', async () => {
        const w = world();
        const port = authPort(w.typed, w.handles);
        const seen: unknown[] = [];

        port.onUserChanged((user) => {
            seen.push(user);
        });
        w.auth.currentUser = USER;
        await port.refreshIdToken();
        await port.signOut();

        expect(seen).toEqual([null]);
        expect(port.currentUser()).toEqual({ uid: 'owner-uid', email: 'owner@e2e.test', displayName: 'Owner' });
        expect(USER.getIdToken).toHaveBeenCalledWith(true);
        expect(w.sdk.signOut).toHaveBeenCalledTimes(1);
    });

    it('badPath_refreshingWithoutAUserDoesNothing', async () => {
        const w = world();

        await expect(authPort(w.typed, w.handles).refreshIdToken()).resolves.toBeUndefined();
    });
});

describe('callablesPort', () => {
    it('happyPath_callsTheDeployedNameAndValidatesTheAnswer', async () => {
        const w = world();
        w.answers.set('admin-session', () => Promise.resolve({ data: SESSION.owner }));

        await expect(callablesPort(w.typed, w.handles).call('admin.session', {}, { timeoutMs: 10_000 })).resolves.toEqual(SESSION.owner);
        await callablesPort(w.typed, w.handles).call('admin.session', {});

        expect(w.sdk.httpsCallable.mock.calls.map(([, name, options]) => [name, options])).toEqual([
            ['admin-session', { timeout: 10_000 }],
            ['admin-session', {}],
        ]);
    });

    it('badPath_anAnswerThatFailsItsSchemaIsAnOutdatedServerNotAnOutage', async () => {
        // Finding 27 of 2026-10-31: a server answered, in a shape older than the admin reads.
        const w = world();
        w.answers.set('admin-session', () => Promise.resolve({ data: { admin: 'yes' } }));

        await expect(callablesPort(w.typed, w.handles).call('admin.session', {})).rejects.toMatchObject({
            status: 'failed-precondition',
            details: { code: 'apiError.serverOutdated' },
        });
    });

    it('badPath_theServersErrorCodeTravelsWithItsStatus', async () => {
        const w = world();
        w.answers.set('admin-claim', () =>
            Promise.reject(
                Object.assign(new Error('x'), {
                    code: 'functions/permission-denied',
                    details: { code: 'apiError.claim.notOwner', params: { projectId: 'demo-hcm' } },
                }),
            ),
        );

        const call = callablesPort(w.typed, w.handles).call('admin.claim', { googleAccessToken: 'ya29.e2e-owner-access-token' });

        await expect(call).rejects.toBeInstanceOf(CallableFailure);
        await expect(call).rejects.toMatchObject({
            status: 'permission-denied',
            details: { code: 'apiError.claim.notOwner', params: { projectId: 'demo-hcm' } },
        });
    });
});

describe('callableFailureOf', () => {
    it('badPath_aFailureWithoutACodeIsInternal', () => {
        expect(callableFailureOf(null)).toMatchObject({ status: 'internal', details: { code: 'apiError.internal' } });
        expect(callableFailureOf({ code: 'functions/unavailable' })).toMatchObject({
            status: 'unavailable',
            details: { code: 'apiError.unavailable' },
        });
    });
});

describe('documentsPort and storagePort', () => {
    it('happyPath_readsWatchesWritesQueriesAndDeletes', async () => {
        const w = world();
        const documents = documentsPort(w.typed, w.handles);
        const watched: unknown[] = [];
        const errors: string[] = [];

        await expect(documents.get('cities/bucharest')).resolves.toEqual({ published: true });
        await expect(documents.get('cities/nowhere')).resolves.toBeNull();
        documents.watch(
            'cities/bucharest',
            (data) => watched.push(data),
            (code) => errors.push(code),
        );
        await documents.set('cities/bucharest/photos/p1', { title: 'x' });
        await documents.set('cities/bucharest', { published: false }, { merge: true });
        await documents.delete('cities/bucharest/photos/p1');
        await expect(documents.query('cities/bucharest/photos', [['legacyId', 'x']])).resolves.toEqual([
            { id: 'p1', data: { legacyId: 'x' } },
        ]);

        expect(watched).toEqual([{ a: 1 }, null]);
        expect(errors).toEqual(['permission-denied']);
        expect(w.sdk.setDoc.mock.calls.map((call) => (call as unknown[])[2])).toEqual([{ merge: false }, { merge: true }]);
        expect(w.sdk.where).toHaveBeenCalledWith('legacyId', '==', 'x');
        expect(documents.serverTimestamp()).toBe('SERVER_TIME');
    });

    it('happyPath_uploadsWithTheMetadataGiven', async () => {
        const w = world();
        const storage = storagePort(w.typed, w.handles);

        await storage.upload('uploads/photos/bucharest/u/p/n.jpg', new Uint8Array([1]), {
            contentType: 'image/jpeg',
            customMetadata: { originalName: 'a.jpg' },
        });
        await storage.upload('uploads/photos/bucharest/u/p/m.jpg', new Uint8Array([2]), {});

        expect(w.sdk.uploadBytes.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
            { contentType: 'image/jpeg', customMetadata: { originalName: 'a.jpg' } },
            {},
        ]);
    });

    it('happyPath_firebasePortsBundlesTheFour', () => {
        const w = world();

        expect(Object.keys(firebasePorts(w.typed, w.handles))).toEqual(['auth', 'callables', 'documents', 'storage']);
    });
});

describe('firebasePopup and credentialSignIn', () => {
    it('happyPath_theFirstSignInUsesThePopupWithTheScopeAndParameters', async () => {
        const w = world();

        const result = await firebasePopup(w.typed, w.handles)('https://www.googleapis.com/auth/cloud-billing', {
            include_granted_scopes: 'true',
        });

        const provider = w.sdk.signInWithPopup.mock.calls[0] as unknown as [unknown, { scopes: string[]; parameters: unknown }, unknown];
        // The popup's resolver goes with the call: the admin's Auth is created without one (session persistence, M6).
        expect(provider[2]).toBe('popup-resolver');
        expect(provider[1].scopes).toEqual(['https://www.googleapis.com/auth/cloud-billing']);
        expect(provider[1].parameters).toEqual({ include_granted_scopes: 'true' });
        expect(result).toEqual({ accessToken: 'ya29.e2e-owner-access-token', email: 'owner@e2e.test' });
    });

    it('happyPath_aSignedInUserReauthenticatesAndNoScopeAddsNone', async () => {
        const w = world();
        w.auth.currentUser = USER;

        const result = await firebasePopup(w.typed, w.handles)(null, {});

        expect(w.sdk.reauthenticateWithPopup).toHaveBeenCalledWith(USER, expect.anything(), 'popup-resolver');
        expect(result).toEqual({ accessToken: null, email: 'owner@e2e.test' });
    });

    it('happyPath_theStandInsCredentialSignsInOrReauthenticates', async () => {
        const w = world();
        const signIn = credentialSignIn(w.typed, w.handles);

        await expect(signIn('{"sub":"owner"}', 'ya29.e2e-owner-access-token')).resolves.toEqual({ email: 'owner@e2e.test' });
        w.auth.currentUser = USER;
        await expect(signIn('{"sub":"owner"}', 'ya29.e2e-owner-access-token')).resolves.toEqual({ email: null });
        expect(w.sdk.GoogleAuthProvider.credential).toHaveBeenCalledWith('{"sub":"owner"}', 'ya29.e2e-owner-access-token');
    });
});
