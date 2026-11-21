import { FIXTURE_VALUES, fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { bodyField, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Cloud Tasks v2 (the manifest builder's queue, `TaskQueue` port; the provisioner's `task-queues` item): queues, and
 * tasks whose name deduplicates: a second task with the name of a queued, dispatched or deleted one is refused with
 * 409 `ALREADY_EXISTS`, as Cloud Tasks does for about an hour. Tasks are never dispatched; a test reads them.
 */

interface Queue {
    readonly body: Readonly<Record<string, unknown>>;
    /** Task id → the task as created. */
    readonly tasks: Map<string, Readonly<Record<string, unknown>>>;
    /** Every task id ever used in this queue (deduplication). */
    readonly used: Set<string>;
}

export interface CloudTasksState {
    /** `<project>/<region>/<queue>` → the queue. */
    readonly queues: Map<string, Queue>;
}

const CLOUD_TASKS: GoogleApi = { service: 'cloudtasks.googleapis.com', title: 'Cloud Tasks API', permission: 'cloudtasks.tasks.create' };

/** The fake Cloud Tasks API. */
export function createCloudTasksFake(state: CloudTasksState, projects: GoogleProjects): ServiceFake {
    const nextTask = sequence('e2e-task-');
    const queueName = (params: RouteParams, queue: string): string =>
        `projects/${projects.resolve(String(params['project'])).id}/locations/${String(params['region'])}/queues/${queue}`;
    const queueKey = (params: RouteParams, queue: string): string =>
        `${projects.resolve(String(params['project'])).id}/${String(params['region'])}/${queue}`;
    const withQueue = (params: RouteParams, answer: (queue: Queue, name: string) => Response): Response => {
        const queue = state.queues.get(queueKey(params, String(params['queue'])));
        return queue === undefined
            ? fixtureResponse('cloud-tasks/queue.not-found')
            : answer(queue, queueName(params, String(params['queue'])));
    };
    const createQueue: Route['answer'] = (request, params) => {
        const name = bodyField(request, 'name');
        const queueId = typeof name === 'string' ? String(name.split('/').at(-1)) : '';
        if (queueId === '') {
            return googleError('google/error.invalid-argument', CLOUD_TASKS);
        }
        if (state.queues.has(queueKey(params, queueId))) {
            return googleError('google/error.already-exists', CLOUD_TASKS);
        }
        const body = {
            ...(fixtureBody('cloud-tasks/queue.created') as Record<string, unknown>),
            ...requestObject(request),
            name: queueName(params, queueId),
            state: 'RUNNING',
        };
        state.queues.set(queueKey(params, queueId), { body, tasks: new Map(), used: new Set() });
        return jsonResponse(body);
    };
    const createTask: Route['answer'] = (request, params) =>
        withQueue(params, (queue, name) => {
            const asked = (bodyField(request, 'task') ?? {}) as Readonly<Record<string, unknown>>;
            const taskId = typeof asked['name'] === 'string' ? String(asked['name'].split('/').at(-1)) : nextTask();
            if (queue.used.has(taskId)) {
                return fixtureResponse('cloud-tasks/task.exists');
            }
            const created = fixtureBody('cloud-tasks/task.created', {
                projectId: String(params['project']),
                region: String(params['region']),
                queue: String(params['queue']),
                task: taskId,
            }) as Record<string, unknown>;
            const task = { ...created, ...asked, name: `${name}/tasks/${taskId}` };
            queue.used.add(taskId);
            queue.tasks.set(taskId, task);
            return jsonResponse(task);
        });
    const base = 'https://cloudtasks.googleapis.com/v2/projects/{project}/locations/{region}/queues';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(CLOUD_TASKS, answer);
    return {
        name: 'cloud-tasks',
        routes: [
            route('POST', base, 'cloud-tasks.queues.create', auth(createQueue)),
            route(
                'GET',
                `${base}/{queue}`,
                'cloud-tasks.queues.get',
                auth((_request, params) => withQueue(params, (queue) => jsonResponse(queue.body))),
            ),
            route('POST', `${base}/{queue}/tasks`, 'cloud-tasks.tasks.create', auth(createTask)),
            route(
                'GET',
                `${base}/{queue}/tasks`,
                'cloud-tasks.tasks.list',
                auth((_request, params) =>
                    withQueue(params, (queue) => jsonResponse(queue.tasks.size === 0 ? {} : { tasks: [...queue.tasks.values()] })),
                ),
            ),
            route(
                'DELETE',
                `${base}/{queue}/tasks/{task}`,
                'cloud-tasks.tasks.delete',
                auth((_request, params) =>
                    withQueue(params, (queue) =>
                        queue.tasks.delete(String(params['task'])) ? jsonResponse({}) : googleError('google/error.not-found', CLOUD_TASKS),
                    ),
                ),
            ),
        ],
        failure: (mode) => googleFailure(CLOUD_TASKS, mode),
        scenarios: {
            queueProvisioned: () => {
                const key = `${String(FIXTURE_VALUES['projectId'])}/${String(FIXTURE_VALUES['region'])}/${String(FIXTURE_VALUES['queue'])}`;
                if (!state.queues.has(key)) {
                    state.queues.set(key, {
                        body: fixtureBody('cloud-tasks/queue.get') as Record<string, unknown>,
                        tasks: new Map(),
                        used: new Set(),
                    });
                }
            },
        },
        snapshot: () => ({
            queues: Object.fromEntries(
                [...state.queues].map(([key, queue]) => [key, { tasks: Object.fromEntries(queue.tasks), used: [...queue.used] }]),
            ),
        }),
    };
}
