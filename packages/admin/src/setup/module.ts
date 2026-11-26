/**
 * The Setup Assistant as the admin's `mount` takes it (admin-shell's `SetupModuleSpec`, `packages/admin/src/app/services.ts`):
 * `initial` is the state before the controller exists, `create(shell)` builds the controller over the shell's services
 * and returns its intents (`AdminIntents.setup`). The controller's state goes to `AdminState.setup` on every change; the
 * controller starts when the shell reaches start-up mode (`bootstrap`) or an admin session (`admin`), switches to normal
 * mode after the claim, and opens the step a `#/setup/<step>` address names. The entry passes what the shell does not
 * know: google-clients' Cloud port and legacy importer, `setup.createCity` (CR-M2b-1) and the city.
 */
import {
    isContributorOnly,
    type AdminCallableName,
    type CallableRequest,
    type CallableResponse,
    type CityRole,
    type Logger,
} from '@hcm/shared';

import type { GoogleScope } from '../google/scopes.js';
import type { InstallerPort } from '../install/ports.js';
import { createSetupController, type SetupController } from './controller.js';
import { MIN_TOKEN_LIFE_MS } from './google-access.js';
import type {
    GoogleAccess,
    SessionStore,
    SetupBackend,
    SetupClock,
    SetupCloud,
    SetupDeps,
    SetupGoogleAuth,
    SetupHost,
    SetupLegacyImport,
    SetupSourcesPort,
    SetupNotice,
    VisibilityPort,
} from './ports.js';
import type { SetupMode, SetupState } from './state.js';
import { SETUP_STEPS, type SetupStepId } from './steps.js';

/** The shell's Google consent answer (admin-shell's `GoogleOutcome`); a failure is already in the snackbar. */
type ShellGoogleOutcome =
    { readonly granted: true; readonly access: GoogleAccess | null } | { readonly granted: false; readonly failure: string };

interface SetupCallables {
    call<N extends AdminCallableName>(name: N, request: CallableRequest<N>): Promise<CallableResponse<N>>;
}

/** What the module reads of the admin's state. */
interface ShellView {
    readonly auth: string;
    readonly route: { readonly id: string; readonly params: readonly string[] };
    readonly cities?: readonly { readonly id: string; readonly role: CityRole }[];
}

/** The shell's services the Setup Assistant uses: a part of admin-shell's `ShellServices`. */
export interface SetupShell {
    readonly config: { readonly projectId: string; readonly authDomain: string; readonly messagingSenderId: string };
    readonly firebase: { readonly callables: SetupCallables };
    readonly clock: SetupClock;
    readonly session: SessionStore;
    readonly visibility: VisibilityPort;
    readonly log: Logger;
    readonly google: {
        request(scope: GoogleScope): Promise<ShellGoogleOutcome>;
        live(scope: GoogleScope, minRemainingMs?: number): GoogleAccess | null;
        drop(): void;
    };
    getState(): ShellView;
    subscribe(listener: (state: ShellView) => void): () => void;
    setSetup(setup: SetupState): void;
    /** Step (d) saw every function `ACTIVE`: the shell probes, claims and switches to normal mode; true when it answered. */
    serverReady(): Promise<boolean>;
    /** The shell's snackbar (M6 setup-ux: the legacy import's end). */
    notify(notice: SetupNotice): void;
}

export interface SetupModuleOptions {
    /** google-clients' `createSetupCloud(...)`. */
    readonly cloud: SetupCloud;
    /** google-clients' `createLegacyImport(...)`. */
    readonly importer: SetupLegacyImport;
    /** M28: the city's sources (`cities/{city}.sources`, the Firestore SDK; `app/setup-wiring.ts`). */
    readonly sources: SetupSourcesPort;
    /** `setup.createCity` with the bundled city (CR-M2b-1; the entry calls it through the registry, `app/setup-wiring.ts`). */
    readonly createCity: () => Promise<{ readonly created: boolean }>;
    /** The city the admin edits (`infra/project.json`'s first) and its bounding box for the USGS access request. */
    readonly cityId: string;
    readonly github: boolean;
    readonly cityBBox: SetupHost['cityBBox'];
    // [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.10)
    /** The Cloud Build installer (`createCloudBuildInstaller`), the admin's release and the public map's address. */
    readonly installer: InstallerPort;
    readonly release: string;
    /** The release's build time (finding 39 of 2026-11-01), or null when the build knows none. */
    readonly releaseTime: number | null;
    readonly siteAddress: string;
    // [end install]
}

/** What the controller's `intents` are (`AdminIntents.setup`). */
type SetupModuleIntents = SetupController['intents'];

export interface SetupModule {
    /** `AdminState.setup` before `create`: nothing to show yet. */
    readonly initial: SetupState | null;
    create(shell: SetupShell): SetupModuleIntents;
}

/** M13 §1: a moderator's or an uploader's account has no Setup: nothing of it runs, and `setup.status` is not asked. */
function limitedAccount(view: ShellView): boolean {
    return isContributorOnly(Object.fromEntries((view.cities ?? []).map((city) => [city.id, city.role])));
}

/** The shell's failures as the codes `consentFailure` reads; a closed popup is `null` (nothing changed). */
const CONSENT_CODES = new Map<string, string>([
    ['popupBlocked', 'auth/popup-blocked'],
    ['scopeDenied', 'hcm/scope-denied'],
    ['wrongAccount', 'hcm/wrong-account'],
    ['network', 'auth/network-request-failed'],
]);

