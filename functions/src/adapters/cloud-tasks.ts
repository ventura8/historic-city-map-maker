import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { TaskQueue } from '../ports/task-queue.js';

/** The part of firebase-admin's `getFunctions(app)` this adapter uses (its `TaskQueue.enqueue` is REST, OIDC handled). */
export interface TaskQueueClient {
    taskQueue(functionName: string): {
        enqueue(data: Record<string, unknown>, options: { id?: string; scheduleDelaySeconds?: number }): Promise<void>;
    };
}

/** firebase-admin's `FirebaseFunctionsError` codes (`functions/<code>`) as a handler needs to tell them apart. */
const FAILURE_BY_CODE: ReadonlyMap<string, UpstreamFailure> = new Map<string, UpstreamFailure>([
    ['functions/permission-denied', 'forbidden'],
    ['functions/unauthenticated', 'unauthorized'],
    ['functions/invalid-credential', 'unauthorized'],
    ['functions/not-found', 'notFound'],
    ['functions/invalid-argument', 'invalid'],
    ['functions/failed-precondition', 'invalid'],
]);

const ALREADY_EXISTS = 'functions/task-already-exists';

interface FunctionsErrorShape {
    readonly code?: unknown;
    readonly httpResponse?: { readonly status?: unknown };
}

function shapeOf(error: unknown): FunctionsErrorShape {
    return typeof error === 'object' && error !== null ? error : {};
}

/** firebase-admin's option names: an absent option stays absent. */
function taskOptions(options: { readonly id?: string; readonly delaySeconds?: number }): { id?: string; scheduleDelaySeconds?: number } {
    return {
        ...(options.id === undefined ? {} : { id: options.id }),
        ...(options.delaySeconds === undefined ? {} : { scheduleDelaySeconds: options.delaySeconds }),
    };
}

/** The options without the task id (an unnamed task). */
function withoutId(options: { readonly id?: string; readonly delaySeconds?: number }): { readonly delaySeconds?: number } {
    return options.delaySeconds === undefined ? {} : { delaySeconds: options.delaySeconds };
}

/** An unknown error code: a 429 is rate limiting, anything else (5xx, network) is `unavailable`. */
function failureOf(shape: FunctionsErrorShape): UpstreamFailure {
    const known = typeof shape.code === 'string' ? FAILURE_BY_CODE.get(shape.code) : undefined;
    return known ?? (shape.httpResponse?.status === 429 ? 'rateLimited' : 'unavailable');
}

export interface CloudTaskQueueOptions {
    /**
     * Whether tasks keep their ids (default true). The Cloud Tasks emulator dispatches a task at once, whatever its
     * delay, and still refuses its id afterwards, so a named debounce window would swallow every later request of the
     * window: in the Functions emulator each request is a task of its own (the queue still runs one at a time).
     */
    readonly named?: boolean;
}

/**
 * Cloud Tasks for the `onTaskDispatched` functions through firebase-admin (`roles/cloudtasks.enqueuer`). The queue of
 * a function is `locations/<region>/functions/<deployed name>` (`publish-buildManifest`). A task id that exists
 * already (the manifest builder's debounce window, `manifestTaskId`) resolves `false`; every other failure is an
 * `UpstreamError` of `cloud-tasks`.
 */
export function createCloudTaskQueue(client: TaskQueueClient, region: string, settings: CloudTaskQueueOptions = {}): TaskQueue {
    const named = settings.named ?? true;
    return {
        enqueue: async (queue, payload, options = {}) => {
            try {
                const kept = named ? options : withoutId(options);
                await client.taskQueue(`locations/${region}/functions/${queue}`).enqueue({ ...payload }, taskOptions(kept));
                return true;
            } catch (error) {
                const shape = shapeOf(error);
                if (shape.code === ALREADY_EXISTS) {
                    return false;
                }
                throw new UpstreamError('cloud-tasks', failureOf(shape));
            }
        },
    };
}
