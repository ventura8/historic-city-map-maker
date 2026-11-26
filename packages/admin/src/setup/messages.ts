/**
 * What a Setup Assistant card says, and how a failure becomes that message: a key of one of the three catalogues the
 * admin shows (`adminSetup.*`, `adminShell.*`, `apiError.*`, `docs/research/M2b-interfaces.md` §1.6) with its
 * `{placeholder}` values. The elements translate it; the machine never holds a sentence.
 */
import {
    API_ERRORS,
    apiErrorFromFailure,
    isApiErrorCode,
    type AdminSetupKey,
    type AdminShellKey,
    type ApiErrorCode,
    type ServiceState,
} from '@hcm/shared';

import type { GoogleScope } from '../google/scopes.js';

export type SetupMessageKey = AdminSetupKey | AdminShellKey | ApiErrorCode;

/** Placeholder values; a `scope` value is a `GoogleScope` name, which the elements show by its Google label. */
export type MessageParams = Readonly<Record<string, string>>;

export interface SetupMessage {
    readonly key: SetupMessageKey;
    readonly params?: MessageParams;
}

/** How a failed check or action leaves its card. */
export interface StepFailure {
    readonly state: ServiceState;
    readonly message: SetupMessage;
    /** The Google token stopped working (a 401): the card offers Continue (§1.5). */
    readonly expired: boolean;
}

export function setupMessage(key: SetupMessageKey, params?: MessageParams): SetupMessage {
    return params === undefined ? { key } : { key, params };
}

function property(error: unknown, name: string): unknown {
    return typeof error === 'object' && error !== null ? (error as Readonly<Record<string, unknown>>)[name] : undefined;
}

function text(error: unknown, name: string): string | undefined {
    const value = property(error, name);
    return typeof value === 'string' ? value : undefined;
}

function failed(state: ServiceState, key: SetupMessageKey, params?: MessageParams): StepFailure {
    return { state, message: setupMessage(key, params), expired: false };
}

function forbidden(error: unknown): StepFailure {
    const api = text(error, 'api');
    return api === undefined
        ? failed('invalid', 'apiError.cloud.permission', { role: text(error, 'role') ?? 'roles/owner' })
        : failed('invalid', 'apiError.cloud.apiDisabled', { api });
}

/** No answer at all names the host the request could not leave the browser for (finding 48); a 5xx is Google's. */
function unavailable(error: unknown): StepFailure {
    const host = text(error, 'host');
    return host === undefined
        ? failed('unavailable', 'apiError.unavailable')
        : failed('unavailable', 'adminShell.network.blocked', { host });
}

const GOOGLE_FAILURES = new Map<string, (error: unknown) => StepFailure>([
    ['unauthorized', () => ({ state: 'unavailable', message: setupMessage('adminShell.session.googleExpired'), expired: true })],
    ['forbidden', forbidden],
    ['notFound', () => failed('invalid', 'apiError.notFound')],
    ['conflict', () => failed('unavailable', 'apiError.conflict')],
    ['rateLimited', () => failed('unavailable', 'apiError.rateLimited')],
    ['unavailable', unavailable],
    ['invalid', () => failed('invalid', 'adminSetup.error.googleRefused')],
    ['orgPolicy', (error) => failed('invalid', 'adminSetup.provision.orgPolicy', { constraint: text(error, 'constraint') ?? '' })],
]);

/** A `GoogleFailure` of google-clients (anything else, a network error included, is "unavailable, try again"). */
export function googleFailure(error: unknown): StepFailure {
    const map = GOOGLE_FAILURES.get(text(error, 'kind') ?? '');
    return map === undefined ? failed('unavailable', 'apiError.unavailable') : map(error);
}

/** A callable's failure (`FunctionsError`): its code, `unavailable` when the same call may work later. */
export function apiFailure(error: unknown): StepFailure {
    const details = apiErrorFromFailure(property(error, 'code'), property(error, 'details'));
    return failed(API_ERRORS[details.code].retryable ? 'unavailable' : 'invalid', details.code, details.params);
}

const CONSENT_FAILURES = new Map<string, SetupMessageKey>([
    ['auth/popup-blocked', 'adminShell.oauth.popupBlocked'],
    ['auth/popup-closed-by-user', 'adminShell.oauth.popupClosed'],
    ['auth/cancelled-popup-request', 'adminShell.oauth.popupClosed'],
    ['auth/user-mismatch', 'adminShell.oauth.wrongAccount'],
    ['hcm/wrong-account', 'adminShell.oauth.wrongAccount'],
    ['auth/network-request-failed', 'apiError.unavailable'],
]);

/** Google's consent for `scope` was not granted (§2.5): the step stays as it was. */
export function scopeDenied(scope: GoogleScope): SetupMessage {
    return setupMessage('adminShell.oauth.scopeDenied', { scope });
}

/** Why Google's popup gave no token (§2.5). */
export function consentFailure(error: unknown, scope: GoogleScope): SetupMessage {
    const code = text(error, 'code') ?? '';
    return code === 'hcm/scope-denied' ? scopeDenied(scope) : setupMessage(CONSENT_FAILURES.get(code) ?? 'apiError.internal');
}

/** The admin keys a bootstrap step may record (`sessionStorage` is read back through {@link isSetupMessageKey}). */
const RECORDABLE_KEYS: ReadonlySet<string> = new Set<SetupMessageKey>([
    'adminShell.session.googleExpired',
    'adminShell.oauth.popupBlocked',
    'adminShell.oauth.popupClosed',
    'adminShell.oauth.scopeDenied',
    'adminShell.oauth.wrongAccount',
    'adminSetup.error.googleRefused',
    'adminSetup.cloud.permission',
    'adminSetup.billing.noAccount',
    'adminSetup.billing.waitTimeout',
    'adminSetup.billing.chooseAccount',
    'adminSetup.billing.quota',
    'adminSetup.provision.afterDeploy',
    'adminSetup.provision.orgPolicy',
    'adminSetup.provision.waiting',
    'adminSetup.provision.wrongProject',
    'adminSetup.deploy.progress',
    'adminSetup.deploy.failed',
    'adminSetup.deploy.unreachable',
    'adminSetup.deploy.timeout',
    'adminSetup.deploy.notStarted',
]);

/** True for an `apiError.*` code or an admin key a bootstrap step records. */
export function isSetupMessageKey(value: unknown): value is SetupMessageKey {
    return isApiErrorCode(value) || (typeof value === 'string' && RECORDABLE_KEYS.has(value));
}
