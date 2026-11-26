/**
 * Why push did not start on this browser, in a form the admin can act on and a log can be read by (finding 46 of
 * `docs/research/manual-test-2026-10-25.md`: live, "Notifications did not start: This browser could not be registered
 * for notifications" said nothing of which step failed). A failure has a short code: the Firebase SDK's own
 * (`FirebaseError.code`, `messaging/fid-registration-failed`, `messaging/permission-blocked`, `installations/request-failed`
 * `messaging/token-subscribe-failed` …), the registrar's own (`push/worker-registration-failed`), or FCM's answer to the
 * server's dry run (`fcm/INVALID_ARGUMENT`, from `apiError.notify.deviceInvalid`'s `reason`). The page shows the code with one line in
 * the admin's language for the known families; the log gets the code and the SDK's own text with every id, token or key
 * replaced. Never the token, the installation id or the API key.
 */
import type { NoticeInput } from '../state/state.js';

/** A failure of the push registrar with its short code (the SDK's own, or `push/...`). */
export class PushFailure extends Error {
    readonly code: string;
    /** What the SDK said beside its code (`customData.errorInfo`, else its message), redacted. */
    readonly info: string;

    constructor(code: string, info = '') {
        super(code);
        this.name = 'PushFailure';
        this.code = code;
        this.info = redactIds(info);
    }
}

/** The SDKs' codes (`messaging/...`, `installations/...`) and the registrar's own (`push/...`). */
const SDK_CODE = /^(messaging|installations|push)\/[a-z0-9-]{1,60}$/;
/** FCM's error codes (`UNREGISTERED`, `INVALID_ARGUMENT`, `SENDER_ID_MISMATCH`) or `HTTP_404`. */
const FCM_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;
/** What a log keeps of the SDK's text. */
const MAX_INFO = 200;

/** A string field of an unknown value. */
function field(value: unknown, name: string): string {
    const found = typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>)[name] : undefined;
    return typeof found === 'string' ? found : '';
}

/** Every word that looks like an id, a token or a key (letters with digits, 12 or more characters) replaced. */
export function redactIds(text: string): string {
    return text.replace(/[A-Za-z0-9_:.-]{12,}/g, (word) => (/\d/.test(word) ? '[id]' : word)).slice(0, MAX_INFO);
}

/** An error's message, or '' for anything without one. */
export function messageOf(error: unknown): string {
    return field(error, 'message');
}

/** What the SDK said beside its code: a `FirebaseError`'s `customData.errorInfo`, else the error's message. */
function infoOf(error: unknown): string {
    const custom = typeof error === 'object' && error !== null ? (error as { readonly customData?: unknown }).customData : undefined;
    const info = field(custom, 'errorInfo');
    return info === '' ? field(error, 'message') : info;
}

/** The failure of anything the registrar threw: its code when it carries one the page knows how to read, else `push/unknown`. */
export function pushFailureOf(error: unknown): PushFailure {
    if (error instanceof PushFailure) {
        return error;
    }
    const code = field(error, 'code');
    return new PushFailure(SDK_CODE.test(code) ? code : 'push/unknown', infoOf(error));
}

/**
 * FCM refused the registration the browser handed out (`apiError.notify.deviceInvalid`): its code as the server passed it
 * on (`reason`), or `fcm/UNSPECIFIED` from a server that names none; null for any other failure.
 */
export function fcmRefusalOf(failure: NoticeInput): string | null {
    if (failure.key !== 'apiError.notify.deviceInvalid') {
        return null;
    }
    const reason = failure.params?.['reason'] ?? '';
    return `fcm/${FCM_CODE.test(reason) ? reason : 'UNSPECIFIED'}`;
}

type ReasonFamily = 'permission' | 'registration' | 'worker' | 'unsupported' | 'storage' | 'installations' | 'fcmRefused' | 'other';

/** The SDK codes of each family the page explains; anything else is `other`, still with its code. */
const FAMILIES: Readonly<Record<string, ReasonFamily>> = {
    'messaging/permission-blocked': 'permission',
    'messaging/permission-default': 'permission',
    'messaging/fid-registration-failed': 'registration',
    'messaging/token-subscribe-failed': 'registration',
    'messaging/token-subscribe-no-token': 'registration',
    'messaging/token-update-failed': 'registration',
    'messaging/failed-service-worker-registration': 'worker',
    'messaging/invalid-sw-registration': 'worker',
    'push/worker-registration-failed': 'worker',
    'push/no-service-worker': 'worker',
    'messaging/unsupported-browser': 'unsupported',
    'messaging/only-available-in-window': 'unsupported',
    'messaging/fid-registration-idb-schema-unavailable': 'storage',
};

function familyOf(code: string): ReasonFamily {
    if (code.startsWith('fcm/')) {
        return 'fcmRefused';
    }
    return FAMILIES[code] ?? (code.startsWith('installations/') ? 'installations' : 'other');
}

/** The short reason line under "Notifications did not start": what failed, with its code. */
export function pushReason(code: string): NoticeInput {
    return { key: `adminContent.notify.push.reason.${familyOf(code)}`, params: { code } };
}
