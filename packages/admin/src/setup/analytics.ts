/**
 * Step (g), analytics and crash reports (`docs/research/M2b-interfaces.md` §3.3 g): `setup.analyticsConfig` when the
 * card opens (and every 15 s for 15 minutes after the owner followed the link that enables Google Analytics); the GA4
 * stream setting that turns history page views off (one click, one `analyticsEdit` consent, CR-M2-37); Create the
 * measurement reports (§76f: the field measurements' custom definitions on the GA4 property, the same scope); the crash
 * e-mail switch over the `crash-alerts` alert policy (one click, one `cloudPlatform` consent); the crash groups of
 * `telemetry.listGroups`, also the `#/crashes` page, with "Enable with Google" when Error Reporting is disabled
 * (CR-M2-40).
 */
import type { AnalyticsConfigResponse, ListGroupsResponse } from '@hcm/shared';

import type { SetupContext } from './context.js';
import { googleAccess } from './google-access.js';
import { apiFailure, googleFailure, setupMessage, type StepFailure } from './messages.js';
import { createPoller, type Poller } from './poll.js';
import type { CrashGroupView, CrashSlice } from './state.js';

const ANALYTICS_POLL = { intervalMs: 15_000, stopAfterMs: 15 * 60_000 };

/** The crash panel lists the last week's groups. */
export const CRASH_GROUPS_REQUEST = { hours: 168, pageSize: 20 } as const;

export interface AnalyticsFlow {
    /** The card opened (normal mode): detect the measurement id and list the crash groups. */
    open(): Promise<void>;
    /** The owner followed the link that enables Google Analytics. */
    followLink(): void;
    disablePageChanges(): Promise<void>;
    /** §76f: Create the measurement reports on the GA4 property of the detected measurement id. */
    createReports(): Promise<void>;
    setCrashEmails(enabled: boolean): Promise<void>;
    loadCrashGroups(): Promise<void>;
    /** Enables a disabled API the crash panel needs (one click, one consent), then lists again. */
    enableApi(api: string): Promise<void>;
    dispose(): void;
}

function groupsOf(response: ListGroupsResponse): readonly CrashGroupView[] {
    return response.groups.map(({ groupId, message, service, count, lastSeen }) => ({ groupId, message, service, count, lastSeen }));
}

function crashFailure(crashes: CrashSlice, failure: StepFailure): CrashSlice {
    const disabledApi = failure.message.key === 'apiError.cloud.apiDisabled' ? (failure.message.params?.['api'] ?? null) : null;
    return { ...crashes, busy: false, loaded: true, error: failure.message, disabledApi };
}

class Analytics implements AnalyticsFlow {
    private readonly poller: Poller;

    constructor(private readonly ctx: SetupContext) {
        this.poller = createPoller(
            ctx.deps,
            ANALYTICS_POLL,
            async () => ((await this.config()) ? 'stop' : 'next'),
            () => {
                this.setWatching(false);
            },
        );
    }

    async open(): Promise<void> {
        if (this.ctx.state().mode !== 'normal') {
            return;
        }
        await this.config();
        await this.loadCrashGroups();
    }

    followLink(): void {
        this.setWatching(true);
        this.poller.start(false);
    }

    async disablePageChanges(): Promise<void> {
        this.ctx.count('analytics', 'inputs');
        const access = await googleAccess(this.ctx, 'analytics', 'analyticsEdit', true);
        if (access === null) {
            return;
        }
        try {
            const { pageChangesEnabled } = await this.ctx.deps.cloud.disablePageChanges(access);
            this.ctx.update((state) => ({ ...state, analytics: { ...state.analytics, pageChangesOff: !pageChangesEnabled } }));
            // The card's remaining Google action is the crash e-mail switch: its note names that scope from now on.
            if (!pageChangesEnabled) {
                this.ctx.patchStep('analytics', { scope: 'cloudPlatform' });
            }
        } catch (error) {
            this.streamFailed(googleFailure(error));
        }
    }

    async createReports(): Promise<void> {
        const id = this.ctx.state().analytics.measurementId;
        this.ctx.count('analytics', 'inputs');
        const access = id === null ? null : await googleAccess(this.ctx, 'analytics', 'analyticsEdit', true);
        if (id === null || access === null) {
            return;
        }
        try {
            this.reported(id, await this.ctx.deps.cloud.createMeasurementReports(access, id));
        } catch (error) {
            this.ctx.fail('analytics', googleFailure(error));
        }
    }

