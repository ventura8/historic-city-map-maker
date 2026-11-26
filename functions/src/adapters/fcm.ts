import type { PushSender, PushTarget } from '../ports/push-sender.js';
import type { TokenProvider } from '../ports/token-provider.js';
import { googleError, googleSend } from './google-call.js';
import { at, list, readJson, stringAt, type Fetch } from './upstream-http.js';

/**
 * Firebase Cloud Messaging HTTP v1 (`docs/research/M4-interfaces.md` §5.4) over REST with the functions' own service
 * account (`roles/firebasecloudmessaging.admin`; no server key): `messages:send` once per device (HTTP v1 has no
 * multicast), the item's title and text as a web push notification and its admin link as `fcm_options.link`. A device
 * is addressed as its record says (finding 50 of 2026-11-01): an FCM registration token as `message.token`, or the
 * browser's Firebase installation ID as `message.fid` (firebase-admin 14's `FidMessage`; what `register` gives, and what
 * every device registered before finding 50 is); the shared schemas keep the field's name `token`
 * (DECISIONS-for-review.md §54, §81). REST
 * rather than firebase-admin's `getMessaging()`, so the Functions emulator reaches the fake FCM through
 * `createEmulatorFetch` like every other Google API and no local run can push to a real browser.
 *
 * A token FCM no longer knows (404, `UNREGISTERED`) is reported, not thrown; a refused credential or role (401, 403)
 * fails the whole send (`UpstreamError('fcm', …)`); any other failure of one token (429, 5xx) skips that token, so one
 * device's trouble never keeps the others' notification back.
 */
type PushMessage = Parameters<PushSender['send']>[1];

const SERVICE = 'fcm';

const FCM_API = 'https://fcm.googleapis.com/v1';

/** What makes a token worthless: FCM's own error codes (`google.firebase.fcm.v1.FcmError`). */
const GONE_CODES = new Set(['UNREGISTERED']);
const INVALID_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT']);
const FATAL_STATUSES = new Set([401, 403]);
const NOT_FOUND = 404;

export interface FcmOptions {
    readonly projectId: string;
    readonly tokens: TokenProvider;
    readonly fetch: Fetch;
}

/** The `errorCode` of the answer's `FcmError` detail, if it has one. */
function fcmErrorCode(body: unknown): string | undefined {
    const detail = list(at(body, 'error', 'details')).find((entry) => stringAt(entry, 'errorCode') !== undefined);
    return stringAt(detail, 'errorCode');
}

/** The web push message of one device (`token` or `fid`, as its kind says). */
export function webPushMessage(target: PushTarget, message: PushMessage) {
    return {
        [target.kind]: target.value,
        webpush: {
            notification: { title: message.title, body: message.body, tag: message.tag },
            fcm_options: { link: message.link },
        },
    };
}

/** FCM's code as the admin may see it: an error code of capitals, else the answer's HTTP status. */
const SHOWN_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

/**
 * A dry run's answer that says the token itself is worthless (unregistered, or no registration token at all): FCM's code
 * (the `FcmError` detail's, else the error's `status`, else `HTTP_<status>`); null for any other failure.
 */
async function tokenRefusal(response: Response): Promise<string | null> {
    const body = await readJson(response);
    const code = fcmErrorCode(body) ?? '';
    if (response.status !== NOT_FOUND && !INVALID_CODES.has(code)) {
        return null;
    }
    return shownCode(code === '' ? stringAt(at(body, 'error'), 'status') : code, response.status);
}

/** The code the admin sees: FCM's own when it reads as one, else `HTTP_<status>`. */
function shownCode(code: string | undefined, status: number): string {
    return code !== undefined && SHOWN_CODE.test(code) ? code : `HTTP_${String(status)}`;
}

/** A send's answer that says FCM no longer knows the token (the browser unsubscribed, or the token expired). */
async function goneToken(response: Response): Promise<boolean> {
    const code = fcmErrorCode(await readJson(response)) ?? '';
    return response.status === NOT_FOUND || GONE_CODES.has(code);
}

type Outcome = 'sent' | 'gone' | 'skipped';

export function createFcm(options: FcmOptions): PushSender {
    const url = `${FCM_API}/projects/${encodeURIComponent(options.projectId)}/messages:send`;
    const post = async (body: unknown): Promise<Response> =>
        googleSend(options.fetch, SERVICE, url, { method: 'POST', accessToken: await options.tokens.accessToken(), body });
    const outcomeOf = async (response: Response): Promise<Outcome> => {
        if (response.ok) {
            return 'sent';
        }
        if (FATAL_STATUSES.has(response.status)) {
            throw await googleError(SERVICE, response);
        }
        return (await goneToken(response)) ? 'gone' : 'skipped';
    };
    return {
        send: async (targets, message) => {
            let sent = 0;
            const unregistered: string[] = [];
            for (const target of targets) {
                const outcome = await outcomeOf(await post({ message: webPushMessage(target, message) }));
                sent += outcome === 'sent' ? 1 : 0;
                if (outcome === 'gone') {
                    unregistered.push(target.value);
                }
            }
            return { sent, unregistered };
        },
        validate: async (target) => {
            const response = await post({ validate_only: true, message: { [target.kind]: target.value } });
            if (response.ok) {
                return { ok: true };
            }
            const reason = await tokenRefusal(response.clone());
            if (reason !== null) {
                return { ok: false, reason };
            }
            throw await googleError(SERVICE, response);
        },
    };
}
