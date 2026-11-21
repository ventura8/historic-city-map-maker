import type { ListGroupsRequest, ListGroupsResponse, ReportedErrorEvent } from '@hcm/shared';

/**
 * Cloud Error Reporting (PLAN Addendum 2). `report` writes one structured log entry (severity ERROR, `jsonPayload` =
 * the validated, redacted `ReportedErrorEvent`), which Error Reporting groups; no API call, no quota. `listGroups`
 * reads the groups over REST (`clouderrorreporting.googleapis.com/v1beta1/projects/{p}/groupStats`) for the Setup
 * Assistant's "Crash reports" panel. Adapter `functions/src/adapters/error-reporting.ts` (fn-admin).
 */
export interface ErrorReporter {
    report(event: ReportedErrorEvent): void;
    listGroups(request: ListGroupsRequest): Promise<ListGroupsResponse>;
}
