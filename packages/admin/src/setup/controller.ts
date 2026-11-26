/**
 * The Setup Assistant's state machine (`docs/research/M2b-interfaces.md` §3): it holds the state the page renders,
 * runs each step's flow behind the intents the elements call, resumes at the first incomplete step, re-checks any
 * step at any time, and switches from bootstrap to normal mode when the shell reports the claim (§3.2): it then
 * creates the city, records the bootstrap results with `setup.recordCloud`, deletes the bootstrap record and loads
 * `setup/status`. It satisfies the elements' `SetupPort` (`packages/ui/src/admin/setup/setup-port.ts`).
 */
import type { InstallTarget, MapboxTokenAudience, SaveUsgsRequest, SelfTestResponse, ServiceState } from '@hcm/shared';
import type { SourceToggle } from '@hcm/shared/sources';

import { createAnalyticsFlow, type AnalyticsFlow } from './analytics.js';
import { clearBootstrapRecord, readBootstrapRecord, type BootstrapRecord } from './bootstrap-record.js';
import { createBillingFlow, type BillingFlow } from './billing.js';
import { createSetupContext, createSetupStore, type SetupContext, type SetupStore } from './context.js';
import { createDeployFlow, type DeployFlow } from './deploy.js';
import { createInstallCards, type InstallCards } from './install.js';
import { createLegacyImportFlow, type LegacyImportFlow } from './legacy-import.js';
import { createMapboxFlow, type MapboxFlow } from './mapbox.js';
import { apiFailure, setupMessage, type SetupMessage } from './messages.js';
import type { SetupDeps } from './ports.js';
import { createProvisionFlow, type ProvisionFlow } from './provision.js';
import { applyBootstrapRecord, recordCloudRequestOf } from './records.js';
import {
    initialSetupState,
    refreshDerived,
    resumeStep,
    serverPrepared,
    withChecksAnswered,
    type SelfTestCheckState,
    type SetupMode,
    type SetupState,
} from './state.js';
import { createSourcesFlow, type SourcesFlow } from './sources.js';
import { SETUP_STEPS, type SetupStepId } from './steps.js';
import { createUsgsFlow, type UsgsFlow } from './usgs.js';

/** What the elements call; every intent is one user action (a click, a fill, a paste) unless it says otherwise. */
interface SetupIntents {
    /** Expands a card, or collapses every card with null (navigation, not counted). */
    open(step: SetupStepId | null): void;
    /** Check again: one card, or the whole page without a step. */
    recheck(step?: SetupStepId): Promise<void>;
    /** A fill or paste the element saw (the input budget). */
    noteInput(step: SetupStepId): void;
    /** Renews an expired Google token and resumes the step (one click, one consent). */
    continueGoogle(step: SetupStepId): Promise<void>;
    linkBilling(): Promise<void>;
    chooseBillingAccount(accountName: string): void;
    confirmBillingAccount(): Promise<void>;
    /** M6 (A60): "This account is a free trial" on the billing card (one input, no consent). */
    markTrial(): Promise<void>;
    /** Prepare the project, or Retry what failed. */
    provision(): Promise<void>;
    saveMapbox(secretToken: string): Promise<void>;
    /** Replaces a public Mapbox token, after the card's confirmation (not counted: a daily action, not a Setup input). */
    rotatePublicToken(audience: MapboxTokenAudience): Promise<void>;
    startUsgsCountdown(): void;
    /** What the USGS card's username and expiry fields hold (not counted: the element counts a filled field). */
    draftUsgs(fields: { readonly username?: string; readonly expiresOn?: string }): void;
    /** The paste of the USGS token (not counted: the element counted the paste). */
    saveUsgs(request: SaveUsgsRequest): Promise<void>;
    /** M6 setup-ux (A59): Do it later on the USGS card (one input). */
    postponeUsgs(): Promise<void>;
    /** The owner followed one of the step's deep links (not counted); the analytics card then watches for Google Analytics. */
    followLink(step: SetupStepId): void;
    disableHistoryPageViews(): Promise<void>;
    createMeasurementReports(): Promise<void>;
    setCrashEmails(enabled: boolean): Promise<void>;
    enableApi(api: string): Promise<void>;
    /** Lists the crash groups again (the panel's Retry and the `#/crashes` page). */
    loadCrashGroups(): Promise<void>;
    importLegacy(): Promise<void>;
    /** M28: one switch of the Sources step (one input). */
    chooseSource(id: SourceToggle, on: boolean): void;
    /** M28: Save my choice on the Sources step (one input). */
    saveSources(): Promise<void>;
    // [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.8, §4.1)
    /** Install the server (d): one click; it also starts the imagery pipeline (d3). */
    installServer(): Promise<void>;
    /** Publish the map (i), or Try again on an install card: one click. */
    install(target: InstallTarget): Promise<void>;
    /** Update the map: one click (one consent without a live token), counted on `step`'s card. */
    updateMap(step: SetupStepId): Promise<void>;
    /** "Install this admin's version anyway", confirmed, on the card of a target newer than the admin (a rollback). */
    installOver(target: InstallTarget): Promise<void>;
    // [end install]
}

