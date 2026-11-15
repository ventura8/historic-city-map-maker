/**
 * The Setup Assistant's state (`docs/research/M2b-interfaces.md` §3): one record per step of `SETUP_STEPS` (health,
 * the last action's failure, availability, the in-app inputs and Google consents counted so far against the step's
 * budget) and one slice per card. It holds no secret, token or e-mail address: pasted tokens go straight from the
 * paste box to their callable. `packages/ui/src/admin/setup/setup-port.ts` mirrors these types for the elements.
 */
import {
    BACKGROUND_FUNCTIONS,
    CALLABLE_NAMES,
    HTTP_ENDPOINTS,
    MAPBOX_BOOTSTRAP_SCOPES,
    PROVISION_ITEMS,
    type MapboxTokenAudience,
    type ProvisionItem,
    type SelfTestCheck,
    type ServiceState,
    type UsgsRole,
} from '@hcm/shared';

import type { GoogleScope } from '../google/scopes.js';
import { initialInstallSlice, type InstallSlice } from '../install/model.js';
import { DEFAULT_BUDGET_CURRENCY, budgetAmountFor } from './budget.js';
import { setupLink, stepLinks, type SetupLinkView } from './links.js';
import type { SetupMessage } from './messages.js';
import type { BillingAccount, LegacyImportFailure, SetupHost } from './ports.js';
import { NO_SOURCES, hiddenSteps, usgsPart, withPlatform, type SourcesSlice } from './sources-state.js';
import { SETUP_STEP_SPECS, SETUP_STEPS, nextSetupStep, type SetupStepId, type SetupStepSpec } from './steps.js';

export type SetupMode = 'bootstrap' | 'normal';

export interface StepCounts {
    readonly inputs: number;
    readonly consents: number;
}

interface SetupStepState {
    readonly id: SetupStepId;
    readonly letter: SetupStepSpec['letter'];
    readonly state: ServiceState;
    /** ISO 8601 of the last check, or null. */
    readonly checkedAt: string | null;
    /** Why the step is in its state (a recorded reason). */
    readonly detail: SetupMessage | null;
    /** The last action's failure, shown until the next action (it never overwrites a working state). */
    readonly error: SetupMessage | null;
    /** Its prerequisites are done and the mode allows it (a step that needs the server waits for normal mode). */
    readonly available: boolean;
    /** The step waits for the server in bootstrap mode (`SETUP_STEP_SPECS`). */
    readonly needsBackend: boolean;
    readonly optional: boolean;
    readonly busy: boolean;
    /** The Google token expired: Continue (one click, one consent) resumes the step (§1.5). */
    readonly needsContinue: boolean;
    /** M6 setup-ux (`docs/research/M6-interfaces.md` §4.1): the owner chose Do it later (USGS); the chip reads Later. */
    readonly postponed: boolean;
    /**
     * Finding 27 of 2026-10-31: the server's record of the step is unknown because the server is older than the admin; the
     * chip reads "Update the server to check", never "To do" (derived: `refreshDerived`).
     */
    readonly unknown: boolean;
    /**
     * Finding 32 of 2026-10-31: the step's first check since the page loaded has not answered yet (the server's record, the
     * tab's bootstrap record, the step's own detection): the chip reads "Checking…", never "To do".
     */
    readonly firstCheck: boolean;
    /** The scope the step's next Google popup asks for (the consent note explains it), or null. */
    readonly scope: GoogleScope | null;
    readonly links: readonly SetupLinkView[];
    /** In-app inputs and Google consents counted so far (the e2e input budget reads them). */
    readonly used: StepCounts;
    /** The happy-path limits of `SETUP_STEP_SPECS`. */
    readonly budget: StepCounts;
}

export interface BillingSlice {
    readonly amount: number;
    readonly currency: string;
    /** The open accounts to choose from (several), with their display names, in memory only. */
    readonly accounts: readonly BillingAccount[];
    readonly chosen: string | null;
    /** No open account yet: the card lists them every 10 s. */
    readonly waitingForAccount: boolean;
    readonly accountName: string | null;
    readonly budgetId: string | null;
    /** Cloud Billing or the Budget API is disabled: the popup asks `cloudPlatform` and enables them first. */
    readonly needsPlatform: boolean;
    /** M6 setup-ux (A60): an account appeared while the card waited, a likely free trial since then (ISO), or null. */
    readonly trialSince: string | null;
    /** M6 setup-ux (finding 3): Google's page that creates a billing account (the card's primary action while it waits). */
    readonly createUrl: string;
}

