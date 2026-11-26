/**
 * What the Setup Assistant's elements need from the admin's setup controller (`docs/research/M2b-interfaces.md` §1.7,
 * §3). `@hcm/ui` sits below `@hcm/admin` (dependency-cruiser `ui-below-apps`), so the elements cannot import the
 * controller's types: this file mirrors them structurally, as `../../viewer/store-port.ts` does for the viewer. The
 * controller of `packages/admin/src/setup/controller.ts` is assignable to {@link SetupPort}; the shell hands it to
 * `<hcm-setup-page>`. The elements render the state and call the intents; they never call Google or a function.
 */
import type {
    AdminSetupKey,
    AdminShellKey,
    ApiErrorCode,
    InstallState,
    InstallStepId,
    InstallTarget,
    ProvisionItem,
    SaveUsgsRequest,
    SelfTestCheck,
    ServiceState,
    TransientDeployReason,
    UsgsRole,
} from '@hcm/shared';
import type { CountryPlace, SourceChoices, SourceToggle } from '@hcm/shared/sources';

// [section install] owner: installer (M6, CR-M6-6): the imagery pipeline (d3) and Publish the map (i) join the steps.
export type SetupStepId =
    | 'signIn'
    | 'billing'
    | 'provision'
    | 'deploy'
    | 'claim'
    | 'pipeline'
    | 'mapbox'
    | 'platform'
    | 'sources'
    | 'usgs'
    | 'analytics'
    | 'legacyImport'
    | 'site';
// [end install]

type SetupMode = 'bootstrap' | 'normal';

export type GoogleScopeName = 'cloudReadOnly' | 'cloudBilling' | 'cloudPlatform' | 'analyticsEdit' | 'analyticsRead';

export type SetupLinkId =
    | 'gcp.firebaseConsole'
    | 'gcp.billingAccounts'
    | 'gcp.billingCreate'
    | 'gcp.blazeUpgrade'
    | 'mapbox.signup'
    | 'mapbox.console'
    | 'mapbox.usageThresholds'
    | 'mapbox.accessTokens'
    | 'usgs.register'
    | 'usgs.accessRequest'
    | 'usgs.applicationToken'
    | 'usgs.sceneMetadata';

export type SetupMessageKey = AdminSetupKey | AdminShellKey | ApiErrorCode;

/** A message key with its `{placeholder}` values; a `scope` value is a {@link GoogleScopeName}. */
export interface SetupMessage {
    readonly key: SetupMessageKey;
    readonly params?: Readonly<Record<string, string>>;
}

interface StepCounts {
    readonly inputs: number;
    readonly consents: number;
}

interface SetupLinkView {
    readonly id: SetupLinkId;
    readonly url: string;
}

export interface SetupStepView {
    readonly id: SetupStepId;
    readonly letter: string;
    readonly state: ServiceState;
    readonly checkedAt: string | null;
    readonly detail: SetupMessage | null;
    readonly error: SetupMessage | null;
    readonly available: boolean;
    /** The step waits for the server in bootstrap mode. */
    readonly needsBackend: boolean;
    readonly optional: boolean;
    readonly busy: boolean;
    readonly needsContinue: boolean;
    /** M6 setup-ux (A59): the owner chose Do it later; the chip reads Later. */
    readonly postponed: boolean;
    /** Finding 27 of 2026-10-31: the server is too old to say; the chip reads "Update the server to check", not "To do". */
    readonly unknown: boolean;
    /** Finding 32 of 2026-10-31: the step's first check since the page loaded has not answered; the chip reads Checking…. */
    readonly firstCheck?: boolean;
    readonly scope: GoogleScopeName | null;
    readonly links: readonly SetupLinkView[];
    readonly used: StepCounts;
    readonly budget: StepCounts;
}

interface BillingAccountView {
    readonly name: string;
    readonly displayName: string;
    readonly currency: string;
}

