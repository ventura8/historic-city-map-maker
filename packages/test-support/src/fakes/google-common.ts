import { FIXTURE_VALUES, fixtureResponse, type FixtureName, type FixtureValues } from '../api-fixtures/index.js';
import type { UpstreamRequest } from './fetch.js';
import type { RouteAnswer } from './routes.js';
import type { FailureMode } from './service.js';

/**
 * What the fake Google APIs share: the projects (an id and a number, either of which a path may name), the bearer-token
 * check every Google REST API makes, and the error envelopes of `google/error.*`.
 */

export interface GoogleProject {
    readonly id: string;
    readonly number: string;
}

/** A 12-digit project number derived from the id (FNV-1a), so every project keeps the same number in every run. */
function derivedNumber(id: string): string {
    let hash = 0x811c9dc5;
    for (const char of id) {
        hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
    }
    return `9${String(hash).padStart(11, '0')}`;
}

/**
 * The projects one set of fakes has seen; `demo-hcm` is number `123456789012` (`FIXTURE_VALUES`), known from the start
 * so a first call that names it by number (Service Usage, IAM's pools) finds the same project as one that names its id.
 */
export class GoogleProjects {
    readonly #byId = new Map<string, GoogleProject>();

    constructor() {
        const id = String(FIXTURE_VALUES['projectId']);
        this.#byId.set(id, { id, number: String(FIXTURE_VALUES['projectNumber']) });
    }

    /** The project a path segment names, by id or by number. */
    resolve(segment: string): GoogleProject {
        const known = this.#byId.get(segment) ?? [...this.#byId.values()].find((project) => project.number === segment);
        if (known !== undefined) {
            return known;
        }
        const project = /^\d+$/.test(segment) ? { id: segment, number: segment } : { id: segment, number: this.#numberOf(segment) };
        this.#byId.set(project.id, project);
        return project;
    }

    #numberOf(id: string): string {
        return id === FIXTURE_VALUES['projectId'] ? String(FIXTURE_VALUES['projectNumber']) : derivedNumber(id);
    }
}

/** A Google API as its errors name it. */
export interface GoogleApi {
    /** `secretmanager.googleapis.com` */
    readonly service: string;
    /** `Secret Manager API` */
    readonly title: string;
    /** A permission a `forbidden` failure names. */
    readonly permission: string;
}

/** A `google/error.*` envelope with the API's names filled in. */
export function googleError(name: FixtureName, api: GoogleApi, values: FixtureValues = {}): Response {
    return fixtureResponse(name, { values: { service: api.service, serviceTitle: api.title, permission: api.permission, ...values } });
}

const FAILURES: Readonly<Partial<Record<FailureMode, FixtureName>>> = {
    unavailable: 'google/error.unavailable',
    rateLimited: 'google/error.rate-limited',
    unauthorized: 'google/error.unauthenticated',
    forbidden: 'google/error.permission-denied',
    apiDisabled: 'google/error.service-disabled',
};

/** The answer of a Google API in failure `mode` (none for USGS's `maintenance`). */
export function googleFailure(api: GoogleApi, mode: FailureMode): Response | undefined {
    const name = FAILURES[mode];
    return name === undefined ? undefined : googleError(name, api);
}

/** The bearer token of a request, or undefined. */
export function bearerToken(request: UpstreamRequest): string | undefined {
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
    return match === null ? undefined : String(match[1]);
}

/** Wraps a Google route: a request without a bearer token gets the API's 401, as every Google REST API answers. */
export function authenticated(api: GoogleApi, answer: RouteAnswer): RouteAnswer {
    return (request, params) =>
        bearerToken(request) === undefined ? googleError('google/error.unauthenticated', api) : answer(request, params);
}
