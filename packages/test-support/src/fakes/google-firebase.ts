import { FIXTURE_VALUES, fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { jsonResponse, route, type Route } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * The Firebase Management API v1beta1 for `setup.analyticsConfig` and `setup.selfTest` (scenario A22): the project's
 * web apps, a web app's public config (with `measurementId` once Google Analytics is linked), `addGoogleAnalytics`
 * and `analyticsDetails`, and Identity Toolkit's Google sign-in provider (its OAuth client id, which `admin.claim`
 * checks an owner's token against, CR-M2b-2). A fresh project has its one web app (PLAN Addendum 2), no Analytics and
 * Google sign-in set up with the fixture OAuth client (`googleSignInOff` removes it).
 */

interface FirebaseWebApp {
    readonly appId: string;
    readonly displayName: string;
    state: 'ACTIVE' | 'DELETED';
}

interface FirebaseProject {
    readonly apps: FirebaseWebApp[];
    /** The measurement id once Google Analytics is linked. */
    measurementId: string | undefined;
    /** Firebase Auth's Google provider is configured (with the fixture OAuth client). */
    googleSignIn: boolean;
}

export interface FirebaseState {
    /** Project id → its web apps and Analytics link (created with the default web app on first use). */
    readonly projects: Map<string, FirebaseProject>;
    /**
     * M14 (the start page, `google-hosting.ts`): a world where a project has nothing until it is made: no Firebase (`added`
     * says which have it), no web app, Google sign-in off until `signInOn`.
     */
    fresh: boolean;
    readonly added: Set<string>;
    signInOn: boolean;
}

const FIREBASE: GoogleApi = { service: 'firebase.googleapis.com', title: 'Firebase Management API', permission: 'firebase.projects.get' };

function defaultProject(): FirebaseProject {
    return {
        apps: [{ appId: String(FIXTURE_VALUES['appId']), displayName: 'historic-city-map', state: 'ACTIVE' }],
        measurementId: undefined,
        googleSignIn: true,
    };
}

const appBody = (projectId: string, app: FirebaseWebApp): Readonly<Record<string, unknown>> => ({
    ...(fixtureBody('firebase-management/web-apps.one-active', { projectId, appId: app.appId }) as { apps: Record<string, unknown>[] })
        .apps[0],
    displayName: app.displayName,
    state: app.state,
});

const analyticsBody = (projectId: string, firebase: FirebaseProject): unknown =>
    fixtureBody('firebase-management/analytics-details.linked', {
        projectId,
        appId: firebase.apps[0]?.appId ?? String(FIXTURE_VALUES['appId']),
        measurementId: String(firebase.measurementId),
    });

/** A project of the fake, with its Firebase side made on first sight (empty in the start page's fresh world). */
function projectLookup(
    state: FirebaseState,
    projects: GoogleProjects,
): (segment: string) => { readonly id: string; readonly number: string; readonly firebase: FirebaseProject } {
    return (segment) => {
        const project = projects.resolve(segment);
        const existing = state.projects.get(project.id);
        const firebase = existing ?? (state.fresh ? { ...defaultProject(), apps: [], googleSignIn: false } : defaultProject());
        if (existing === undefined) {
            state.projects.set(project.id, firebase);
        }
        return { ...project, firebase };
    };
}

/** The fake Firebase Management API. */
export function createFirebaseManagementFake(state: FirebaseState, projects: GoogleProjects): ServiceFake {
    const nextOperation = sequence('e2e-analytics-');
    const operations = new Map<string, string>();
    const projectOf = projectLookup(state, projects);
    const createApp: Route['answer'] = (request, params) => {
        const { firebase } = projectOf(String(params['project']));
        const { displayName } = JSON.parse(request.body) as { readonly displayName?: string };
        firebase.apps.push({ appId: String(FIXTURE_VALUES['appId']), displayName: displayName ?? '', state: 'ACTIVE' });
        const name = `operations/${nextOperation()}`;
        operations.set(name, String(params['project']));
        return jsonResponse({ name, done: false });
    };
    const config: Route['answer'] = (_request, params) => {
        const { id, number, firebase } = projectOf(String(params['project']));
        const app = firebase.apps.find((candidate) => candidate.appId === params['appId'] && candidate.state === 'ACTIVE');
        if (app === undefined) {
            return googleError('google/error.not-found', FIREBASE);
        }
        const values = { projectId: id, projectNumber: number, appId: app.appId };
        return firebase.measurementId === undefined
            ? fixtureResponse('firebase-management/web-app-config.no-analytics', { values })
            : fixtureResponse('firebase-management/web-app-config.analytics', {
                  values: { ...values, measurementId: firebase.measurementId },
              });
    };
    const addAnalytics: Route['answer'] = (_request, params) => {
        const { id, firebase } = projectOf(String(params['project']));
        firebase.measurementId ??= String(FIXTURE_VALUES['measurementId']);
        const name = `operations/analytics/${nextOperation()}`;
        operations.set(name, id);
        return jsonResponse({ name });
    };
    const base = 'https://firebase.googleapis.com/v1beta1/projects/{project}';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(FIREBASE, answer);
    return {
        name: 'firebase-management',
        routes: [
            route(
                'GET',
                `${base}/webApps`,
                'firebase-management.webApps.list',
                auth((_request, params) => {
                    const { id, firebase } = projectOf(String(params['project']));
                    const apps = firebase.apps.filter((app) => app.state === 'ACTIVE');
                    return jsonResponse(apps.length === 0 ? {} : { apps: apps.map((app) => appBody(id, app)) });
                }),
            ),
            route('POST', `${base}/webApps`, 'firebase-management.webApps.create', auth(createApp)),
            route(
                'GET',
                base,
                'firebase-management.getProject',
                auth((_request, params) => {
                    const { id, number } = projectOf(String(params['project']));
                    return state.fresh && !state.added.has(id)
                        ? googleError('google/error.not-found', FIREBASE)
                        : jsonResponse({ projectId: id, projectNumber: number, name: `projects/${id}`, state: 'ACTIVE' });
                }),
            ),
            route('GET', `${base}/webApps/{appId}/config`, 'firebase-management.webApps.getConfig', auth(config)),
            route('POST', `${base}:addGoogleAnalytics`, 'firebase-management.addGoogleAnalytics', auth(addAnalytics)),
            route(
                'GET',
                `${base}/analyticsDetails`,
                'firebase-management.getAnalyticsDetails',
                auth((_request, params) => {
                    const { id, number, firebase } = projectOf(String(params['project']));
                    return firebase.measurementId === undefined
                        ? fixtureResponse('firebase-management/analytics-details.not-linked', { values: { projectNumber: number } })
                        : jsonResponse(analyticsBody(id, firebase));
                }),
            ),
            route(
                'GET',
                'https://identitytoolkit.googleapis.com/admin/v2/projects/{project}/defaultSupportedIdpConfigs/google.com',
                'firebase-management.googleIdpConfig',
                auth((_request, params) => {
                    const { id, firebase } = projectOf(String(params['project']));
                    return firebase.googleSignIn || state.signInOn
                        ? fixtureResponse('firebase-management/google-idp-config.get', { values: { projectId: id } })
                        : googleError('google/error.not-found', FIREBASE);
                }),
            ),
            route(
                'GET',
                'https://firebase.googleapis.com/v1beta1/operations/{operation*}',
                'firebase-management.getOperation',
                auth((_request, params) => {
                    const name = `operations/${String(params['operation'])}`;
                    const projectId = operations.get(name);
                    if (projectId === undefined) {
                        return googleError('google/error.not-found', FIREBASE);
                    }
                    const body = fixtureBody('firebase-management/operation.done', { operationName: name }) as Record<string, unknown>;
                    const details = analyticsBody(projectId, projectOf(projectId).firebase) as Record<string, unknown>;
                    return jsonResponse({
                        ...body,
                        response: { '@type': 'type.googleapis.com/google.firebase.service.v1beta1.AnalyticsDetails', ...details },
                    });
                }),
            ),
        ],
        failure: (mode) => googleFailure(FIREBASE, mode),
        scenarios: {
            noWebApp: () => {
                projectOf(String(FIXTURE_VALUES['projectId'])).firebase.apps.splice(0);
            },
            analyticsLinked: () => {
                projectOf(String(FIXTURE_VALUES['projectId'])).firebase.measurementId = String(FIXTURE_VALUES['measurementId']);
            },
            googleSignInOff: () => {
                projectOf(String(FIXTURE_VALUES['projectId'])).firebase.googleSignIn = false;
            },
        },
        snapshot: () => ({ projects: Object.fromEntries(state.projects) }),
    };
}