export interface SetupController {
    getState(): SetupState;
    subscribe(listener: (state: SetupState) => void): () => void;
    readonly intents: SetupIntents;
    /** Restores (bootstrap) or loads (normal) what is known, then opens `step` (a `#/setup/<step>`) or the first incomplete one. */
    start(mode: SetupMode, step: string | null): Promise<void>;
    /** The shell's mode changed (the claim made the owner an admin): finish the bootstrap, load `setup/status`. */
    setMode(mode: SetupMode): Promise<void>;
    /** The claim's progress or refusal (d2), from the shell. */
    setClaim(state: ServiceState, detail: SetupMessage | null): void;
    /** The Setup page shows (true) or another page does: the analytics card checks Google Analytics only on its page. */
    setPageShown(shown: boolean): void;
    dispose(): void;
}

interface Flows {
    readonly billing: BillingFlow;
    readonly provision: ProvisionFlow;
    readonly deploy: DeployFlow;
    readonly mapbox: MapboxFlow;
    readonly usgs: UsgsFlow;
    readonly analytics: AnalyticsFlow;
    readonly legacyImport: LegacyImportFlow;
    readonly sources: SourcesFlow;
    readonly install: InstallCards;
}

function createFlows(ctx: SetupContext): Flows {
    const provision = createProvisionFlow(ctx);
    return {
        billing: createBillingFlow(ctx),
        provision,
        deploy: createDeployFlow(ctx, () => provision.checkScheduler()),
        mapbox: createMapboxFlow(ctx),
        usgs: createUsgsFlow(ctx),
        analytics: createAnalyticsFlow(ctx),
        legacyImport: createLegacyImportFlow(ctx),
        sources: createSourcesFlow(ctx),
        install: createInstallCards(ctx, (access, recordAfter) => provision.update(access, recordAfter)),
    };
}

const isDone = (state: SetupState, id: SetupStepId): boolean => state.steps[id].state === 'ok';

/** Finding 32: the steps the server's record answers in an admin session (the legacy import detects its own). */
const STATUS_ANSWERS: readonly SetupStepId[] = SETUP_STEPS.filter((id) => id !== 'legacyImport');

/**
 * A change after which the install cards look again: the project just prepared (for the server: finding 31, an item only
 * the imagery pipeline needs does not hold it back), the mode switched, a token appeared.
 */
function installWatchable(before: SetupState, next: SetupState): boolean {
    const prepared = !serverPrepared(before) && serverPrepared(next);
    const token = !before.liveScopes.includes('cloudPlatform') && next.liveScopes.includes('cloudPlatform');
    return prepared || token || before.mode !== next.mode;
}

/**
 * The self-test's checks as the page lists them: each state, a failure's reason (S-A03-BAD-SELFTEST-FAILURE), and the
 * model a passing AI check names (§67g, S-A45-HAPPY-FALLBACK-MODEL).
 */
function checksOf(response: SelfTestResponse): readonly SelfTestCheckState[] {
    return response.checks.map(({ id, state, detail, params }) => {
        const model = detail === undefined ? params?.['model'] : undefined;
        return { id, state, detail: detail === undefined ? null : setupMessage(detail, params), ...(model === undefined ? {} : { model }) };
    });
}