export interface ProvisionItemState {
    readonly id: ProvisionItem;
    readonly state: ServiceState;
    readonly detail: SetupMessage | null;
}

interface DeployVariable {
    readonly name: string;
    readonly value: string;
}

export interface DeploySlice {
    readonly ready: number;
    readonly total: number;
    readonly failed: readonly string[];
    /** The repository variables the deploy job reads (copy buttons). */
    readonly variables: readonly DeployVariable[];
    readonly watching: boolean;
}

/** The last replacement of a public token (`setup.rotatePublicToken`, the panic button of security review §1.3). */
export interface RotationState {
    readonly audience: MapboxTokenAudience | null;
    readonly busy: boolean;
    /** When the replaced token is deleted (null: there was none, or nothing was replaced yet). */
    readonly retiresOldAt: string | null;
    readonly done: boolean;
    readonly error: SetupMessage | null;
}

interface MapboxSlice {
    readonly user: string | null;
    readonly requiredScopes: readonly string[];
    readonly rotation: RotationState;
}

/** One check of the last self-test (Check again in normal mode): its state and, when it failed, why. */
export interface SelfTestCheckState {
    readonly id: SelfTestCheck;
    readonly state: ServiceState;
    readonly detail: SetupMessage | null;
    /** §67g: the model a passing AI check found offered (`params.model`), named under the check. */
    readonly model?: string;
}

export interface UsgsSlice {
    /** Seconds left to paste the token, or null when no countdown runs. */
    readonly secondsLeft: number | null;
    readonly expired: boolean;
    readonly tokenPageUrl: string;
    readonly role: UsgsRole | null;
    readonly nextCheckAt: string | null;
    readonly tokenExpiresAt: string | null;
    /** The token expires within `USGS_EXPIRY_REMINDER_DAYS`. */
    readonly expiresSoon: boolean;
    /** The city's bounding box for the access request ("west, south, east, north"), or null. */
    readonly area: string | null;
    /**
     * The ERS username and the optional expiry date as typed, kept here so a layout change (a rotated tablet re-creates
     * the card) loses neither; the application token never enters the state.
     */
    readonly username: string;
    readonly expiresOn: string;
    /** M6 setup-ux (A59): when the owner chose Do it later (ISO), or null. */
    readonly postponedAt: string | null;
    /** M6 setup-ux: since when the saved token waits for USGS's M2M approval (ISO), or null. */
    readonly pendingSince: string | null;
}

interface AnalyticsSlice {
    readonly measurementId: string | null;
    readonly pageChangesOff: boolean;
    readonly crashEmails: boolean;
    /** Checking every 15 s after the owner followed the link to enable Google Analytics. */
    readonly watching: boolean;
    /** §76f: what the last Create the measurement reports registered and found there, or null before one. */
    readonly reports: { readonly created: number; readonly skipped: number } | null;
}

export interface CrashGroupView {
    readonly groupId: string;
    /** Redacted by the server; shown as text only. */
    readonly message: string;
    readonly service: string;
    readonly count: number;
    readonly lastSeen: string;
}

export interface CrashSlice {
    readonly loaded: boolean;
    readonly busy: boolean;
    readonly groups: readonly CrashGroupView[];
    readonly error: SetupMessage | null;
    /** The API to enable when Error Reporting is disabled (`apiError.cloud.apiDisabled`), or null. */
    readonly disabledApi: string | null;
    readonly lastReportAt: string | null;
}

interface ImportSlice {
    readonly done: number;
    readonly total: number;
    readonly failed: readonly LegacyImportFailure[];
    readonly running: boolean;
    /** Photos on the map the old site's direction is still to be added to (`../import/legacy-fixes.ts`); none when absent. */
    readonly directions?: number;
    /** The city's credits do not name every old photo's author yet. */
    readonly credits?: boolean;
}

