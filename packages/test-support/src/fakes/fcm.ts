import { fixtureResponse } from '../api-fixtures/index.js';
import { authenticated, googleFailure, type GoogleApi } from './google-common.js';
import { requestObject, route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * Firebase Cloud Messaging HTTP v1 (`docs/research/M4-interfaces.md` §5.4, §8), which only the server calls (the
 * fan-out's pushes, `notify.registerDevice`'s dry run, `notify.sendTest`): `messages:send` accepts a message whose
 * target is a well-formed registration token (`token`) or installation id (`fid`; finding 50 of 2026-11-01: the device's
 * kind says which) and records it with its kind (a `validate_only` dry run is answered and not recorded); one in
 * `unregistered` answers 404 `UNREGISTERED`, as FCM does for a browser that unsubscribed; one in `invalid`, or a message
 * without a well-formed target, answers 400 `INVALID_ARGUMENT`. The scenario `fcm.tokensGone` marks every token seen so far
 * unregistered; `fcm.everyTokenGone` answers `UNREGISTERED` for every token from then on, new ones included (finding 46 of
 * 2026-11-01); `fcm.tokensInvalid` and `fcm.everyTokenInvalid` do the same with `INVALID_ARGUMENT` (a registration the
 * server refuses, since it records one whose dry run says `UNREGISTERED`: finding 50);
 * `fail('fcm', 'unavailable' | 'rateLimited' | 'forbidden' | 'apiDisabled')` answers Google's error envelopes.
 * No browser ever reaches it (the e2e firewall refuses `fcm.googleapis.com` from a page).
 */

export interface PushedMessage {
    readonly token: string;
    /** The message's target field: `token` or `fid` (finding 50). */
    readonly kind: 'token' | 'fid';
    /** `webpush.notification` as sent: the title, the text and the tag. */
    readonly notification: Readonly<Record<string, unknown>>;
    /** `webpush.fcm_options.link`: the admin page the notification opens. */
    readonly link: string | null;
}

export interface FcmState {
    readonly messages: PushedMessage[];
    /** Tokens FCM no longer knows. */
    readonly unregistered: Set<string>;
    /** Every token a send or a dry run named. */
    readonly seen: Set<string>;
    /** Every token is unregistered, new ones included (`fcm.everyTokenGone`). */
    everyTokenGone: boolean;
    /** Tokens FCM refuses as invalid (`fcm.tokensInvalid`), or every one (`fcm.everyTokenInvalid`). */
    readonly invalid: Set<string>;
    everyTokenInvalid: boolean;
}

export function defaultFcmState(): FcmState {
    return { messages: [], unregistered: new Set(), seen: new Set(), everyTokenGone: false, invalid: new Set(), everyTokenInvalid: false };
}

const API: GoogleApi = {
    service: 'fcm.googleapis.com',
    title: 'Firebase Cloud Messaging API',
    permission: 'cloudmessaging.messages.create',
};

/** What the fake takes as an installation id (the shared device schema's characters, at least 20 of them). */
const TOKEN = /^[A-Za-z0-9_:.-]{20,4096}$/;

function record(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
}

/** The message's target: its `token`, else its `fid` (finding 50), with the field it came from. */
function targetOf(message: Readonly<Record<string, unknown>>): { readonly token: string; readonly kind: PushedMessage['kind'] } {
    const token = message['token'];
    if (typeof token === 'string') {
        return { token, kind: 'token' };
    }
    return { token: typeof message['fid'] === 'string' ? message['fid'] : '', kind: 'fid' };
}

function pushedOf(message: Readonly<Record<string, unknown>>): PushedMessage {
    const webpush = record(message['webpush']);
    const link = record(webpush['fcm_options'])['link'];
    return { ...targetOf(message), notification: record(webpush['notification']), link: typeof link === 'string' ? link : null };
}

/** FCM refuses the token as no registration at all: malformed, or made invalid by a scenario. */
function invalid(state: FcmState, token: string): boolean {
    return !TOKEN.test(token) || state.everyTokenInvalid || state.invalid.has(token);
}

/** FCM no longer knows the token: it was unregistered, or every token is (`fcm.everyTokenGone`). */
function gone(state: FcmState, token: string): boolean {
    return state.everyTokenGone || state.unregistered.has(token);
}

export function createFcmFake(state: FcmState): ServiceFake {
    return {
        name: 'fcm',
        routes: [
            route(
                'POST',
                'https://fcm.googleapis.com/v1/projects/{project}/messages:send',
                'fcm.send',
                authenticated(API, (request) => {
                    const body = requestObject(request);
                    const message = record(body['message']);
                    const { token } = targetOf(message);
                    state.seen.add(token);
                    if (invalid(state, token)) {
                        return fixtureResponse('fcm/send.invalid-token');
                    }
                    if (gone(state, token)) {
                        return fixtureResponse('fcm/send.unregistered');
                    }
                    if (body['validate_only'] !== true) {
                        state.messages.push(pushedOf(message));
                    }
                    return fixtureResponse('fcm/send.ok');
                }),
            ),
        ],
        failure: (mode) => googleFailure(API, mode),
        scenarios: {
            tokensGone: () => {
                state.seen.forEach((token) => state.unregistered.add(token));
            },
            everyTokenGone: () => {
                state.everyTokenGone = true;
            },
            tokensInvalid: () => {
                state.seen.forEach((token) => state.invalid.add(token));
            },
            everyTokenInvalid: () => {
                state.everyTokenInvalid = true;
            },
        },
        snapshot: () => ({ messages: state.messages, unregistered: [...state.unregistered].sort((a, b) => a.localeCompare(b)) }),
    };
}