class Controller implements SetupController {
    readonly intents: SetupIntents;
    private readonly store: SetupStore;
    private readonly ctx: SetupContext;
    private readonly flows: Flows;
    private readonly unsubscribe: () => void;
    /** Whether the Setup page shows: the shell says so (`module.ts`); a controller without a shell is its own page. */
    private pageShown = true;
    /** How many times the admin (or the address) opened a card: the switch to normal mode keeps one opened while it loads. */
    private opened = 0;

    constructor(private readonly deps: SetupDeps) {
        this.store = createSetupStore(initialSetupState(deps.host, 'bootstrap'));
        this.ctx = createSetupContext(deps, this.store);
        this.flows = createFlows(this.ctx);
        this.intents = this.createIntents();
        let previous = this.store.get();
        this.unsubscribe = this.store.subscribe((next) => {
            const before = previous;
            previous = next;
            this.react(before, next);
        });
    }

    getState(): SetupState {
        return this.store.get();
    }

    subscribe(listener: (state: SetupState) => void): () => void {
        return this.store.subscribe(listener);
    }

    /**
     * The first checks, then the step to resume at; a card the admin opened while they ran stays open. In normal mode
     * the step opens as soon as the server's record is in, unless it is the legacy import, whose own detection (it reads
     * every photo) decides it: the page no longer sat with every card closed until a later step's check ended, and a
     * card that opened in the middle of reading it moved every step below it. Finding 32 of 2026-10-31: until a step's
     * first check answers (the server's record, read or refused; the import's detection; the tab's record in start-up
     * mode) its chip reads Checking….
     */
    async start(mode: SetupMode, step: string | null): Promise<void> {
        this.store.set(initialSetupState(this.deps.host, mode));
        if (mode === 'bootstrap') {
            await this.restoreBootstrap();
        } else {
            await this.loadStatus();
            await this.flows.sources.detect();
            this.ctx.update((state) => withChecksAnswered(state, STATUS_ANSWERS));
            this.resume(step, (next) => next !== 'legacyImport');
            await this.flows.legacyImport.detect();
        }
        this.ctx.update((state) => withChecksAnswered(state));
        this.resume(step, () => true);
    }

    async setMode(mode: SetupMode): Promise<void> {
        if (mode === this.store.get().mode) {
            return;
        }
        this.flows.billing.dispose();
        this.flows.deploy.dispose();
        this.ctx.update((state) => refreshDerived({ ...state, mode }));
        if (mode === 'normal') {
            // A card opened while the server's record and the import's detection load stays open, as in `start` (the
            // journey's Publish the map card, opened while the claim's detection still read the photos, became Mapbox).
            const opened = this.opened;
            await this.loadNormal();
            if (this.opened === opened) {
                this.ctx.update((state) => ({ ...state, openStep: resumeStep(state, null) }));
            }
        }
    }

    setClaim(state: ServiceState, detail: SetupMessage | null): void {
        this.ctx.patchStep('claim', { state, detail, checkedAt: this.ctx.nowIso() });
    }

    setPageShown(shown: boolean): void {
        const appeared = shown && !this.pageShown;
        this.pageShown = shown;
        if (appeared && this.store.get().openStep === 'analytics') {
            void this.flows.analytics.open();
        }
        if (appeared) {
            this.watchInstall(this.store.get());
        }
    }

    dispose(): void {
        this.unsubscribe();
        this.flows.billing.dispose();
        this.flows.deploy.dispose();
        this.flows.usgs.dispose();
        this.flows.analytics.dispose();
        this.flows.install.dispose();
    }

    /**
     * Follow-ups of a change: the analytics card loads when it opens on the Setup page (the controller runs on every page of
     * an admin session, and a check there only filled every page's console with Google Analytics' "not enabled"); the
     * deployment is watched once provisioning is done.
     */
    private react(before: SetupState, next: SetupState): void {
        if (this.analyticsOpened(before, next)) {
            void this.flows.analytics.open();
        }
        if (next.mode === 'bootstrap' && !serverPrepared(before)) {
            this.watchDeployment(next);
        }
        if (installWatchable(before, next)) {
            this.watchInstall(next);
        }
    }

