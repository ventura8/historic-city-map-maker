import { fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import type { PolicyStore } from './google-policies.js';
import { jsonResponse, route, type Route, type RouteParams } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * Pub/Sub v1 topics and their IAM policies, for the `budget-alerts` doctor item (`docs/research/M2b-interfaces.md` §3.4
 * item 9): `PUT` creates a topic (409 `ALREADY_EXISTS` the second time), its policy names who may publish.
 */

export interface PubSubState {
    /** `<project id>/<topic>` of every topic. */
    readonly topics: Set<string>;
    readonly policies: PolicyStore;
}

const PUBSUB: GoogleApi = { service: 'pubsub.googleapis.com', title: 'Cloud Pub/Sub API', permission: 'pubsub.topics.create' };
const TOPIC = 'https://pubsub.googleapis.com/v1/projects/{project}/topics/{topic}';

/** The fake Pub/Sub API. */
export function createPubSubFake(state: PubSubState, projects: GoogleProjects): ServiceFake {
    const keyOf = (params: RouteParams): string => `${projects.resolve(String(params['project'])).id}/${String(params['topic'])}`;
    const body = (params: RouteParams): unknown =>
        fixtureBody('pubsub/topic.get', { projectId: projects.resolve(String(params['project'])).id, topic: String(params['topic']) });
    const withTopic = (params: RouteParams, answer: () => Response): Response =>
        state.topics.has(keyOf(params)) ? answer() : googleError('google/error.not-found', PUBSUB);
    const create: Route['answer'] = (_request, params) => {
        if (state.topics.has(keyOf(params))) {
            return googleError('google/error.already-exists', PUBSUB);
        }
        state.topics.add(keyOf(params));
        return jsonResponse(body(params));
    };
    const setPolicy: Route['answer'] = (request, params) =>
        withTopic(params, () => {
            const stored = state.policies.write(keyOf(params), request);
            return stored === undefined ? googleError('google/error.aborted', PUBSUB) : jsonResponse(stored);
        });
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(PUBSUB, answer);
    return {
        name: 'pubsub',
        routes: [
            route(
                'GET',
                `${TOPIC}:getIamPolicy`,
                'pubsub.topics.getIamPolicy',
                auth((_request, params) => withTopic(params, () => jsonResponse(state.policies.read(keyOf(params))))),
            ),
            route('POST', `${TOPIC}:setIamPolicy`, 'pubsub.topics.setIamPolicy', auth(setPolicy)),
            route('PUT', TOPIC, 'pubsub.topics.create', auth(create)),
            route(
                'GET',
                TOPIC,
                'pubsub.topics.get',
                auth((_request, params) => withTopic(params, () => jsonResponse(body(params)))),
            ),
        ],
        failure: (mode) => googleFailure(PUBSUB, mode),
        scenarios: {},
        snapshot: () => ({ topics: [...state.topics], policies: state.policies.snapshot() }),
    };
}
