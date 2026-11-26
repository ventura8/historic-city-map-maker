import type { IncomingHttpHeaders } from 'node:http';

import { FIXTURE_VALUES } from '@hcm/test-support/api-fixtures';
import type { GoogleGrant } from '@hcm/test-support/fakes';
import type { UpstreamPartitions } from '@hcm/test-support/fakes/http';

import { PERSONAS, personaOf } from '../admin/world.js';
import { TEST_HEADER } from '../fixtures/world.js';
import { consentPage, STAND_IN_SCRIPT_PATH, standInScript, type StandInScriptConfig } from './oauth-page.js';
import type { MockResponse } from './router.js';
import type { ControlRequest, MockExtension } from './server.js';

/**
 * Google's OAuth consent, replaced for the admin tier (docs/research/M2b-interfaces.md §2.6): the only part of Google
 * the e2e world stands in for in the browser. Endpoints of the mock APIs (the test's partition is `?test=`, else the
 * `x-hcm-test` header the e2e network layer adds to a page's requests to the mock APIs):
 *
 * - `GET /__oauth/authorize?scope=<space-separated>&login_hint=<address>[&test=<id>]`: the consent page
 *   (oauth-page.ts), recorded as a consent request; the admin's stand-in client (`packages/admin/src/auth/stand-in.ts`)
 *   passes the `test` of its own address, which may be empty;
 * - `POST /__oauth/grant` `{request, test, account, scopes}` (the page's Allow): issues a fresh `ya29.` access token
 *   and registers it as a `GoogleGrant` of the fake identity (the ticked scopes plus the sign-in's own, the fixture
 *   OAuth client, the account's project access) in the test's partition and in the shared partition `''`, which the
 *   Functions emulator reaches until CR-M2b-3; answers `{idToken, accessToken, scope, expiresIn}`, the `idToken` being
 *   the unsigned JSON the Auth emulator accepts for Google;
 * - `POST /__oauth/cancel` `{request, test}` (the page's Cancel, which then posts `{cancelled: true}` to the opener);
 * - `GET /__oauth/requests?test=<id>`: the test's consent requests, oldest first;
 * - `POST /__oauth/reset?test=<id>`: forgets them (an admin test starts with none, also on a reused mock server).
 */

/** What every Google sign-in grants besides the scopes a step asks for. */
export const SIGN_IN_SCOPES: readonly string[] = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

/** An access token's lifetime, as Google states it. */
const EXPIRES_IN_SECONDS = 3599;

/** `ya29.` assembled at run time, so no file holds a string shaped like a Google access token. */
const ACCESS_TOKEN_PREFIX = `${['ya', '29'].join('')}.`;

type ConsentOutcome = 'shown' | 'allowed' | 'cancelled';

/** One consent request as the stand-in saw it. */
export interface ConsentRecord {
    readonly id: string;
    readonly test: string;
    /** The requested scopes beyond the sign-in's own. */
    readonly scopes: readonly string[];
    readonly loginHint: string;
    readonly outcome: ConsentOutcome;
    /** Once allowed: the chosen account and the scopes left ticked. */
    readonly account?: string;
    readonly granted?: readonly string[];
}

/** The message Allow posts to the opener. */
export interface ConsentMessage {
    readonly idToken: string;
    readonly accessToken: string;
    readonly scope: string;
    readonly expiresIn: number;
}

function json(value: unknown, status = 200): MockResponse {
    return { status, type: 'application/json', body: JSON.stringify(value) };
}

