/**
 * The Cloud Tasks adapter over firebase-admin's task queue client, with a client that records what it was asked and
 * fails as firebase-admin does (`FirebaseFunctionsError` codes `functions/<code>`, `httpResponse.status`). No test
 * reaches Cloud Tasks.
 */
import { describe, expect, it } from 'vitest';

import { createCloudTaskQueue, type TaskQueueClient } from '../../src/adapters/cloud-tasks.js';
import { UpstreamError } from '../../src/ports/errors.js';

interface Recorded {
    readonly queue: string;
    readonly data: unknown;
    readonly options: unknown;
}

function client(failure?: Error): TaskQueueClient & { readonly calls: Recorded[] } {
    const calls: Recorded[] = [];
    return {
        calls,
        taskQueue: (queue) => ({
            enqueue: (data, options) => {
                calls.push({ queue, data, options });
                return failure === undefined ? Promise.resolve() : Promise.reject(failure);
            },
        }),
    };
}

function functionsError(code: string, status?: number): Error {
    return Object.assign(new Error(code), { code, ...(status === undefined ? {} : { httpResponse: { status } }) });
}

const TASK = { cityId: 'bucuresti', requestedVersion: 3, full: false } as const;

describe('createCloudTaskQueue', () => {
    it('happyPath_queuesOnTheFunctionsQueueWithIdAndDelay', async () => {
        const tasks = client();

        await expect(
            createCloudTaskQueue(tasks, 'us-central1').enqueue('publish-buildManifest', TASK, {
                id: 'manifest-bucuresti-1',
                delaySeconds: 60,
            }),
        ).resolves.toBe(true);
        expect(tasks.calls).toEqual([
            {
                queue: 'locations/us-central1/functions/publish-buildManifest',
                data: TASK,
                options: { id: 'manifest-bucuresti-1', scheduleDelaySeconds: 60 },
            },
        ]);
    });

    it('happyPath_unnamedTasksDropTheirIdButKeepTheDelay', async () => {
        const tasks = client();
        const queue = createCloudTaskQueue(tasks, 'us-central1', { named: false });

        await expect(queue.enqueue('publish-buildManifest', TASK, { id: 'manifest-bucuresti-1', delaySeconds: 60 })).resolves.toBe(true);
        await expect(queue.enqueue('publish-buildManifest', TASK, { id: 'manifest-bucuresti-1' })).resolves.toBe(true);

        expect(tasks.calls.map((call) => call.options)).toEqual([{ scheduleDelaySeconds: 60 }, {}]);
    });

    it('happyPath_withoutOptionsNoneAreSent', async () => {
        const tasks = client();

        await createCloudTaskQueue(tasks, 'us-central1').enqueue('publish-buildManifest', TASK);

        expect(tasks.calls[0]?.options).toEqual({});
    });

    it('badPath_aTaskWhoseIdExistsIsNotQueuedAgain', async () => {
        const queue = createCloudTaskQueue(client(functionsError('functions/task-already-exists', 409)), 'us-central1');

        await expect(queue.enqueue('publish-buildManifest', TASK, { id: 'manifest-bucuresti-1' })).resolves.toBe(false);
    });

    it.each([
        ['functions/permission-denied', 403, 'forbidden'],
        ['functions/unauthenticated', 401, 'unauthorized'],
        ['functions/invalid-credential', undefined, 'unauthorized'],
        ['functions/not-found', 404, 'notFound'],
        ['functions/invalid-argument', 400, 'invalid'],
        ['functions/failed-precondition', 400, 'invalid'],
        ['functions/unknown-error', 429, 'rateLimited'],
        ['functions/unknown-error', 503, 'unavailable'],
        ['functions/internal-error', undefined, 'unavailable'],
    ] as const)('badPath_%s_%s_is_%s', async (code, status, failure) => {
        const error = await createCloudTaskQueue(client(functionsError(code, status)), 'us-central1')
            .enqueue('publish-buildManifest', TASK)
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(UpstreamError);
        expect(error).toMatchObject({ service: 'cloud-tasks', failure });
    });

    it('badPath_aFailureWithoutACodeIsUnavailable', async () => {
        await expect(
            createCloudTaskQueue(client(new Error('socket hang up')), 'us-central1').enqueue('publish-buildManifest', TASK),
        ).rejects.toMatchObject({
            failure: 'unavailable',
        });
    });

    it('badPath_aThrownValueThatIsNoObjectIsUnavailable', async () => {
        const reason: unknown = 'not an error object';
        const throwing: TaskQueueClient = {
            taskQueue: () => ({
                enqueue: () => {
                    throw reason;
                },
            }),
        };

        await expect(createCloudTaskQueue(throwing, 'us-central1').enqueue('publish-buildManifest', TASK)).rejects.toMatchObject({
            failure: 'unavailable',
        });
    });
});
