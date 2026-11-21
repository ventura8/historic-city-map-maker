import { FIXTURE_VALUES, fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { jsonResponse, route, type Route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * Cloud Error Reporting v1beta1 `groupStats.list` for the "Crash reports" panel (`telemetry.listGroups`, scenario A22):
 * the groups of a project in a time range, paged with `pageSize` and `pageToken`. A project has no group until a
 * scenario adds the fixture's two (`error-reporting.twoGroups`).
 */

export interface ErrorReportingState {
    /** Project id → its error group stats, in the API's shape. */
    readonly groups: Map<string, readonly Readonly<Record<string, unknown>>[]>;
}

const ERROR_REPORTING: GoogleApi = {
    service: 'clouderrorreporting.googleapis.com',
    title: 'Error Reporting API',
    permission: 'errorreporting.groups.list',
};
const PERIODS = new Set(['PERIOD_1_HOUR', 'PERIOD_6_HOURS', 'PERIOD_1_DAY', 'PERIOD_1_WEEK', 'PERIOD_30_DAYS']);
const DEFAULT_PAGE_SIZE = 20;

/** One page of `groups` for the request's `pageSize` and `pageToken` (the index of the page's first group). */
function pageOf(groups: readonly Readonly<Record<string, unknown>>[], query: URLSearchParams): Record<string, unknown> {
    const size = Number(query.get('pageSize') ?? DEFAULT_PAGE_SIZE);
    const start = Number(query.get('pageToken') ?? 0);
    const page = groups.slice(start, start + size);
    const next = start + size < groups.length ? { nextPageToken: String(start + size) } : {};
    const begin = (fixtureBody('error-reporting/group-stats.empty') as { timeRangeBegin: string }).timeRangeBegin;
    return { ...(page.length === 0 ? {} : { errorGroupStats: page }), ...next, timeRangeBegin: begin };
}

/** The fake Error Reporting API. */
export function createErrorReportingFake(state: ErrorReportingState, projects: GoogleProjects): ServiceFake {
    const list: Route['answer'] = (request, params) => {
        const query = request.url.searchParams;
        if (!PERIODS.has(query.get('timeRange.period') ?? '')) {
            return googleError('google/error.invalid-argument', ERROR_REPORTING);
        }
        return jsonResponse(pageOf(state.groups.get(projects.resolve(String(params['project'])).id) ?? [], query));
    };
    return {
        name: 'error-reporting',
        routes: [
            route(
                'GET',
                'https://clouderrorreporting.googleapis.com/v1beta1/projects/{project}/groupStats',
                'error-reporting.groupStats.list',
                authenticated(ERROR_REPORTING, list),
            ),
        ],
        failure: (mode) => googleFailure(ERROR_REPORTING, mode),
        scenarios: {
            twoGroups: () => {
                const projectId = String(FIXTURE_VALUES['projectId']);
                const body = fixtureBody('error-reporting/group-stats.two-groups', { projectId }) as {
                    errorGroupStats: Record<string, unknown>[];
                };
                state.groups.set(projectId, body.errorGroupStats);
            },
        },
        snapshot: () => ({ groups: Object.fromEntries(state.groups) }),
    };
}
