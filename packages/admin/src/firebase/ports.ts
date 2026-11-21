/**
 * What the admin uses of Firebase (`docs/research/M2b-interfaces.md` §1.7): Auth, the callables, Firestore and Storage,
 * behind ports, so the admin logic is tested in Node with fakes. Only the adapters of this folder (`sdk.ts`,
 * `adapters.ts`) and the entry import the Firebase JS SDK. A workstream that needs more of Firebase asks admin-shell
 * for a port method (a change request), never imports the SDK itself.
 */
import type { AdminCallableName, ApiErrorDetails, CallableRequest, CallableResponse } from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';

/** The signed-in Firebase user, as far as the admin needs it. */
export interface AuthUser {
    readonly uid: string;
    readonly email: string | null;
    readonly displayName: string | null;
}

export interface AuthPort {
    currentUser(): AuthUser | null;
    /** Called with the current user (or null) soon after subscribing, then on every sign-in, sign-out or revocation. */
    onUserChanged(listener: (user: AuthUser | null) => void): Unsubscribe;
    /** `getIdToken(true)`: picks up a changed `admin` claim (`refreshToken: true`). */
    refreshIdToken(): Promise<void>;
    signOut(): Promise<void>;
}

export interface CallOptions {
    /** The callable's timeout; the SDK's default (70 s) otherwise. */
    readonly timeoutMs?: number;
}

/**
 * A callable's failure: the SDK's status (`unauthenticated`, `internal`, ...) and the server's error code
 * (`apiErrorFromFailure`: the generic code of the status when the details cannot be read).
 */
export class CallableFailure extends Error {
    readonly status: string;
    readonly details: ApiErrorDetails;

    constructor(status: string, details: ApiErrorDetails) {
        super(`callable failed: ${status} ${details.code}`);
        this.name = 'CallableFailure';
        this.status = status;
        this.details = details;
    }
}

export interface CallablesPort {
    /**
     * Calls `httpsCallable(functions, deployedName(name))` and validates the answer with the registry's response
     * schema. Rejects with a `CallableFailure` (a response that fails its schema is `apiError.internal`).
     */
    call<N extends AdminCallableName>(name: N, request: CallableRequest<N>, options?: CallOptions): Promise<CallableResponse<N>>;
}

/** A Firestore document's fields as the SDK returns them (timestamps are `Timestamp` objects). */
export type DocumentData = Readonly<Record<string, unknown>>;

interface QueriedDocument {
    readonly id: string;
    readonly data: DocumentData;
}

export interface DocumentsPort {
    /** The document at `path` (`cities/bucharest`), or null when it does not exist. */
    get(path: string): Promise<DocumentData | null>;
    /** Every change of the document (null when deleted or missing), or the Firestore code that ended the watch. */
    watch(path: string, onNext: (data: DocumentData | null) => void, onError: (code: string) => void): Unsubscribe;
    /** Writes the whole document (`merge` keeps the fields it does not name). */
    set(path: string, data: DocumentData, options?: { readonly merge?: boolean }): Promise<void>;
    delete(path: string): Promise<void>;
    /** The documents of a collection whose fields equal the given values (`[['legacyId', 'x']]`). */
    query(collectionPath: string, equals: readonly (readonly [string, unknown])[]): Promise<readonly QueriedDocument[]>;
    /** The `serverTimestamp()` sentinel, for the `updatedAt` stamp the rules require. */
    serverTimestamp(): unknown;
}

interface UploadMetadata {
    readonly contentType?: string;
    readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface StoragePort {
    /** Uploads to the default (private) bucket at `path` (`STORAGE_PATHS.photoUpload(...)`). */
    upload(path: string, data: Blob | Uint8Array, metadata: UploadMetadata): Promise<void>;
}

export interface FirebasePorts {
    readonly auth: AuthPort;
    readonly callables: CallablesPort;
    readonly documents: DocumentsPort;
    readonly storage: StoragePort;
}