export interface SetupState {
    readonly mode: SetupMode;
    /** M29: the city's rectangle (west, south, east, north) for the imagery census of the first card; null when none is known. */
    readonly cityBBox?: readonly [number, number, number, number] | null;
    readonly projectId: string;
    readonly authDomain: string;
    /** The expanded card: the first incomplete step unless the address or a click named another. */
    readonly openStep: SetupStepId | null;
    /** Screen order (derived: this project's steps without the ones its sources leave out, M28). */
    readonly order: readonly SetupStepId[];
    /** This project's steps (a project of the owner's own has no legacy import). */
    readonly stepOrder: readonly SetupStepId[];
    readonly steps: Readonly<Record<SetupStepId, SetupStepState>>;
    readonly done: number;
    readonly total: number;
    /**
     * Setup is done (`setupDone` of `@hcm/shared`, M6): billing, provisioning and Mapbox are ok, and USGS is ok, postponed or
     * waiting for the approval of a saved token.
     */
    readonly ready: boolean;
    /** M6 setup-ux: the steps postponed and not done ("8 of 9 done, 1 for later"). */
    readonly later: number;
    /** M6 setup-ux: what "done" leaves open: USGS's approval, or USGS for later; null when nothing. */
    readonly doneNote: 'usgsPending' | 'usgsLater' | null;
    /** M6 setup-ux (finding 7): the Google scopes a live token holds now, so a card shows the consent note only when its button will ask. */
    readonly liveScopes: readonly GoogleScope[];
    /** A whole-page check runs. */
    readonly checking: boolean;
    /** Finding 32 of 2026-10-31: a step's first check has not answered yet (derived): the header says Checking…, not "0 of 11". */
    readonly loading: boolean;
    /** Why the page could not load or record `setup/status` (normal mode), or null. */
    readonly error: SetupMessage | null;
    /** Finding 27: `setup/status` answered in a shape older than the admin reads (`apiError.serverOutdated`). */
    readonly serverOutdated: boolean;
    readonly used: StepCounts;
    readonly billing: BillingSlice;
    /**
     * The doctor's items; `setVersion` (finding 65 of 2026-11-02): the version of Provision's item set the project was last
     * brought to (`setup/status`), absent before it was recorded.
     */
    readonly provision: { readonly items: readonly ProvisionItemState[]; readonly setVersion?: number };
    readonly deploy: DeploySlice;
    readonly mapbox: MapboxSlice;
    readonly usgs: UsgsSlice;
    readonly analytics: AnalyticsSlice;
    readonly crashes: CrashSlice;
    readonly legacyImport: ImportSlice;
    readonly sources: SourcesSlice;
    // [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.7): the server, the pipeline, the site.
    readonly install: InstallSlice;
    // [end install]
    /** The checks of the last self-test, in `SELF_TEST_CHECKS` order (none before Check again ran it). */
    readonly selfTest: { readonly checks: readonly SelfTestCheckState[] };
}

export type StepPatch = Partial<
    Pick<SetupStepState, 'state' | 'checkedAt' | 'detail' | 'error' | 'busy' | 'needsContinue' | 'scope' | 'postponed'>
>;

/** The steps that must be done whatever USGS is (USGS's own part: `usgsReadiness`, M6). */
const REQUIRED_STEPS: readonly SetupStepId[] = ['billing', 'provision', 'mapbox'];

/** No public token replaced yet. */
const NO_ROTATION: RotationState = { audience: null, busy: false, retiresOldAt: null, done: false, error: null };

/** Every function the deployment step waits for: the callables (the worker's included), the HTTPS endpoints and the triggers. */
export const REGISTRY_FUNCTION_COUNT =
    CALLABLE_NAMES.length + Object.keys(HTTP_ENDPOINTS).length + Object.keys(BACKGROUND_FUNCTIONS).length;

const SEVERITY: Readonly<Record<ServiceState, number>> = { ok: 0, pending: 1, missing: 2, unavailable: 3, invalid: 4 };

/** The worst of `states` (`invalid` > `unavailable` > `missing` > `pending` > `ok`); `ok` for none. */
export function worstState(states: readonly ServiceState[]): ServiceState {
    return states.reduce<ServiceState>((worst, state) => (SEVERITY[state] > SEVERITY[worst] ? state : worst), 'ok');
}

/** The provisioning card's state: the worst item, except the scheduler, which only the first deploy creates. */
export function provisionHealth(items: readonly { readonly id: ProvisionItem; readonly state: ServiceState }[]): ServiceState {
    return worstState(items.filter((item) => !(item.id === 'scheduler' && item.state === 'pending')).map((item) => item.state));
}

/**
 * Finding 31 of 2026-10-31: the Provision items only the optional imagery pipeline needs (the Docker repository `hcm`
 * and the installer's writer role on it, both the `artifact-registry` item's); Install the server never waits for them.
 */
const PIPELINE_ONLY_ITEMS: ReadonlySet<ProvisionItem> = new Set<ProvisionItem>(['artifact-registry']);