    async setCrashEmails(enabled: boolean): Promise<void> {
        this.ctx.count('analytics', 'inputs');
        const access = await googleAccess(this.ctx, 'analytics', 'cloudPlatform', true);
        if (access === null) {
            return;
        }
        try {
            const result = await this.ctx.deps.cloud.setCrashAlerts(access, enabled);
            this.ctx.update((state) => ({ ...state, analytics: { ...state.analytics, crashEmails: result.enabled } }));
        } catch (error) {
            this.ctx.fail('analytics', googleFailure(error));
        }
    }

    async loadCrashGroups(): Promise<void> {
        this.setCrashes((crashes) => ({ ...crashes, busy: true }));
        try {
            const groups = groupsOf(await this.ctx.deps.backend.listGroups(CRASH_GROUPS_REQUEST));
            this.setCrashes((crashes) => ({ ...crashes, busy: false, loaded: true, groups, error: null, disabledApi: null }));
        } catch (error) {
            const failure = apiFailure(error);
            this.setCrashes((crashes) => crashFailure(crashes, failure));
        }
    }

    async enableApi(api: string): Promise<void> {
        this.ctx.count('analytics', 'inputs');
        const access = await googleAccess(this.ctx, 'analytics', 'cloudPlatform', true);
        if (access === null) {
            return;
        }
        try {
            await this.ctx.deps.cloud.enableApis(access, [api]);
            await this.loadCrashGroups();
        } catch (error) {
            this.ctx.fail('analytics', googleFailure(error));
        }
    }

    dispose(): void {
        this.poller.stop();
    }

    /** What Create the measurement reports did, or that no property the owner can edit sends `id`. */
    private reported(id: string, reports: { readonly created: number; readonly skipped: number } | null): void {
        if (reports === null) {
            const message = setupMessage('adminSetup.analytics.noProperty', { id });
            this.ctx.fail('analytics', { state: 'invalid', message, expired: false });
            return;
        }
        this.ctx.update((state) => ({ ...state, analytics: { ...state.analytics, reports } }));
    }

    private setWatching(watching: boolean): void {
        this.ctx.update((state) => ({ ...state, analytics: { ...state.analytics, watching } }));
    }

    private setCrashes(change: (crashes: CrashSlice) => CrashSlice): void {
        this.ctx.update((state) => ({ ...state, crashes: change(state.crashes) }));
    }

    /** True once Google Analytics is set up (the poll stops). */
    private async config(): Promise<boolean> {
        try {
            const response = await this.ctx.deps.backend.analyticsConfig({ cityId: this.ctx.deps.host.cityId });
            this.configured(response);
            return response.analytics.state === 'ok';
        } catch (error) {
            this.configFailed(apiFailure(error));
            return false;
        }
    }

    private configured(response: AnalyticsConfigResponse): void {
        const { state, checkedAt, detail, params } = response.analytics;
        this.ctx.update((current) => ({ ...current, analytics: { ...current.analytics, measurementId: response.measurementId } }));
        this.ctx.patchStep('analytics', {
            state,
            checkedAt,
            error: null,
            detail: detail === undefined ? null : setupMessage(detail, params),
        });
        this.setWatching(this.poller.isRunning() && state !== 'ok');
    }

    /** "Not enabled" and "no web app" are the card's state (with the link); anything else is a failed check. */
    private configFailed(failure: StepFailure): void {
        const notSetUp = failure.message.key === 'apiError.analytics.notEnabled' || failure.message.key === 'apiError.analytics.noWebApp';
        if (notSetUp) {
            this.ctx.patchStep('analytics', { state: 'missing', detail: failure.message, checkedAt: this.ctx.nowIso() });
            return;
        }
        this.ctx.fail('analytics', failure);
    }

    private streamFailed(failure: StepFailure): void {
        const noStream = failure.message.key === 'apiError.notFound';
        this.ctx.fail('analytics', noStream ? { ...failure, message: setupMessage('adminSetup.analytics.noStream') } : failure);
    }
}

export function createAnalyticsFlow(ctx: SetupContext): AnalyticsFlow {
    return new Analytics(ctx);
}
