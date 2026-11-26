import { asRecord, records, stringAt, strings, type JsonObject } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Cloud Monitoring v3 for the `crash-alerts` item and the crash e-mail switch of step (g)
 * (`docs/research/M2b-interfaces.md` §3.3 g, §3.4): an e-mail notification channel to the owner's verified address and
 * a log-based alert policy on new Error Reporting events. The address is used only here, in the owner's own project,
 * and never logged.
 */

const MONITORING = 'https://monitoring.googleapis.com/v3';
const ROLE = 'roles/monitoring.editor';

export interface NotificationChannel {
    readonly name: string;
    readonly displayName: string;
    readonly email: string;
}

export interface AlertPolicy {
    readonly name: string;
    readonly displayName: string;
    readonly enabled: boolean;
    readonly channels: readonly string[];
    readonly body: JsonObject;
}

export interface MonitoringClient {
    listEmailChannels(projectId: string): Promise<NotificationChannel[]>;
    createEmailChannel(projectId: string, displayName: string, email: string): Promise<NotificationChannel>;
    listAlertPolicies(projectId: string): Promise<AlertPolicy[]>;
    createAlertPolicy(projectId: string, policy: JsonObject): Promise<void>;
    /** Changes the listed fields of an alert policy (`enabled` for the crash e-mail switch); resolves to the policy as written. */
    patchAlertPolicy(name: string, fields: JsonObject, updateMask: readonly string[]): Promise<AlertPolicy>;
}

function channelOf(body: JsonObject): NotificationChannel {
    return {
        name: String(body['name']),
        displayName: stringAt(body, 'displayName') ?? '',
        email: stringAt(body, 'labels', 'email_address') ?? '',
    };
}

function policyOf(body: JsonObject): AlertPolicy {
    return {
        name: String(body['name']),
        displayName: stringAt(body, 'displayName') ?? '',
        enabled: body['enabled'] !== false,
        channels: strings(body['notificationChannels']),
        body,
    };
}

export function createMonitoringClient(transport: GoogleTransport): MonitoringClient {
    return {
        listEmailChannels: async (projectId) =>
            records(
                await transport.pages(
                    {
                        operation: 'monitoring.notificationChannels.list',
                        url: `${MONITORING}/projects/${projectId}/notificationChannels`,
                        query: { filter: 'type="email"' },
                    },
                    'notificationChannels',
                ),
            ).map(channelOf),
        createEmailChannel: async (projectId, displayName, email) =>
            channelOf(
                asRecord(
                    await transport.call({
                        operation: 'monitoring.notificationChannels.create',
                        method: 'POST',
                        url: `${MONITORING}/projects/${projectId}/notificationChannels`,
                        body: { type: 'email', displayName, labels: { email_address: email }, enabled: true },
                        role: ROLE,
                    }),
                ),
            ),
        listAlertPolicies: async (projectId) =>
            records(
                await transport.pages(
                    { operation: 'monitoring.alertPolicies.list', url: `${MONITORING}/projects/${projectId}/alertPolicies` },
                    'alertPolicies',
                ),
            ).map(policyOf),
        createAlertPolicy: async (projectId, policy) => {
            await transport.call({
                operation: 'monitoring.alertPolicies.create',
                method: 'POST',
                url: `${MONITORING}/projects/${projectId}/alertPolicies`,
                body: policy,
                role: ROLE,
            });
        },
        patchAlertPolicy: async (name, fields, updateMask) =>
            policyOf(
                asRecord(
                    await transport.call({
                        operation: 'monitoring.alertPolicies.patch',
                        method: 'PATCH',
                        url: `${MONITORING}/${name}`,
                        query: { updateMask: updateMask.join(',') },
                        body: fields,
                        role: ROLE,
                    }),
                ),
            ),
    };
}