/**
 * Step (c) is done, or every item the server needs is (finding 31): Install the server (d) may run, the install cards
 * may look and the deployment may be watched, while an item only the imagery pipeline needs still fails. The pipeline's
 * own card says what it lacks (`apiError.install.noRepository`, linking step c).
 */
export function serverPrepared(state: Pick<SetupState, 'steps' | 'provision'>): boolean {
    if (state.steps.provision.state === 'ok') {
        return true;
    }
    return provisionHealth(state.provision.items.filter((item) => !PIPELINE_ONLY_ITEMS.has(item.id))) === 'ok';
}

/** CR-M5-7: the repository variables exist only for a project that names a repository. */
function deployVariables(projectId: string, projectNumber: string, github: boolean): readonly DeployVariable[] {
    if (!github) {
        return [];
    }
    return [
        {
            name: 'GCP_WIF_PROVIDER',
            value: `projects/${projectNumber}/locations/global/workloadIdentityPools/github/providers/site-master`,
        },
        { name: 'GCP_DEPLOY_SA', value: `gh-deployer@${projectId}.iam.gserviceaccount.com` },
        { name: 'GCP_PROJECT_ID', value: projectId },
        { name: 'DEPLOY_ENABLED', value: 'true' },
    ];
}

/**
 * The steps whose own card opens a Google popup. Sign-in and the claim open theirs from the shell's panels, which carry
 * their own consent note, so their cards name no scope.
 */
const CARD_POPUP_STEPS: ReadonlySet<SetupStepId> = new Set(['billing', 'provision', 'deploy', 'analytics', 'pipeline', 'site']);

/** The steps of this project: a project of the owner's own has no bundled old photos to import (CR-M5-7, M14 §8). */
function stepsOf(host: Pick<SetupHost, 'github'>): readonly SetupStepId[] {
    return host.github ? SETUP_STEPS : SETUP_STEPS.filter((id) => id !== 'legacyImport');
}

function initialStep(id: SetupStepId, projectId: string): SetupStepState {
    const spec = SETUP_STEP_SPECS[id];
    return {
        id,
        letter: spec.letter,
        state: 'missing',
        checkedAt: null,
        detail: null,
        error: null,
        available: false,
        needsBackend: spec.needsBackend,
        optional: spec.optional,
        busy: false,
        needsContinue: false,
        postponed: false,
        unknown: false,
        firstCheck: true,
        scope: CARD_POPUP_STEPS.has(id) ? spec.scope : null,
        links: stepLinks(id, projectId),
        used: { inputs: 0, consents: 0 },
        budget: { inputs: spec.inputs, consents: spec.consents },
    };
}

function areaOf(bbox: SetupHost['cityBBox']): string | null {
    return bbox === null ? null : bbox.map((value) => value.toFixed(4)).join(', ');
}

/** A fresh state for `host`'s project in `mode` (nothing detected yet). */
export function initialSetupState(host: SetupHost, mode: SetupMode): SetupState {
    const steps = Object.fromEntries(SETUP_STEPS.map((id) => [id, initialStep(id, host.projectId)])) as Record<SetupStepId, SetupStepState>;
    return refreshDerived({
        mode,
        projectId: host.projectId,
        authDomain: host.authDomain,
        cityBBox: host.cityBBox,
        openStep: null,
        ...{ order: stepsOf(host), stepOrder: stepsOf(host), steps },
        done: 0,
        total: stepsOf(host).length,
        ready: false,
        later: 0,
        doneNote: null,
        liveScopes: [],
        ...{ checking: false, loading: true, serverOutdated: false, error: null },
        used: { inputs: 0, consents: 0 },
        billing: {
            amount: budgetAmountFor(DEFAULT_BUDGET_CURRENCY),
            currency: DEFAULT_BUDGET_CURRENCY,
            accounts: [],
            chosen: null,
            waitingForAccount: false,
            accountName: null,
            budgetId: null,
            needsPlatform: false,
            trialSince: null,
            createUrl: setupLink('gcp.billingCreate').url,
        },
        provision: { items: PROVISION_ITEMS.map((id) => ({ id, state: 'missing', detail: null })) },
        deploy: {
            ready: 0,
            total: REGISTRY_FUNCTION_COUNT,
            failed: [],
            variables: deployVariables(host.projectId, host.projectNumber, host.github),
            watching: false,
        },
        mapbox: { user: null, requiredScopes: MAPBOX_BOOTSTRAP_SCOPES, rotation: NO_ROTATION },
        usgs: {
            secondsLeft: null,
            expired: false,
            tokenPageUrl: setupLink('usgs.applicationToken').url,
            role: null,
            nextCheckAt: null,
            tokenExpiresAt: null,
            expiresSoon: false,
            area: areaOf(host.cityBBox),
            username: '',
            expiresOn: '',
            postponedAt: null,
            pendingSince: null,
        },
        analytics: { measurementId: null, pageChangesOff: false, crashEmails: true, watching: false, reports: null },
        crashes: { loaded: false, busy: false, groups: [], error: null, disabledApi: null, lastReportAt: null },
        legacyImport: { done: 0, total: 0, failed: [], running: false },
        sources: NO_SOURCES,
        install: initialInstallSlice(host.release, host.siteAddress, host.releaseTime),
        selfTest: { checks: [] },
    });
}

