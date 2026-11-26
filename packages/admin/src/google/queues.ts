import { records, stringAt } from './json.js';
import { createOnce, type GoogleTransport } from './transport.js';

/**
 * Cloud Tasks v2 and Cloud Scheduler v1 for the `task-queues` and `scheduler` items (`docs/research/M2b-interfaces.md`
 * §3.4): the provisioner creates the manifest queue (the first deploy then updates it with the function's own
 * settings), and only reads the Scheduler job firebase-tools creates for `ops.tick`.
 */

const TASKS = 'https://cloudtasks.googleapis.com/v2';
const SCHEDULER = 'https://cloudscheduler.googleapis.com/v1';

interface SchedulerJob {
    readonly name: string;
    /** The HTTP target's URI, when the job has one. */
    readonly uri?: string;
}

export interface QueuesClient {
    queueExists(projectId: string, region: string, queueId: string): Promise<boolean>;
    /** Creates a queue dispatching one task at a time; an existing queue is success. */
    createQueue(projectId: string, region: string, queueId: string): Promise<void>;
    listSchedulerJobs(projectId: string, region: string): Promise<SchedulerJob[]>;
}

export function createQueuesClient(transport: GoogleTransport): QueuesClient {
    const queues = (projectId: string, region: string): string => `${TASKS}/projects/${projectId}/locations/${region}/queues`;
    return {
        queueExists: async (projectId, region, queueId) =>
            (await transport.find({ operation: 'cloud-tasks.queues.get', url: `${queues(projectId, region)}/${queueId}` })) !== undefined,
        createQueue: async (projectId, region, queueId) => {
            await createOnce(transport, {
                operation: 'cloud-tasks.queues.create',
                method: 'POST',
                url: queues(projectId, region),
                body: { name: `projects/${projectId}/locations/${region}/queues/${queueId}`, rateLimits: { maxConcurrentDispatches: 1 } },
                role: 'roles/cloudtasks.queueAdmin',
            });
        },
        listSchedulerJobs: async (projectId, region) => {
            const jobs = await transport.pages(
                { operation: 'cloud-scheduler.jobs.list', url: `${SCHEDULER}/projects/${projectId}/locations/${region}/jobs` },
                'jobs',
            );
            return records(jobs).map((job) => {
                const uri = stringAt(job, 'httpTarget', 'uri');
                return { name: String(job['name']), ...(uri === undefined ? {} : { uri }) };
            });
        },
    };
}