function consentOf(outcome: ShellGoogleOutcome): GoogleAccess | null {
    if (outcome.granted) {
        return outcome.access;
    }
    if (outcome.failure === 'popupClosed') {
        return null;
    }
    throw Object.assign(new Error(outcome.failure), { code: CONSENT_CODES.get(outcome.failure) ?? 'failed' });
}

/** Google consent over the shell's: the popup opens in the call's synchronous part, as the click needs. */
function googleOf(shell: SetupShell): SetupGoogleAuth {
    return {
        live: (scope) => shell.google.live(scope, MIN_TOKEN_LIFE_MS),
        request: (scope) => shell.google.request(scope).then(consentOf),
        drop: () => {
            shell.google.drop();
        },
    };
}

function backendOf(callables: SetupCallables, createCity: SetupModuleOptions['createCity']): SetupBackend {
    return {
        status: () => callables.call('setup.status', {}),
        selfTest: () => callables.call('setup.selfTest', {}),
        recordCloud: (request) => callables.call('setup.recordCloud', request),
        createCity,
        saveMapbox: (request) => callables.call('setup.saveMapbox', request),
        saveUsgs: (request) => callables.call('setup.saveUsgs', request),
        rotatePublicToken: (request) => callables.call('setup.rotatePublicToken', request),
        analyticsConfig: (request) => callables.call('setup.analyticsConfig', request),
        listGroups: (request) => callables.call('telemetry.listGroups', request),
    };
}

/** The controller's ports over the shell's services and the entry's options. */
export function setupDepsOf(shell: SetupShell, options: SetupModuleOptions): SetupDeps {
    const { projectId, authDomain, messagingSenderId } = shell.config;
    return {
        host: {
            projectId,
            projectNumber: messagingSenderId,
            authDomain,
            cityId: options.cityId,
            github: options.github,
            cityBBox: options.cityBBox,
            serverDeployed: () => shell.serverReady(),
            release: options.release,
            releaseTime: options.releaseTime,
            siteAddress: options.siteAddress,
        },
        google: googleOf(shell),
        cloud: options.cloud,
        backend: backendOf(shell.firebase.callables, options.createCity),
        importer: options.importer,
        sources: options.sources,
        installer: options.installer,
        clock: shell.clock,
        visibility: shell.visibility,
        session: shell.session,
        log: shell.log.child('setup'),
        notify: (notice) => {
            shell.notify(notice);
        },
    };
}

/** The auth states in which Setup is shown, and the mode the controller runs in. */
const MODES = new Map<string, SetupMode>([
    ['bootstrap', 'bootstrap'],
    ['admin', 'normal'],
]);

function isStep(value: string | undefined): value is SetupStepId {
    return (SETUP_STEPS as readonly (string | undefined)[]).includes(value);
}

/** The step a `#/setup/<step>` address names, or null. */
function addressedStep(view: ShellView): SetupStepId | null {
    const [param] = view.route.params;
    return view.route.id === 'setup' && isStep(param) ? param : null;
}

/** Keeps the controller in step with the shell: its mode, the claim, the addressed step. */
class ShellFollower {
    private mode: SetupMode | null = null;
    private step: SetupStepId | null = null;
    private auth = '';
    private shown: boolean | null = null;

    constructor(private readonly controller: SetupController) {}

    /** Every change of the admin's state (the Setup Assistant's own included), so each follow-up acts on a change only. */
    onState(view: ShellView): void {
        this.followPage(view);
        this.followMode(view);
        this.followAddress(view);
        this.followClaim(view);
    }

    /** The claim (d2) runs: the claim card says so. */
    private followClaim(view: ShellView): void {
        const entered = view.auth === 'claiming' && this.auth !== 'claiming';
        this.auth = view.auth;
        if (entered) {
            this.controller.setClaim('pending', { key: 'adminShell.auth.claiming' });
        }
    }

    /** Which page shows: before the first start too, so a session opened on another page checks nothing of the Setup's. */
    private followPage(view: ShellView): void {
        const shown = view.route.id === 'setup';
        if (shown !== this.shown) {
            this.shown = shown;
            this.controller.setPageShown(shown);
        }
    }

    private followMode(view: ShellView): void {
        const mode = MODES.get(view.auth);
        if (mode === undefined || mode === this.mode || limitedAccount(view)) {
            return;
        }
        const first = this.mode === null;
        this.mode = mode;
        this.step = addressedStep(view);
        void (first ? this.controller.start(mode, this.step) : this.controller.setMode(mode));
    }

    private followAddress(view: ShellView): void {
        const step = addressedStep(view);
        if (step === this.step) {
            return;
        }
        this.step = step;
        if (step !== null && this.mode !== null) {
            this.controller.intents.open(step);
        }
    }
}

/** Starts the controller over `shell` and keeps `AdminState.setup` and the shell's mode in step with it. */
function startSetup(shell: SetupShell, options: SetupModuleOptions): SetupController {
    const controller = createSetupController(setupDepsOf(shell, options));
    shell.setSetup(controller.getState());
    controller.subscribe((state) => {
        shell.setSetup(state);
    });
    const follower = new ShellFollower(controller);
    follower.onState(shell.getState());
    shell.subscribe((view) => {
        follower.onState(view);
    });
    return controller;
}

/** The Setup Assistant for admin-shell's `mount` (`deps.setup`). */
export function createSetupModule(options: SetupModuleOptions): SetupModule {
    return { initial: null, create: (shell) => startSetup(shell, options).intents };
}
