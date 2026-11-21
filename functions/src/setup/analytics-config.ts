import { timestampFromDate, type CallableRequest, type CallableResponse, type CityDoc } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { VerifiedCaller } from '../api/access.js';
import type { Ports } from '../ports/index.js';
import { ROLES, TRANSIENT, viaCloud } from './failures.js';
import { commitCityAndStatus, requireCity, stampOf } from './records.js';
import { toSetupStatusView } from './view.js';

export type AnalyticsConfigDeps = Pick<Ports, 'documents' | 'firebase' | 'clock' | 'config' | 'log'>;

type Request = CallableRequest<'setup.analyticsConfig'>;
type Response = CallableResponse<'setup.analyticsConfig'>;
type AppIds = Response['firebase'];

/** The active web app's measurement id and public identifiers, or the step the admin has to take first. */
async function detect(deps: AnalyticsConfigDeps): Promise<{ readonly measurementId: string; readonly ids: AppIds }> {
    const apps = await viaCloud(deps.firebase.listWebApps(deps.config.projectId), ROLES.firebaseViewer, TRANSIENT);
    const app = apps.find((candidate) => candidate.state === 'ACTIVE');
    if (app === undefined) {
        throw new ApiError('apiError.analytics.noWebApp');
    }
    const config = await viaCloud(deps.firebase.webAppConfig(deps.config.projectId, app.appId), ROLES.firebaseViewer, TRANSIENT);
    if (config.measurementId === undefined) {
        throw new ApiError('apiError.analytics.notEnabled');
    }
    return { measurementId: config.measurementId, ids: { apiKey: config.apiKey, appId: config.appId, projectId: config.projectId } };
}

const APP_ID_KEYS = ['apiKey', 'appId', 'projectId'] as const;

/** True when the city's analytics already say exactly this (a second call changes nothing and queues no rebuild). */
function unchanged(city: CityDoc, measurementId: string, ids: AppIds): boolean {
    const stored = city.analytics?.firebase;
    return city.analytics?.measurementId === measurementId && stored !== undefined && APP_ID_KEYS.every((key) => stored[key] === ids[key]);
}

/**
 * `setup.analyticsConfig` (admin; PLAN Addendum 2, scenario A22): finds the project's active Firebase web app and its
 * config through the Firebase Management API, and writes the GA4 measurement id and the app's public identifiers
 * (never secrets, never committed: M1 CR-9) into the city, where the manifest builder picks them up, and the analytics
 * health into `setup/status`. A missing web app, analytics not enabled or a missing role answer the step to take and
 * write nothing (S-A22-BAD-MISSING-ROLE).
 */
export async function analyticsConfig(deps: AnalyticsConfigDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const city = await requireCity(deps.documents, request.cityId);
    const { measurementId, ids } = await detect(deps);
    const now = deps.clock.now();
    const written = await commitCityAndStatus(deps.documents, stampOf(caller.uid, deps), request.cityId, {
        city: (current) => ({ ...current, analytics: { ...current.analytics, measurementId, firebase: ids } }),
        status: (current) => ({
            ...current,
            analytics: { state: 'ok', checkedAt: timestampFromDate(now), measurementId, appId: ids.appId },
        }),
    });
    deps.log.info('analytics configured', { uid: caller.uid, cityId: request.cityId, measurementId });
    return {
        analytics: toSetupStatusView(written.status, now).analytics,
        measurementId,
        firebase: ids,
        manifestQueued: written.city.published && !unchanged(city, measurementId, ids),
    };
}