function doneSteps(state: SetupState): ReadonlySet<SetupStepId> {
    return new Set(state.order.filter((id) => state.steps[id].state === 'ok'));
}

/** The steps postponed and not done (M6 setup-ux, A59). */
function laterSteps(state: SetupState): readonly SetupStepId[] {
    return state.order.filter((id) => state.steps[id].postponed && state.steps[id].state !== 'ok');
}

/**
 * The steps the next one to open comes after: the done ones, the postponed ones (CR-M6-4: a postponed step waits) and the
 * ones the sources leave out (M28).
 */
function settledSteps(state: SetupState): ReadonlySet<SetupStepId> {
    return new Set([...doneSteps(state), ...laterSteps(state), ...hiddenSteps(state)]);
}

const DONE_NOTES: Readonly<Record<ReturnType<typeof usgsPart>, SetupState['doneNote']>> = {
    ok: null,
    postponed: 'usgsLater',
    approvalPending: 'usgsPending',
    toDo: null,
};

function isAvailable(id: SetupStepId, mode: SetupMode, done: ReadonlySet<SetupStepId>): boolean {
    const spec = SETUP_STEP_SPECS[id];
    return (mode === 'normal' || !spec.needsBackend) && spec.after.every((before) => done.has(before));
}

function sumCounts(counts: readonly StepCounts[]): StepCounts {
    return counts.reduce((total, count) => ({ inputs: total.inputs + count.inputs, consents: total.consents + count.consents }), {
        inputs: 0,
        consents: 0,
    });
}

/** The installer's states in which a target counts as installed (as `setupDone` reads `setup/status.install`). */
const INSTALLED_STATES: ReadonlySet<string> = new Set(['installed', 'updateAvailable', 'newerInstalled']);

/**
 * The install part of "done" (M6 §4.1, CR-M6-13): the server and the public map installed. A target nothing has looked
 * at or recorded yet (`checkedAt` null: a map from before M6, a page without a Google token) does not hold it back,
 * as `setupDone` reads a `setup/status` without `install`; nor does an update under way or stopped while a release is
 * installed (finding 5 of the M6 review), as `setupDone` reads a recorded release.
 */
function installDone(state: SetupState): boolean {
    return (['server', 'site'] as const).every((target) => {
        const view = state.install[target];
        return view.checkedAt === null || INSTALLED_STATES.has(view.state) || view.installedRelease !== null;
    });
}

/** The steps whose state, in start-up mode, only the server's record (`setup/status`) knows. */
const STATUS_STEPS: ReadonlySet<SetupStepId> = new Set(['deploy', 'claim', 'mapbox', 'usgs', 'analytics', 'legacyImport']);

/**
 * Finding 27 of 2026-10-31: the server in place is older than the admin, so what it recorded is unknown. Its record was
 * unreadable (`all`: in an admin session every step's state comes from it), or, in start-up mode, the install card reads
 * the server as an update (`status`: the steps only its record knows); null: the server can say.
 */
function serverBehind(state: SetupState): 'all' | 'status' | null {
    if (state.serverOutdated) {
        return 'all';
    }
    return state.mode === 'bootstrap' && state.install.server.state === 'updateAvailable' ? 'status' : null;
}

/** A step no check has seen while the server is too old to say what it recorded (never "To do"). */
function unknownStep(step: SetupStepState, behind: 'all' | 'status' | null): boolean {
    const decided = behind === 'all' || (behind === 'status' && STATUS_STEPS.has(step.id));
    return decided && step.state === 'missing' && step.checkedAt === null;
}

