import { authenticated, googleError, googleFailure, type GoogleApi } from './google-common.js';
import type { CloudBuildState, FakeBuild } from './google-cloudbuild.js';
import { bodyField, jsonResponse, route, type Route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * Cloud Logging v2 `entries:list` for the installer's log summary (`docs/research/M6-interfaces.md` §1.7, §1.10): the
 * lines of a fake Cloud Build build (`google-cloudbuild.ts`), newest first, each labelled with its step the way Cloud
 * Build labels them (`build_step`: `Step #3 - "functions"`). Only the filter the admin sends is understood:
 * `resource.type="build" AND resource.labels.build_id="<id>"`.
 */

const LOGGING: GoogleApi = { service: 'logging.googleapis.com', title: 'Cloud Logging API', permission: 'logging.logEntries.list' };

const BUILD_FILTER = /^resource\.type="build" AND resource\.labels\.build_id="([0-9a-f-]{8,64})"$/;

/** The page size the request asks for (50 without one). */
function pageSizeOf(request: Parameters<Route['answer']>[0]): number {
    const size = bodyField(request, 'pageSize');
    return typeof size === 'number' ? size : 50;
}

function entriesOf(build: FakeBuild | undefined): Record<string, unknown>[] {
    if (build === undefined) {
        return [];
    }
    const base = Date.parse(build.startTime ?? build.createTime);
    return build.log.map((line, index) => ({
        logName: `projects/${build.projectId}/logs/cloudbuild`,
        resource: { type: 'build', labels: { build_id: build.id, project_id: build.projectId } },
        textPayload: line.text,
        labels: { build_step: `Step #${String(Math.max(0, build.stepIds.indexOf(line.step)))} - "${line.step}"` },
        timestamp: new Date(base + index * 1000).toISOString(),
    }));
}

/** The fake Cloud Logging API over the builds' lines. */
export function createLoggingFake(builds: CloudBuildState): ServiceFake {
    const list: Route['answer'] = (request) => {
        const filter = bodyField(request, 'filter');
        const id = BUILD_FILTER.exec(typeof filter === 'string' ? filter : '')?.[1];
        if (id === undefined) {
            return googleError('google/error.invalid-argument', LOGGING);
        }
        const entries = entriesOf(builds.builds.get(id)).reverse().slice(0, pageSizeOf(request));
        return jsonResponse(entries.length === 0 ? {} : { entries });
    };
    return {
        name: 'logging',
        routes: [route('POST', 'https://logging.googleapis.com/v2/entries:list', 'logging.entries.list', authenticated(LOGGING, list))],
        failure: (mode) => googleFailure(LOGGING, mode),
        scenarios: {},
        snapshot: () => ({ builds: builds.builds.size }),
    };
}
