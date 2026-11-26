import { fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { applyMask, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * reCAPTCHA Enterprise keys and Firebase App Check's reCAPTCHA Enterprise provider, for the `app-check` doctor item
 * (`docs/research/M2b-interfaces.md` §3.4 item 11): the admin's score-based web key, and the web app's App Check
 * configuration naming it. A fresh project has neither.
 */

export interface AppCheckState {
    /** Project id → its keys (the API's shape). */
    readonly keys: Map<string, Readonly<Record<string, unknown>>[]>;
    /** `<project number>/<app id>` → the provider configuration as last written. */
    readonly configs: Map<string, Readonly<Record<string, unknown>>>;
}

const RECAPTCHA: GoogleApi = {
    service: 'recaptchaenterprise.googleapis.com',
    title: 'reCAPTCHA Enterprise API',
    permission: 'recaptchaenterprise.keys.create',
};
const APP_CHECK: GoogleApi = {
    service: 'firebaseappcheck.googleapis.com',
    title: 'Firebase App Check API',
    permission: 'firebaseappcheck.services.update',
};

/** The fake reCAPTCHA Enterprise key API. */
export function createRecaptchaFake(state: AppCheckState, projects: GoogleProjects): ServiceFake {
    const nextKey = sequence('6Le2e0000000000000000000000000000000k', 3);
    const keysOf = (params: RouteParams): Readonly<Record<string, unknown>>[] => {
        const id = projects.resolve(String(params['project'])).id;
        const keys = state.keys.get(id) ?? [];
        state.keys.set(id, keys);
        return keys;
    };
    const create: Route['answer'] = (request, params) => {
        const project = projects.resolve(String(params['project']));
        const key = {
            ...(fixtureBody('recaptcha-enterprise/key.get', {
                projectNumber: project.number,
                projectId: project.id,
                siteKey: nextKey(),
            }) as Record<string, unknown>),
            ...requestObject(request),
        };
        keysOf(params).push(key);
        return jsonResponse(key);
    };
    const patch: Route['answer'] = (request, params) => {
        const keys = keysOf(params);
        const index = keys.findIndex((key) => String(key['name']).endsWith(`/keys/${String(params['key'])}`));
        const key = keys[index];
        if (key === undefined) {
            return googleError('google/error.not-found', RECAPTCHA);
        }
        keys[index] = applyMask(key, requestObject(request), request.url.searchParams.get('updateMask'));
        return jsonResponse(keys[index]);
    };
    const base = 'https://recaptchaenterprise.googleapis.com/v1/projects/{project}/keys';
    return {
        name: 'recaptcha-enterprise',
        routes: [
            route(
                'GET',
                base,
                'recaptcha-enterprise.keys.list',
                authenticated(RECAPTCHA, (_request, params) => jsonResponse({ keys: keysOf(params) })),
            ),
            route('POST', base, 'recaptcha-enterprise.keys.create', authenticated(RECAPTCHA, create)),
            route('PATCH', `${base}/{key}`, 'recaptcha-enterprise.keys.patch', authenticated(RECAPTCHA, patch)),
        ],
        failure: (mode) => googleFailure(RECAPTCHA, mode),
        scenarios: {},
        snapshot: () => ({ keys: Object.fromEntries(state.keys) }),
    };
}

/** The fake App Check provider configuration (unset until written: no `siteKey`). */
export function createAppCheckFake(state: AppCheckState, projects: GoogleProjects): ServiceFake {
    const keyOf = (params: RouteParams): string => `${projects.resolve(String(params['project'])).number}/${String(params['app'])}`;
    const current = (params: RouteParams): Readonly<Record<string, unknown>> => {
        const configured = fixtureBody('app-check/recaptcha-enterprise-config.get', {
            projectNumber: projects.resolve(String(params['project'])).number,
            appId: String(params['app']),
        }) as Record<string, unknown>;
        const unset = Object.fromEntries(Object.entries(configured).filter(([key]) => key !== 'siteKey'));
        return state.configs.get(keyOf(params)) ?? unset;
    };
    const patch: Route['answer'] = (request, params) => {
        const updated = applyMask(current(params), requestObject(request), request.url.searchParams.get('updateMask'));
        state.configs.set(keyOf(params), updated);
        return jsonResponse(updated);
    };
    const url = 'https://firebaseappcheck.googleapis.com/v1/projects/{project}/apps/{app}/recaptchaEnterpriseConfig';
    return {
        name: 'app-check',
        routes: [
            route(
                'GET',
                url,
                'app-check.recaptchaEnterpriseConfig.get',
                authenticated(APP_CHECK, (_request, params) => jsonResponse(current(params))),
            ),
            route('PATCH', url, 'app-check.recaptchaEnterpriseConfig.patch', authenticated(APP_CHECK, patch)),
        ],
        failure: (mode) => googleFailure(APP_CHECK, mode),
        scenarios: {},
        snapshot: () => ({ configs: Object.fromEntries(state.configs) }),
    };
}