export interface SetupViewState {
    readonly mode: SetupMode;
    /** M29: the city's rectangle (west, south, east, north) for the imagery census of the first card; null when none is known. */
    readonly cityBBox?: readonly [number, number, number, number] | null;
    readonly projectId: string;
    readonly authDomain: string;
    readonly openStep: SetupStepId | null;
    readonly order: readonly SetupStepId[];
    readonly steps: Readonly<Record<SetupStepId, SetupStepView>>;
    readonly done: number;
    readonly total: number;
    /** Setup is done (`setupDone`, M6): USGS may be postponed or waiting for its approval. */
    readonly ready: boolean;
    /** M6 setup-ux: the postponed steps not done. */
    readonly later: number;
    /** M6 setup-ux: what "done" leaves open. */
    readonly doneNote: 'usgsPending' | 'usgsLater' | null;
    /** M6 setup-ux (finding 7): the scopes a live token holds now (a card's consent note only when its button will ask). */
    readonly liveScopes: readonly GoogleScopeName[];
    readonly checking: boolean;
    /** Finding 32 of 2026-10-31: a step's first check has not answered: the header says Checking…, not "0 of 11 steps done". */
    readonly loading?: boolean;
    readonly error: SetupMessage | null;
    readonly used: StepCounts;
    readonly billing: {
        readonly amount: number;
        readonly currency: string;
        readonly accounts: readonly BillingAccountView[];
        readonly chosen: string | null;
        readonly waitingForAccount: boolean;
        readonly accountName: string | null;
        readonly budgetId: string | null;
        readonly needsPlatform: boolean;
        /** M6 setup-ux (A60): a likely free trial since (ISO), or null. */
        readonly trialSince: string | null;
        /** M6 setup-ux (finding 3): Google's page that creates a billing account. */
        readonly createUrl: string;
    };
    readonly provision: {
        readonly items: readonly { readonly id: ProvisionItem; readonly state: ServiceState; readonly detail: SetupMessage | null }[];
    };
    readonly deploy: {
        readonly ready: number;
        readonly total: number;
        readonly failed: readonly string[];
        readonly variables: readonly { readonly name: string; readonly value: string }[];
        readonly watching: boolean;
    };
    readonly mapbox: {
        readonly user: string | null;
        readonly requiredScopes: readonly string[];
        /** The last replacement of a public token (null audience: none yet). */
        readonly rotation: {
            readonly audience: 'viewer' | 'admin' | null;
            readonly busy: boolean;
            readonly retiresOldAt: string | null;
            readonly done: boolean;
            readonly error: SetupMessage | null;
        };
    };
    readonly usgs: {
        readonly secondsLeft: number | null;
        readonly expired: boolean;
        readonly tokenPageUrl: string;
        readonly role: UsgsRole | null;
        readonly nextCheckAt: string | null;
        readonly tokenExpiresAt: string | null;
        readonly expiresSoon: boolean;
        readonly area: string | null;
        /** The username and expiry date as typed (kept across a layout change). */
        readonly username: string;
        readonly expiresOn: string;
        /** M6 setup-ux (A59): Do it later was chosen (ISO), or null. */
        readonly postponedAt: string | null;
        /** M6 setup-ux: since when the saved token waits for USGS's approval (ISO), or null. */
        readonly pendingSince: string | null;
    };
    readonly analytics: {
        readonly measurementId: string | null;
        readonly pageChangesOff: boolean;
        readonly crashEmails: boolean;
        readonly watching: boolean;
        /** §76f: what the last Create the measurement reports registered and found there, or null before one. */
        readonly reports: { readonly created: number; readonly skipped: number } | null;
    };
    readonly crashes: {
        readonly loaded: boolean;
        readonly busy: boolean;
        readonly groups: readonly {
            readonly groupId: string;
            readonly message: string;
            readonly service: string;
            readonly count: number;
            readonly lastSeen: string;
        }[];
        readonly error: SetupMessage | null;
        readonly disabledApi: string | null;
        readonly lastReportAt: string | null;
    };
    readonly legacyImport: {
        readonly done: number;
        readonly total: number;
        readonly failed: readonly { readonly id: string; readonly detail: ApiErrorCode }[];
        readonly running: boolean;
        /** Photos on the map that get the old site's direction on the next click; none when absent. */
        readonly directions?: number;
        /** The city's credits do not name every old photo's author yet: the next click adds them. */
        readonly credits?: boolean;
    };
    /** M28: the Sources step's switches and what the city holds (null: not chosen yet). */
    readonly sources: { readonly choices: SourceChoices; readonly saved: SourceChoices | null; readonly finder: CountryFinderView };
    /** The last self-test's checks (Check again in normal mode), each with its state and a failure's reason. */
    readonly selfTest: {
        readonly checks: readonly {
            readonly id: SelfTestCheck;
            readonly state: ServiceState;
            readonly detail: SetupMessage | null;
            /** §67g: the model a passing AI check found offered. */
            readonly model?: string;
        }[];
    };
    // [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.7)
    readonly install: InstallSliceView;
    // [end install]
}

