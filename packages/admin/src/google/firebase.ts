import { at, lastSegment, records, stringAt } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Firebase Management v1beta1's `analyticsDetails` and the Google Analytics Admin API's enhanced-measurement settings,
 * for the GA4 stream setting of step (g) (CR-M2-37, `docs/research/M2b-interfaces.md` §3.3 g): gtag.js's history-change
 * page views would send the viewer's hash, so `pageChangesEnabled` is turned off and read back. The Analytics Admin
 * version is **UNVERIFIED** (`v1alpha` documents `enhancedMeasurementSettings`).
 */

const FIREBASE = 'https://firebase.googleapis.com/v1beta1';
const ANALYTICS_ADMIN = 'https://analyticsadmin.googleapis.com/v1alpha';

interface AnalyticsStream {
    /** `properties/<id>` */
    readonly property: string;
    readonly streamId: string;
    readonly measurementId: string;
}

export interface AnalyticsClient {
    /** The GA4 web stream of the web app, or undefined when Google Analytics is not linked. */
    findStream(projectId: string, appId: string): Promise<AnalyticsStream | undefined>;
    pageChangesEnabled(stream: AnalyticsStream): Promise<boolean>;
    /** Turns history-change page views off; resolves to the value read back. */
    disablePageChanges(stream: AnalyticsStream): Promise<boolean>;
}

function streamOf(details: unknown, appId: string): AnalyticsStream | undefined {
    const property = stringAt(details, 'analyticsProperty', 'id');
    const mapping = records(at(details, 'streamMappings')).find((item) => lastSegment(String(item['app'])) === appId);
    if (property === undefined || mapping === undefined) {
        return undefined;
    }
    return { property, streamId: String(mapping['streamId']), measurementId: String(mapping['measurementId']) };
}

export function createAnalyticsClient(transport: GoogleTransport): AnalyticsClient {
    const settings = (stream: AnalyticsStream): string =>
        `${ANALYTICS_ADMIN}/${stream.property}/dataStreams/${stream.streamId}/enhancedMeasurementSettings`;
    const read = async (stream: AnalyticsStream): Promise<boolean> =>
        at(
            await transport.call({ operation: 'analytics-admin.enhancedMeasurementSettings.get', url: settings(stream) }),
            'pageChangesEnabled',
        ) !== false;
    return {
        findStream: async (projectId, appId) =>
            streamOf(
                await transport.find({
                    operation: 'firebase-management.getAnalyticsDetails',
                    url: `${FIREBASE}/projects/${projectId}/analyticsDetails`,
                }),
                appId,
            ),
        pageChangesEnabled: read,
        disablePageChanges: async (stream) => {
            await transport.call({
                operation: 'analytics-admin.enhancedMeasurementSettings.patch',
                method: 'PATCH',
                url: settings(stream),
                query: { updateMask: 'pageChangesEnabled' },
                body: { pageChangesEnabled: false },
                role: 'roles/analytics.editor',
            });
            return read(stream);
        },
    };
}