    /**
     * M6: the install cards follow their targets once the project is prepared, with the live token only: in start-up
     * mode the server and the pipeline, in an admin session also the site, and only on the Setup page.
     */
    private watchInstall(state: SetupState): void {
        if (!serverPrepared(state) || (state.mode === 'normal' && !this.pageShown)) {
            return;
        }
        this.flows.install.watch(state.mode === 'normal' ? ['server', 'pipeline', 'site'] : ['server', 'pipeline']);
    }

    private analyticsOpened(before: SetupState, next: SetupState): boolean {
        return this.pageShown && before.openStep !== next.openStep && next.openStep === 'analytics';
    }

    private watchDeployment(state: SetupState): void {
        if (serverPrepared(state) && !isDone(state, 'deploy')) {
            this.flows.deploy.watch();
        }
    }

    private async restoreBootstrap(): Promise<void> {
        const record = readBootstrapRecord(this.deps.session, this.deps.host.projectId);
        if (record !== null) {
            this.ctx.update((state) => applyBootstrapRecord(state, record));
        }
        // In start-up mode the tab's record is what is known: every step's first check has answered (finding 32).
        this.ctx.update((state) => withChecksAnswered(state));
        this.ctx.mirrorBootstrap();
        this.ctx.patchStep('signIn', { state: 'ok', detail: null, checkedAt: this.ctx.nowIso() });
        await this.flows.billing.detectApis();
        this.watchDeployment(this.store.get());
    }

    private async loadNormal(): Promise<void> {
        await this.loadStatus();
        await this.flows.sources.detect();
        await this.flows.legacyImport.detect();
    }

    /** What the bootstrap left for the server (after the claim), then the server's record. */
    private async loadStatus(): Promise<void> {
        const record = readBootstrapRecord(this.deps.session, this.deps.host.projectId);
        if (record !== null) {
            await this.finishBootstrap(record);
        }
        await this.refreshStatus();
    }

    /** Opens the step to resume at (the one the address named, else the first not done) unless a card is open or `ready` says wait. */
    private resume(step: string | null, ready: (next: SetupStepId | null) => boolean): void {
        this.ctx.update((state) => {
            const next = resumeStep(state, step);
            return state.openStep === null && ready(next) ? { ...state, openStep: next } : state;
        });
    }

    /** (d2) after the claim: the city, then what the bootstrap found; the record goes once the server holds it. */
    private async finishBootstrap(record: BootstrapRecord): Promise<void> {
        try {
            await this.deps.backend.createCity();
            const request = recordCloudRequestOf(record);
            if (request !== null) {
                await this.deps.backend.recordCloud(request);
            }
            clearBootstrapRecord(this.deps.session, this.deps.host.projectId);
        } catch (error) {
            this.ctx.fail('claim', apiFailure(error));
        }
    }

    private async refreshStatus(): Promise<void> {
        try {
            this.ctx.applyStatus(await this.deps.backend.status());
            this.ctx.update((state) => refreshDerived({ ...state, error: null, serverOutdated: false }));
        } catch (error) {
            const { message } = apiFailure(error);
            const serverOutdated = message.key === 'apiError.serverOutdated';
            this.ctx.update((state) => refreshDerived({ ...state, error: message, serverOutdated }));
            if (serverOutdated) {
                this.serverAnswers();
            }
        }
    }

    /**
     * Finding 27: a server that answered in an older shape is there, and it answers this admin, so the sign-in, the
     * server and the claim are done, as `setup/status` would have said; what it recorded of the rest stays unknown.
     */
    private serverAnswers(): void {
        const done = { state: 'ok' as const, detail: null, checkedAt: this.ctx.nowIso() };
        for (const step of ['signIn', 'deploy', 'claim'] as const) {
            this.ctx.patchStep(step, done);
        }
    }

    private async recheckPage(): Promise<void> {
        if (this.store.get().mode === 'bootstrap') {
            await this.restoreBootstrap();
            return;
        }
        this.ctx.update((state) => ({ ...state, checking: true }));
        try {
            const response = await this.deps.backend.selfTest();
            this.ctx.applyStatus(response.status);
            this.ctx.update((state) => ({ ...state, error: null, selfTest: { checks: checksOf(response) } }));
        } catch (error) {
            const { message } = apiFailure(error);
            this.ctx.update((state) => ({ ...state, error: message }));
        }
        await this.flows.legacyImport.detect();
        this.ctx.update((state) => ({ ...state, checking: false }));
    }