// [section install] owner: installer (M6): the install cards' slice (`packages/admin/src/install/model.ts`).
/** One install target as its card shows it. */
export interface InstallTargetViewPort {
    readonly target: InstallTarget;
    readonly state: InstallState;
    readonly installedRelease: string | null;
    readonly buildId: string | null;
    /** The build's page in the Google Cloud console. */
    readonly consoleUrl: string | null;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    /**
     * When the build started work, on the browser's clock (the live finding of 2026-11-08: Google's creation time against
     * the browser's clock said "Running for 3 min." at once); null while it is queued. Absent: null.
     */
    readonly runningSince?: string | null;
    readonly steps: readonly { readonly id: InstallStepId; readonly state: 'done' | 'now' | 'waiting' | 'failed' }[];
    readonly failedStep: InstallStepId | null;
    /** A failed build's step's last lines: redacted, shown as text only. */
    readonly log: readonly string[];
    /** The log names a permission step c's Retry what failed grants (finding 28 of 2026-10-31). */
    readonly fixInProvision: boolean;
    /** The quota a failed `jobs` step named (finding 47 of 2026-11-01): the card names it and links the Quotas page. */
    readonly quota: { readonly service: string; readonly metric: string; readonly limit: string } | null;
    readonly missing: readonly string[];
    readonly retryReason: TransientDeployReason | null;
    readonly retryAt: string | null;
    /** Why the card's button is off, or null. */
    readonly blocker: SetupMessage | null;
    readonly busy: boolean;
    readonly error: SetupMessage | null;
    readonly checkedAt: string | null;
    /**
     * The view is a record's, not a look at Cloud Build in this session (the live finding of 2026-11-08): a recorded build
     * at work is shown with when it was last seen, never as running with its steps.
     */
    readonly recorded?: boolean;
    /** A look at Cloud Build is under way: a recorded build at work reads "Checking the installation…" only then. */
    readonly looking?: boolean;
}

export interface InstallSliceView {
    /** The admin's own release. */
    readonly release: string;
    /** Where Publish the map puts the public map. */
    readonly address: string;
    readonly freeMinutes: number;
    readonly estimates: Readonly<Record<InstallTarget, number>>;
    /** What one Publish the map moves out of Hosting's free daily transfer, in MB. */
    readonly siteTransferMegabytes: number;
    readonly server: InstallTargetViewPort;
    readonly pipeline: InstallTargetViewPort;
    readonly site: InstallTargetViewPort;
    /** Why this admin cannot install the imagery pipeline (finding 43 of 2026-11-01), or null. */
    readonly pipelineOff: SetupMessage | null;
    /** Finding 65 of 2026-11-02: the Provision items the server card's Update the map also applies (empty: none). */
    readonly provisionDue: readonly ProvisionItem[];
}
// [end install]

/** The controller's intents as the elements call them (fire and forget: the state reports the outcome). */
export interface SetupIntentsPort {
    open(step: SetupStepId | null): void;
    recheck(step?: SetupStepId): void;
    noteInput(step: SetupStepId): void;
    continueGoogle(step: SetupStepId): void;
    linkBilling(): void;
    chooseBillingAccount(accountName: string): void;
    confirmBillingAccount(): void;
    /** "This account is a free trial" (one input): Home announces its end (A60). */
    markTrial(): void;
    provision(): void;
    saveMapbox(secretToken: string): void;
    rotatePublicToken(audience: 'viewer' | 'admin'): void;
    startUsgsCountdown(): void;
    draftUsgs(fields: { readonly username?: string; readonly expiresOn?: string }): void;
    saveUsgs(request: SaveUsgsRequest): void;
    /** M6 setup-ux (A59): Do it later on the USGS card. */
    postponeUsgs(): void;
    followLink(step: SetupStepId): void;
    disableHistoryPageViews(): void;
    /** §76f: Create the measurement reports (one click, the `analyticsEdit` consent when no live token has it). */
    createMeasurementReports(): void;
    setCrashEmails(enabled: boolean): void;
    enableApi(api: string): void;
    loadCrashGroups(): void;
    importLegacy(): void;
    /** M28: one switch of the Sources step. */
    chooseSource(id: SourceToggle, on: boolean): void;
    /** M28: Save my choice. */
    saveSources(): void;
    // [section install] owner: installer (M6)
    /** Install the server (d): it also starts the imagery pipeline. */
    installServer(): void;
    /** Publish the map, or Try again on an install card. */
    install(target: InstallTarget): void;
    /** Update the map, counted on `step`'s card. */
    updateMap(step: SetupStepId): void;
    /** "Install this admin's version anyway" on the card of a target newer than the admin, after its confirmation. */
    installOver(target: InstallTarget): void;
    // [end install]
}

export interface SetupPort {
    getState(): SetupViewState;
    subscribe(listener: (state: SetupViewState) => void): () => void;
    readonly intents: SetupIntentsPort;
}

/**
 * M28 (`docs/research/M28-sources.md` §10): where the city's country keeps its old maps and images, as `ops.tick` last wrote
 * `countrySources/{country}`: still reading, ready, not looked up yet, or unreadable.
 */
export interface CountryFinderView {
    readonly state: 'loading' | 'ready' | 'none' | 'failed';
    /** ISO 3166-1 alpha-2 (`RO`); null until the list is read. */
    readonly country: string | null;
    /** The institutions' language, which the ready requests are written in. */
    readonly language: string;
    readonly origin: 'curated' | 'researched';
    readonly factsCheckedOn: string | null;
    /** When the websites were last checked (ISO). */
    readonly refreshedAt: string | null;
    readonly places: readonly CountryPlace[];
    /** The city's name, in the institutions' language when it has one: what a request's `{city}` becomes. */
    readonly cityName: string | null;
}
