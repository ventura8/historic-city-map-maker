// A Setup Assistant state as the admin's controller builds it (packages/admin/src/setup/state.ts; the ui tests cannot
// import the admin), and a fake port that records every intent the elements call.
import { PROVISION_ITEMS, type ServiceState } from '@hcm/shared';
import { DEFAULT_SOURCES } from '@hcm/shared/sources';

import type {
    CountryFinderView,
    SetupIntentsPort,
    SetupPort,
    SetupStepId,
    SetupStepView,
    SetupViewState,
} from '../../../src/admin/setup/setup-port.js';
import { installSliceView } from './install-fixtures.js';

export const STEP_IDS: readonly SetupStepId[] = [
    'signIn',
    'billing',
    'provision',
    'deploy',
    'claim',
    'mapbox',
    'usgs',
    'analytics',
    'legacyImport',
];

const LETTERS: Readonly<Record<SetupStepId, string>> = {
    signIn: 'a',
    billing: 'b',
    provision: 'c',
    deploy: 'd',
    claim: 'd2',
    mapbox: 'e',
    platform: 'e1',
    sources: 'e2',
    usgs: 'f',
    analytics: 'g',
    legacyImport: 'h',
    // [section install] owner: installer (M6, CR-M6-6)
    pipeline: 'd3',
    site: 'i',
    // [end install]
};

const NEEDS_BACKEND: ReadonlySet<SetupStepId> = new Set(['claim', 'mapbox', 'usgs', 'analytics', 'legacyImport']);

export function stepView(id: SetupStepId, changes: Partial<SetupStepView> = {}): SetupStepView {
    return {
        id,
        letter: LETTERS[id],
        state: 'missing',
        checkedAt: null,
        detail: null,
        error: null,
        available: true,
        needsBackend: NEEDS_BACKEND.has(id),
        optional: id === 'analytics' || id === 'legacyImport',
        busy: false,
        needsContinue: false,
        postponed: false,
        unknown: false,
        scope: null,
        links: [],
        used: { inputs: 0, consents: 0 },
        budget: { inputs: 1, consents: 0 },
        ...changes,
    };
}

/** M28 §10: no list for the city's country yet (`ops.tick` has not placed the city). */
export const FINDER_NONE: CountryFinderView = {
    state: 'none',
    country: null,
    language: 'en',
    origin: 'curated',
    factsCheckedOn: null,
    refreshedAt: null,
    places: [],
    cityName: null,
};

export type ViewChanges = Partial<Omit<SetupViewState, 'steps'>> & {
    readonly steps?: Partial<Record<SetupStepId, Partial<SetupStepView>>>;
};