function parsed(body: string): Readonly<Record<string, unknown>> {
    try {
        const value = JSON.parse(body) as unknown;
        return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
    } catch {
        return {};
    }
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** The partition of a control request: a non-empty `?test=`, else the `x-hcm-test` header, else the shared `''`. */
function partitionOf(query: URLSearchParams, headers: IncomingHttpHeaders): string {
    const fromQuery = query.get('test') ?? '';
    if (fromQuery !== '') {
        return fromQuery;
    }
    const header = headers[TEST_HEADER];
    return typeof header === 'string' ? header : '';
}

/** The unsigned ID token the Auth emulator accepts for a Google account (`signInWithIdp`). */
function idTokenOf(email: string): string {
    const persona = personaOf(email);
    return JSON.stringify({ sub: persona?.sub ?? `e2e-${email}`, email, email_verified: true, name: persona?.displayName ?? email });
}

class ConsentLog {
    readonly #records: ConsentRecord[] = [];
    /** Ids keep counting after `forget`, so a new request never takes the id of a kept one. */
    #issued = 0;

    open(test: string, scopes: readonly string[], loginHint: string): ConsentRecord {
        this.#issued += 1;
        const record: ConsentRecord = { id: `consent-${String(this.#issued)}`, test, scopes, loginHint, outcome: 'shown' };
        this.#records.push(record);
        return record;
    }

    close(id: string, change: Pick<ConsentRecord, 'outcome' | 'account' | 'granted'>): void {
        const index = this.#records.findIndex((record) => record.id === id);
        const record = this.#records[index];
        if (record !== undefined) {
            this.#records[index] = { ...record, ...change };
        }
    }

    of(test: string): ConsentRecord[] {
        return this.#records.filter((record) => record.test === test);
    }

    /** Forgets a test's requests (a mock server reused across runs would still hold an earlier run's). */
    forget(test: string): void {
        const kept = this.#records.filter((record) => record.test !== test);
        this.#records.splice(0, this.#records.length, ...kept);
    }
}

interface StandIn {
    readonly partitions: UpstreamPartitions;
    readonly log: ConsentLog;
    readonly script: string;
    next: number;
}

function authorize(standIn: StandIn, request: ControlRequest): MockResponse {
    const test = partitionOf(request.query, request.headers);
    const loginHint = request.query.get('login_hint') ?? '';
    const asked = (request.query.get('scope') ?? '').split(/\s+/).filter((scope) => scope !== '');
    const record = standIn.log.open(
        test,
        asked.filter((scope) => !SIGN_IN_SCOPES.includes(scope)),
        loginHint,
    );
    const known = Object.values(PERSONAS).map((persona) => persona.email);
    const accounts = loginHint === '' || known.includes(loginHint) ? known : [...known, loginHint];
    const page = consentPage({
        request: record.id,
        test,
        scopes: record.scopes,
        accounts,
        selected: loginHint === '' ? PERSONAS.owner.email : loginHint,
        redirect: request.query.get('redirect_uri') ?? '',
        state: request.query.get('state') ?? '',
    });
    return { status: 200, type: 'text/html; charset=utf-8', body: page };
}

function grant(standIn: StandIn, request: ControlRequest): MockResponse {
    const body = parsed(request.body);
    const test = text(body['test']);
    const account = text(body['account']);
    const granted = Array.isArray(body['scopes']) ? body['scopes'].map(text).filter((scope) => scope !== '') : [];
    if (account === '') {
        return json({ error: 'choose an account' }, 400);
    }
    standIn.next += 1;
    const accessToken = `${ACCESS_TOKEN_PREFIX}e2e-consent-${String(standIn.next)}-access-token`;
    const scopes = [...SIGN_IN_SCOPES, ...granted];
    const issued: GoogleGrant = {
        email: account,
        audience: String(FIXTURE_VALUES['oauthClientId']),
        scopes,
        expiresInSeconds: EXPIRES_IN_SECONDS,
        access: personaOf(account)?.access ?? 'none',
    };
    for (const partition of new Set([test, ''])) {
        standIn.partitions.get(partition).state.identity.grants.set(accessToken, issued);
    }
    standIn.log.close(text(body['request']), { outcome: 'allowed', account, granted });
    const message: ConsentMessage = { idToken: idTokenOf(account), accessToken, scope: scopes.join(' '), expiresIn: EXPIRES_IN_SECONDS };
    return json(message);
}

function cancel(standIn: StandIn, request: ControlRequest): MockResponse {
    standIn.log.close(text(parsed(request.body)['request']), { outcome: 'cancelled' });
    return json({});
}

type Action = (standIn: StandIn, request: ControlRequest) => MockResponse;

const ACTIONS: Readonly<Record<string, Action>> = {
    'GET /__oauth/authorize': authorize,
    [`GET ${STAND_IN_SCRIPT_PATH}`]: (standIn) => ({ status: 200, type: 'text/javascript; charset=utf-8', body: standIn.script }),
    'POST /__oauth/grant': grant,
    'POST /__oauth/cancel': cancel,
    'GET /__oauth/requests': (standIn, request) => json(standIn.log.of(partitionOf(request.query, request.headers))),
    'POST /__oauth/reset': (standIn, request) => {
        standIn.log.forget(partitionOf(request.query, request.headers));
        return { status: 204 };
    },
};

/** The consent stand-in as an extension of the mock APIs; grants land in the fake upstreams' `partitions`. */
export function createOAuthStandIn(partitions: UpstreamPartitions, config: StandInScriptConfig): MockExtension {
    const standIn: StandIn = { partitions, log: new ConsentLog(), script: standInScript(config), next: 0 };
    return {
        answer: () => Promise.resolve(undefined),
        control: (request) => Promise.resolve(ACTIONS[`${request.method.toUpperCase()} ${request.path}`]?.(standIn, request)),
    };
}