/**
 * The steps the later ones may follow: the done ones, and (c) once the server's items are (finding 31) or a server is in place but
 * older than the admin (2026-11-13: (b) and (c) then read "Update the server to check", and (d), which offers that update, waited
 * for them: the owner could never update). A server in place proves the project was prepared.
 */
function reachedSteps(state: SetupState, done: ReadonlySet<SetupStepId>): ReadonlySet<SetupStepId> {
    return serverPrepared(state) || serverBehind(state) !== null ? new Set([...done, 'provision']) : done;
}

/** Recomputes what follows from the steps: availability, the progress, `ready` and the totals. */
export function refreshDerived(current: SetupState): SetupState {
    const order = current.stepOrder.filter((id) => !hiddenSteps(current).includes(id));
    const state = { ...current, order, total: order.length, steps: withPlatform(current.steps) };
    const done = doneSteps(state);
    const reached = reachedSteps(state, done);
    const behind = serverBehind(state);
    const steps = Object.fromEntries(
        SETUP_STEPS.map((id) => {
            const step = state.steps[id];
            return [id, { ...step, available: isAvailable(id, state.mode, reached), unknown: unknownStep(step, behind) }];
        }),
    ) as Record<SetupStepId, SetupStepState>;
    const usgs = usgsPart(state);
    const ready = REQUIRED_STEPS.every((id) => done.has(id)) && usgs !== 'toDo' && installDone(state);
    return {
        ...state,
        steps,
        done: done.size,
        loading: state.order.some((id) => steps[id].firstCheck),
        ready,
        later: laterSteps(state).length,
        doneNote: ready ? DONE_NOTES[usgs] : null,
        used: sumCounts(state.order.map((id) => state.steps[id].used)),
    };
}

/**
 * A green step whose card still offers part of the step: the analytics card turns green with the measurement id, while
 * its GA4 stream setting (the step's one input) is still to do, so it stays open (CR-M2b-33).
 */
function keepsOpen(state: SetupState, id: SetupStepId): boolean {
    return id === 'analytics' && !state.analytics.pageChangesOff;
}

/** A patch that answers the step's check: it carries the check's time, or a failure (finding 32: no more Checking…). */
function answersCheck(patch: StepPatch): boolean {
    return patch.checkedAt !== undefined || (patch.error ?? null) !== null;
}

/** The step with `patch` applied; its first check ends with a patch that answers it. */
function patched(step: SetupStepState, patch: StepPatch): SetupStepState {
    return { ...step, ...patch, firstCheck: step.firstCheck && !answersCheck(patch) };
}

/** `state` with `patch` applied to step `id`; the step that was open and just turned ok hands over to the next one. */
export function withStep(state: SetupState, id: SetupStepId, patch: StepPatch): SetupState {
    const before = state.steps[id];
    const next = refreshDerived({ ...state, steps: { ...state.steps, [id]: patched(before, patch) } });
    const finished = state.openStep === id && before.state !== 'ok' && next.steps[id].state === 'ok' && !keepsOpen(next, id);
    return finished ? { ...next, openStep: nextSetupStep(settledSteps(next)) } : next;
}

/**
 * Finding 32 of 2026-10-31: the first checks of `ids` (every step by default) have answered, whatever they found (the
 * server's record read or refused, the tab's record restored): their chips leave Checking….
 */
export function withChecksAnswered(state: SetupState, ids: readonly SetupStepId[] = state.order): SetupState {
    const steps = Object.fromEntries(
        SETUP_STEPS.map((id) => [id, ids.includes(id) ? { ...state.steps[id], firstCheck: false } : state.steps[id]]),
    ) as Record<SetupStepId, SetupStepState>;
    return refreshDerived({ ...state, steps });
}

/**
 * Counts one in-app input or Google consent on step `id`. An input starts a new attempt, so the card's last failure goes
 * (finding 49 of 2026-11-01: step g's "unavailable" stayed under the reports a later click created); the attempt shows
 * its own.
 */
export function withCount(state: SetupState, id: SetupStepId, kind: keyof StepCounts): SetupState {
    const step = state.steps[id];
    const used = { ...step.used, [kind]: step.used[kind] + 1 };
    const error = kind === 'inputs' ? null : step.error;
    return refreshDerived({ ...state, steps: { ...state.steps, [id]: { ...step, used, error } } });
}

/** The step to open: the requested one when it exists, else the first incomplete one. */
export function resumeStep(state: SetupState, requested: string | null): SetupStepId | null {
    const named = state.order.find((id) => id === requested);
    return named ?? nextSetupStep(settledSteps(state));
}
