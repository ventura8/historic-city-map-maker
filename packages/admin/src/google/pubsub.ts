import { parsePolicy, type PolicyAccess } from './iam-policy.js';
import { createOnce, type GoogleTransport } from './transport.js';

/**
 * Pub/Sub v1 for the `budget-alerts` item (`docs/research/M2b-interfaces.md` §3.4): the `budget` topic `ops.onBudget`
 * listens to, and its IAM policy (the Budget API's publisher account).
 */

const PUBSUB = 'https://pubsub.googleapis.com/v1';
const ROLE = 'roles/pubsub.admin';

export interface PubSubClient {
    topicExists(projectId: string, topicId: string): Promise<boolean>;
    /** Creates the topic; an existing one is success. */
    createTopic(projectId: string, topicId: string): Promise<void>;
    topicPolicy(projectId: string, topicId: string): PolicyAccess;
}

export function createPubSubClient(transport: GoogleTransport): PubSubClient {
    const topic = (projectId: string, topicId: string): string => `${PUBSUB}/projects/${projectId}/topics/${topicId}`;
    return {
        topicExists: async (projectId, topicId) =>
            (await transport.find({ operation: 'pubsub.topics.get', url: topic(projectId, topicId) })) !== undefined,
        createTopic: async (projectId, topicId) => {
            await createOnce(transport, {
                operation: 'pubsub.topics.create',
                method: 'PUT',
                url: topic(projectId, topicId),
                body: {},
                role: ROLE,
            });
        },
        topicPolicy: (projectId, topicId) => ({
            read: async () =>
                parsePolicy(
                    await transport.call({ operation: 'pubsub.topics.getIamPolicy', url: `${topic(projectId, topicId)}:getIamPolicy` }),
                ),
            write: (policy) =>
                transport.call({
                    operation: 'pubsub.topics.setIamPolicy',
                    method: 'POST',
                    url: `${topic(projectId, topicId)}:setIamPolicy`,
                    body: { policy },
                    role: ROLE,
                }),
        }),
    };
}
