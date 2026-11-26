/**
 * The Firebase ports (`ports.ts`) over the SDK table (`sdk.ts`) and the app's handles (`app.ts`): Auth, the callables
 * (validated with the registry's response schemas), Firestore, Storage, and the two ways the admin signs in with Google
 * (Firebase's popup in production, the e2e stand-in's credential). Tested in Node with a fake table.
 */
import {
    ADMIN_CALLABLES,
    apiErrorFromFailure,
    deployedName,
    type AdminCallableName,
    type CallableRequest,
    type CallableResponse,
} from '@hcm/shared';
import type { User } from 'firebase/auth';

import type { PopupSignIn } from '../auth/google-auth.js';
import type { FirebaseHandles } from './app.js';
import {
    CallableFailure,
    type AuthPort,
    type AuthUser,
    type CallablesPort,
    type DocumentsPort,
    type FirebasePorts,
    type StoragePort,
} from './ports.js';
import type { FirebaseSdk } from './sdk.js';

function userOf(user: Pick<User, 'uid' | 'email' | 'displayName'> | null): AuthUser | null {
    return user === null ? null : { uid: user.uid, email: user.email, displayName: user.displayName };
}

export function authPort(sdk: FirebaseSdk, handles: Pick<FirebaseHandles, 'auth'>): AuthPort {
    const { auth } = handles;
    return {
        currentUser: () => userOf(auth.currentUser),
        onUserChanged: (listener) =>
            sdk.onAuthStateChanged(auth, (user) => {
                listener(userOf(user));
            }),
        refreshIdToken: async () => {
            await auth.currentUser?.getIdToken(true);
        },
        signOut: () => sdk.signOut(auth),
    };
}

/** The SDK's `FunctionsError` as a `CallableFailure` (`functions/<status>`, the server's details). */
export function callableFailureOf(error: unknown): CallableFailure {
    const { code, details } = (error ?? {}) as { readonly code?: unknown; readonly details?: unknown };
    const status = typeof code === 'string' ? code.replace(/^functions\//, '') : 'internal';
    return new CallableFailure(status, apiErrorFromFailure(code, details));
}

export function callablesPort(sdk: FirebaseSdk, handles: Pick<FirebaseHandles, 'functions'>): CallablesPort {
    return {
        call: async <N extends AdminCallableName>(name: N, request: CallableRequest<N>, options: { readonly timeoutMs?: number } = {}) => {
            const timeout = options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs };
            const callable = sdk.httpsCallable(handles.functions, deployedName(name), timeout);
            let data: unknown;
            try {
                data = (await callable(request)).data;
            } catch (error) {
                throw callableFailureOf(error);
            }
            const parsed = ADMIN_CALLABLES[name].response.safeParse(data);
            if (!parsed.success) {
                // An answer, in a shape older than this admin reads (finding 27 of 2026-10-31): a server is there, and
                // it is outdated, not down.
                throw new CallableFailure('failed-precondition', { code: 'apiError.serverOutdated' });
            }
            return parsed.data as CallableResponse<N>;
        },
    };
}

export function documentsPort(sdk: FirebaseSdk, handles: Pick<FirebaseHandles, 'firestore'>): DocumentsPort {
    const at = (path: string): ReturnType<FirebaseSdk['doc']> => sdk.doc(handles.firestore(), path);
    return {
        get: async (path) => {
            const snapshot = await sdk.getDoc(at(path));
            return snapshot.exists() ? snapshot.data() : null;
        },
        watch: (path, onNext, onError) =>
            sdk.onSnapshot(
                at(path),
                (snapshot) => {
                    onNext(snapshot.exists() ? snapshot.data() : null);
                },
                (error) => {
                    onError(error.code);
                },
            ),
        set: (path, data, options = {}) => sdk.setDoc(at(path), data, { merge: options.merge === true }),
        delete: (path) => sdk.deleteDoc(at(path)),
        query: async (collectionPath, equals) => {
            const filters = equals.map(([field, value]) => sdk.where(field, '==', value));
            const snapshot = await sdk.getDocs(sdk.query(sdk.collection(handles.firestore(), collectionPath), ...filters));
            return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
        },
        serverTimestamp: () => sdk.serverTimestamp(),
    };
}

export function storagePort(sdk: FirebaseSdk, handles: Pick<FirebaseHandles, 'storage'>): StoragePort {
    return {
        upload: async (path, data, metadata) => {
            const custom = metadata.customMetadata === undefined ? {} : { customMetadata: { ...metadata.customMetadata } };
            const type = metadata.contentType === undefined ? {} : { contentType: metadata.contentType };
            await sdk.uploadBytes(sdk.ref(handles.storage(), path), data, { ...type, ...custom });
        },
    };
}

export function firebasePorts(sdk: FirebaseSdk, handles: FirebaseHandles): FirebasePorts {
    return {
        auth: authPort(sdk, handles),
        callables: callablesPort(sdk, handles),
        documents: documentsPort(sdk, handles),
        storage: storagePort(sdk, handles),
    };
}

/**
 * Google's popup through Firebase Auth (`docs/research/M2b-interfaces.md` §2.2): the scope added, Google's custom
 * parameters set; `signInWithPopup` when nobody is signed in, else `reauthenticateWithPopup` (a different account is
 * refused with `auth/user-mismatch`). Firebase never persists the OAuth access token. The popup's resolver is given
 * here, not to `initializeAuth` (`app.ts`): Node's build of `firebase/auth`, which the entry's tests load, has none.
 */
export function firebasePopup(sdk: FirebaseSdk, handles: Pick<FirebaseHandles, 'auth'>): PopupSignIn {
    return async (scopeUrl, parameters) => {
        const provider = new sdk.GoogleAuthProvider();
        if (scopeUrl !== null) {
            provider.addScope(scopeUrl);
        }
        provider.setCustomParameters({ ...parameters });
        const user = handles.auth.currentUser;
        const result =
            user === null
                ? await sdk.signInWithPopup(handles.auth, provider, sdk.browserPopupRedirectResolver)
                : await sdk.reauthenticateWithPopup(user, provider, sdk.browserPopupRedirectResolver);
        return { accessToken: sdk.GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? null, email: result.user.email };
    };
}

/** The e2e stand-in's sign-in: Google's credential of the stand-in's two tokens (the Auth emulator accepts it). */
export function credentialSignIn(
    sdk: FirebaseSdk,
    handles: Pick<FirebaseHandles, 'auth'>,
): (idToken: string, accessToken: string) => Promise<{ readonly email: string | null }> {
    return async (idToken, accessToken) => {
        const credential = sdk.GoogleAuthProvider.credential(idToken, accessToken);
        const user = handles.auth.currentUser;
        const result =
            user === null
                ? await sdk.signInWithCredential(handles.auth, credential)
                : await sdk.reauthenticateWithCredential(user, credential);
        return { email: result.user.email };
    };
}