    /** Check again on one card: the step's own detection (a Google step asks for its consent again). */
    private async recheckStep(step: SetupStepId): Promise<void> {
        const normal = this.store.get().mode === 'normal';
        const own: Partial<Record<SetupStepId, () => Promise<void>>> = {
            billing: () => this.flows.billing.link(),
            provision: () => (normal ? this.flows.provision.recheck() : this.flows.provision.run()),
            deploy: () => this.flows.deploy.recheck(),
            pipeline: () => this.flows.install.recheck('pipeline'),
            site: () => this.flows.install.recheck('site'),
        };
        const action = own[step];
        if (action !== undefined) {
            await action();
            return;
        }
        this.ctx.count(step, 'inputs');
        await this.recheckServer(step, normal);
    }

    private async recheckServer(step: SetupStepId, normal: boolean): Promise<void> {
        if (!normal) {
            return;
        }
        const checks: Partial<Record<SetupStepId, () => Promise<void>>> = {
            claim: () => this.loadNormal(),
            analytics: () => this.flows.analytics.open(),
            legacyImport: () => this.flows.legacyImport.detect(),
            sources: () => this.flows.sources.detect(),
        };
        await (checks[step] ?? (() => this.recheckPage()))();
    }

    private async continueGoogle(step: SetupStepId): Promise<void> {
        const resume: Partial<Record<SetupStepId, () => Promise<void>>> = {
            billing: () => this.flows.billing.link(),
            provision: () => this.flows.provision.run(),
            deploy: () => this.flows.deploy.recheck(),
            pipeline: () => this.flows.install.recheck('pipeline'),
            site: () => this.flows.install.recheck('site'),
        };
        const action = resume[step];
        if (action === undefined) {
            this.ctx.patchStep(step, { needsContinue: false, error: null });
            return;
        }
        await action();
    }

    private createIntents(): SetupIntents {
        const { billing, provision, mapbox, usgs, analytics, legacyImport } = this.flows;
        return {
            open: (step) => {
                this.opened += 1;
                this.ctx.update((state) => ({ ...state, openStep: step }));
            },
            recheck: (step) => (step === undefined ? this.recheckPage() : this.recheckStep(step)),
            noteInput: (step) => {
                this.ctx.count(step, 'inputs');
            },
            continueGoogle: (step) => this.continueGoogle(step),
            linkBilling: () => billing.link(),
            chooseBillingAccount: (accountName) => {
                billing.choose(accountName);
            },
            confirmBillingAccount: () => billing.confirm(),
            markTrial: () => billing.markTrial(),
            provision: () => provision.run(),
            saveMapbox: (secretToken) => mapbox.save(secretToken),
            rotatePublicToken: (audience) => mapbox.rotate(audience),
            startUsgsCountdown: () => {
                usgs.startCountdown();
            },
            draftUsgs: (fields) => {
                this.ctx.update((state) => ({ ...state, usgs: { ...state.usgs, ...fields } }));
            },
            saveUsgs: (request) => usgs.save(request),
            postponeUsgs: () => usgs.postpone(),
            followLink: (step) => {
                if (step === 'analytics') {
                    analytics.followLink();
                }
            },
            disableHistoryPageViews: () => analytics.disablePageChanges(),
            createMeasurementReports: () => analytics.createReports(),
            setCrashEmails: (enabled) => analytics.setCrashEmails(enabled),
            enableApi: (api) => analytics.enableApi(api),
            loadCrashGroups: () => analytics.loadCrashGroups(),
            importLegacy: () => legacyImport.run(),
            chooseSource: (id, on) => {
                this.flows.sources.choose(id, on);
            },
            saveSources: () => this.flows.sources.save(),
            installServer: async () => {
                await this.flows.install.installServer();
                this.flows.deploy.watch();
            },
            install: (target) => this.flows.install.install(target),
            updateMap: (step) => this.flows.install.updateMap(step),
            installOver: (target) => this.flows.install.installOver(target),
        };
    }
}

/** The Setup Assistant over its ports; `start` it with the shell's mode and the requested step. */
export function createSetupController(deps: SetupDeps): SetupController {
    return new Controller(deps);
}
