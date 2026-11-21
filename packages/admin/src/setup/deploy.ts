/**
 * Step (d), the server's deployment (`docs/research/M2b-interfaces.md` §3.3 d): with the (c) token the card lists the
 * Cloud Functions every 30 s while the tab is visible, for two hours, against the registry: some missing is `pending`
 * (the card's body shows the count, once: finding 7 of 2026-10-25), one `FAILED` is `invalid` with its name, Cloud
 * Functions still disabled is `missing`. Once every function is `ACTIVE` the shell probes the server (§1.4); when it
 * answers, the step is done and the claim (d2) follows; a deployed server that does not answer is `invalid` (an
 * organisation policy, §23c) and the poll goes on. A token that expired meanwhile costs Continue (one click, one
 * consent). Since M6 the card installs the server itself (Install the server, `install.ts`, one click); this flow
 * still decides when the server is there and claims.
 */
import type { SetupContext } from './context.js';
import { googleAccess } from './google-access.js';
import { googleFailure, setupMessage } from './messages.js';
import { createPoller, type PollOutcome, type Poller } from './poll.js';
import type { DeploymentObservation, GoogleAccess } from './ports.js';

const DEPLOY_POLL = { intervalMs: 30_000, stopAfterMs: 2 * 60 * 60_000 };

export interface DeployFlow {
    /** Starts watching the deployment (no click; needs the live `cloudPlatform` token). */
    watch(): void;
    /** Check again, or Continue after an expired token: one click (and one consent without a live token). */
    recheck(): Promise<void>;
    dispose(): void;
}

class Deploy implements DeployFlow {
    private readonly poller: Poller;

    constructor(
        private readonly ctx: SetupContext,
        private readonly onDeployed: () => Promise<void>,
    ) {
        this.poller = createPoller(
            ctx.deps,
            DEPLOY_POLL,
            () => this.check(),
            () => {
                this.expired();
            },
        );
    }

    watch(): void {
        if (this.poller.isRunning()) {
            return;
        }
        this.setWatching(true);
        this.poller.start(true);
    }

    async recheck(): Promise<void> {
        this.ctx.count('deploy', 'inputs');
        const access = await googleAccess(this.ctx, 'deploy', 'cloudPlatform', true);
        if (access !== null) {
            this.setWatching(true);
            this.poller.start(true);
        }
    }

    dispose(): void {
        this.poller.stop();
    }

    private setWatching(watching: boolean): void {
        this.ctx.update((state) => ({ ...state, deploy: { ...state.deploy, watching } }));
    }

    private async check(): Promise<PollOutcome> {
        const access = await googleAccess(this.ctx, 'deploy', 'cloudPlatform', false);
        if (access === null) {
            this.setWatching(false);
            return 'stop';
        }
        try {
            return await this.observe(access);
        } catch (error) {
            return this.failure(error);
        }
    }

    private async observe(access: GoogleAccess): Promise<PollOutcome> {
        const observed = await this.ctx.deps.cloud.deployment(access);
        this.record(observed);
        const [failed] = observed.failed;
        if (failed !== undefined) {
            this.health('invalid', 'adminSetup.deploy.failed', { name: failed });
            return 'next';
        }
        if (observed.ready < observed.total) {
            this.health('pending', null);
            return 'next';
        }
        return this.probe();
    }

    private async probe(): Promise<PollOutcome> {
        if (!(await this.ctx.deps.host.serverDeployed())) {
            this.health('invalid', 'adminSetup.deploy.unreachable');
            return 'next';
        }
        this.ctx.patchStep('deploy', { state: 'ok', detail: null, error: null, checkedAt: this.ctx.nowIso() });
        this.claimNext();
        this.setWatching(false);
        await this.onDeployed();
        return 'stop';
    }

    /**
     * Start-up mode: the claim (d2) follows the server. An admin session has claimed already: a look on step (d), an
     * update's among them, leaves the claim done, or steps (e) to (i), which wait for it, would close (finding 4 of the
     * M6 review).
     */
    private claimNext(): void {
        if (this.ctx.state().mode !== 'normal') {
            this.ctx.patchStep('claim', { state: 'pending', detail: setupMessage('adminSetup.claim.automatic') });
        }
    }

    private failure(error: unknown): PollOutcome {
        const failure = googleFailure(error);
        if (failure.message.key === 'apiError.cloud.apiDisabled') {
            this.health('missing', 'adminSetup.deploy.notStarted');
            return 'next';
        }
        this.ctx.fail('deploy', failure);
        if (failure.expired) {
            this.setWatching(false);
            return 'stop';
        }
        return 'backoff';
    }

    private expired(): void {
        this.setWatching(false);
        this.ctx.patchStep('deploy', { detail: setupMessage('adminSetup.deploy.timeout') });
    }

    private health(
        state: 'pending' | 'invalid' | 'missing',
        key: Parameters<typeof setupMessage>[0] | null,
        params?: Readonly<Record<string, string>>,
    ): void {
        const detail = key === null ? null : setupMessage(key, params);
        this.ctx.patchStep('deploy', { state, detail, error: null, checkedAt: this.ctx.nowIso() });
    }

    private record(observed: DeploymentObservation): void {
        const { ready, total, failed } = observed;
        this.ctx.update((state) => ({ ...state, deploy: { ...state.deploy, ready, total, failed } }));
    }
}

/** `onDeployed` runs once the server answers (the doctor's scheduler check). */
export function createDeployFlow(ctx: SetupContext, onDeployed: () => Promise<void>): DeployFlow {
    return new Deploy(ctx, onDeployed);
}