/** A normal-mode state: sign-in to the claim done, the rest to do, unless `changes` says otherwise. */
export function setupView(changes: ViewChanges = {}): SetupViewState {
    const { steps: stepChanges = {}, ...rest } = changes;
    const done: ServiceState = 'ok';
    const steps = Object.fromEntries(
        // M28: the platform and sources steps exist in every state; the default order leaves them out (their specs add them).
        [...STEP_IDS, 'platform' as const, 'sources' as const].map((id, index) => [
            id,
            stepView(id, { ...(index < 5 ? { state: done } : {}), ...stepChanges[id] }),
        ]),
    ) as Record<SetupStepId, SetupStepView>;
    return {
        mode: 'normal',
        projectId: 'demo-hcm',
        authDomain: 'demo-hcm.firebaseapp.com',
        openStep: 'mapbox',
        order: STEP_IDS,
        steps,
        done: 5,
        total: 9,
        ready: false,
        later: 0,
        doneNote: null,
        liveScopes: [],
        checking: false,
        error: null,
        used: { inputs: 0, consents: 0 },
        billing: {
            amount: 5,
            currency: 'USD',
            accounts: [],
            chosen: null,
            waitingForAccount: false,
            accountName: null,
            budgetId: null,
            needsPlatform: false,
            trialSince: null,
            createUrl: 'https://console.cloud.google.com/billing/create',
        },
        provision: { items: PROVISION_ITEMS.map((id) => ({ id, state: 'missing', detail: null })) },
        deploy: {
            ready: 0,
            total: 32,
            failed: [],
            variables: [
                { name: 'GCP_PROJECT_ID', value: 'demo-hcm' },
                { name: 'DEPLOY_ENABLED', value: 'true' },
            ],
            watching: false,
        },
        mapbox: {
            user: null,
            requiredScopes: ['styles:read', 'tokens:write'],
            rotation: { audience: null, busy: false, retiresOldAt: null, done: false, error: null },
        },
        usgs: {
            secondsLeft: null,
            expired: false,
            tokenPageUrl: 'https://ers.cr.usgs.gov/password/appgenerate',
            role: null,
            nextCheckAt: null,
            tokenExpiresAt: null,
            expiresSoon: false,
            area: '25.9600, 44.3300, 26.2300, 44.5400',
            username: '',
            expiresOn: '',
            postponedAt: null,
            pendingSince: null,
        },
        analytics: { measurementId: null, pageChangesOff: false, crashEmails: true, watching: false, reports: null },
        crashes: { loaded: false, busy: false, groups: [], error: null, disabledApi: null, lastReportAt: null },
        legacyImport: { done: 0, total: 45, failed: [], running: false },
        sources: { choices: DEFAULT_SOURCES, saved: null, finder: FINDER_NONE },
        selfTest: { checks: [] },
        install: installSliceView(),
        ...rest,
    };
}

type IntentName = keyof SetupIntentsPort;

/** Every intent call, `[name, ...args]`, in order. */
export type IntentCall = readonly [IntentName, ...unknown[]];

function recordingIntents(calls: IntentCall[]): SetupIntentsPort {
    const record =
        (name: IntentName) =>
        (...args: unknown[]): void => {
            calls.push([name, ...args]);
        };
    const names: readonly IntentName[] = [
        'open',
        'recheck',
        'noteInput',
        'continueGoogle',
        'linkBilling',
        'chooseBillingAccount',
        'confirmBillingAccount',
        'markTrial',
        'provision',
        'saveMapbox',
        'rotatePublicToken',
        'startUsgsCountdown',
        'draftUsgs',
        'saveUsgs',
        'followLink',
        'disableHistoryPageViews',
        'createMeasurementReports',
        'setCrashEmails',
        'enableApi',
        'loadCrashGroups',
        'importLegacy',
        'chooseSource',
        'saveSources',
        // [section setup-ux] owner: setup-ux (M6)
        'postponeUsgs',
        // [end setup-ux]
        // [section install] owner: installer (M6)
        'installServer',
        'install',
        'updateMap',
        'installOver',
        // [end install]
    ];
    return Object.fromEntries(names.map((name) => [name, record(name)])) as unknown as SetupIntentsPort;
}

export class FakeSetupPort implements SetupPort {
    readonly calls: IntentCall[] = [];
    readonly intents: SetupIntentsPort;
    private readonly listeners = new Set<(state: SetupViewState) => void>();

    /** Records every intent; `draftUsgs` also changes the state, as the controller does (the USGS fields live there). */
    constructor(private state: SetupViewState = setupView()) {
        const recorded = recordingIntents(this.calls);
        this.intents = {
            ...recorded,
            draftUsgs: (fields) => {
                recorded.draftUsgs(fields);
                this.notify({ ...this.state, usgs: { ...this.state.usgs, ...fields } });
            },
        };
    }

    private notify(state: SetupViewState): void {
        this.state = state;
        for (const listener of this.listeners) {
            listener(state);
        }
    }

    getState(): SetupViewState {
        return this.state;
    }

    subscribe(listener: (state: SetupViewState) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    set(changes: ViewChanges): void {
        this.notify(setupView({ ...changes }));
    }

    listening(): number {
        return this.listeners.size;
    }
}
