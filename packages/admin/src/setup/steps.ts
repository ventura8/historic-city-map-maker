import type { SetupArea } from '@hcm/shared';

import type { GoogleScope } from '../google/scopes.js';

/**
 * The Setup Assistant's steps in screen order (`docs/research/M2b-interfaces.md` §3.3, `docs/research/M6-interfaces.md`
 * §4.1): (a) sign-in and ownership, (b) billing and budget, (c) provisioning, (d) Install the server, (d2) the automatic
 * owner claim, (d3) the imagery pipeline (it starts with d), (e) Mapbox, (f) USGS, (g) analytics and crash reports,
 * (e1) the app's platform, Mapbox, Firebase and Firestore in one card (M28: what each is, costs and needs, its state read from
 * steps b to e; no input of its own), (e2) the sources the map uses (M28, `docs/research/M28-sources.md`), (h) the legacy Bucharest import, (i) Publish the map. No step
 * names a terminal command (M6).
 */
export const SETUP_STEPS = [
    'signIn',
    'billing',
    'provision',
    'deploy',
    'claim',
    'pipeline',
    'mapbox',
    'platform',
    'sources',
    'usgs',
    'analytics',
    'legacyImport',
    'site',
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number];

export interface SetupStepSpec {
    /** The step's letter in the contract. */
    readonly letter: 'a' | 'b' | 'c' | 'd' | 'd2' | 'd3' | 'e' | 'e1' | 'e2' | 'f' | 'g' | 'h' | 'i';
    /** False for the steps that work with no deployed function and no Firestore access (Google REST only). */
    readonly needsBackend: boolean;
    /** The `setup/status` area that records the step's result, if any. */
    readonly area: SetupArea | null;
    /** The Google scope the step asks for when it runs; null for none. */
    readonly scope: GoogleScope | null;
    /** In-app inputs of the happy path (clicks, fills, pastes, file choices; following a deep link is not counted). */
    readonly inputs: number;
    /** Google consent popups of the happy path. */
    readonly consents: number;
    /** The steps that must be done first. */
    readonly after: readonly SetupStepId[];
    /** An optional step never holds back `ready` (`setupDone`). */
    readonly optional: boolean;
    /**
     * M6 (CR-M6-4): a required step the owner may leave for later (Do it later, A59); a postponed step counts as settled
     * when the next one to open is chosen. Only USGS: billing, provisioning, the server, Mapbox and the site never wait.
     */
    readonly postponable: boolean;
}

type Spec = Omit<SetupStepSpec, 'postponable'> & { readonly postponable?: boolean };

const SPECS: Readonly<Record<SetupStepId, Spec>> = {
    signIn: { letter: 'a', needsBackend: false, area: null, scope: 'cloudReadOnly', inputs: 1, consents: 1, after: [], optional: false },
    billing: {
        letter: 'b',
        needsBackend: false,
        area: 'billing',
        scope: 'cloudBilling',
        inputs: 1,
        consents: 1,
        after: ['signIn'],
        optional: false,
    },
    provision: {
        letter: 'c',
        needsBackend: false,
        area: 'provision',
        scope: 'cloudPlatform',
        inputs: 1,
        consents: 1,
        after: ['billing'],
        optional: false,
    },
    // M6: Install the server is one click; its consent is (c)'s while that token lives (§4.2: +1 once it is gone).
    deploy: {
        letter: 'd',
        needsBackend: false,
        area: null,
        scope: 'cloudPlatform',
        inputs: 1,
        consents: 0,
        after: ['provision'],
        optional: false,
    },
    claim: {
        letter: 'd2',
        needsBackend: true,
        area: null,
        scope: 'cloudReadOnly',
        inputs: 0,
        consents: 0,
        after: ['deploy'],
        optional: false,
    },
    // M6: the imagery pipeline starts with Install the server; no input of its own (Try again only on a failure).
    pipeline: {
        letter: 'd3',
        needsBackend: false,
        area: null,
        scope: 'cloudPlatform',
        inputs: 0,
        consents: 0,
        after: ['provision'],
        optional: true,
    },
    mapbox: { letter: 'e', needsBackend: true, area: 'mapbox', scope: null, inputs: 1, consents: 0, after: ['claim'], optional: false },
    // M28 (the owner, 2026-11-13): the app's platform in one card, Mapbox, Firebase and Firestore, each with its role, costs,
    // limits, sign-up help and state. Its state is read from billing, provisioning, the server and Mapbox (`withPlatform` of `state.ts`), so
    // it has no input and never opens on its own while those steps are still to do (optional: it opens after them).
    platform: { letter: 'e1', needsBackend: false, area: null, scope: null, inputs: 0, consents: 0, after: [], optional: true },
    // M28: the sources, chosen once the city exists (they are its `sources`); one click saves the defaults. Not in `setupDone`:
    // a map from before M28 stays done, the card says what is still to choose.
    sources: { letter: 'e2', needsBackend: true, area: null, scope: null, inputs: 1, consents: 0, after: ['claim'], optional: false },
    usgs: {
        letter: 'f',
        needsBackend: true,
        area: 'usgs',
        scope: null,
        inputs: 3,
        consents: 0,
        after: ['claim'],
        optional: false,
        postponable: true,
    },
    analytics: {
        letter: 'g',
        needsBackend: true,
        area: 'analytics',
        scope: 'analyticsEdit',
        inputs: 1,
        consents: 1,
        after: ['claim'],
        optional: true,
    },
    legacyImport: { letter: 'h', needsBackend: true, area: null, scope: null, inputs: 1, consents: 0, after: ['claim'], optional: true },
    // M6: Publish the map, once the server is installed; one click (its consent once the token from (c) is gone).
    site: {
        letter: 'i',
        needsBackend: true,
        area: null,
        scope: 'cloudPlatform',
        inputs: 1,
        consents: 0,
        after: ['claim'],
        optional: false,
    },
};

export const SETUP_STEP_SPECS: Readonly<Record<SetupStepId, SetupStepSpec>> = Object.fromEntries(
    SETUP_STEPS.map((id) => [id, { ...SPECS[id], postponable: SPECS[id].postponable === true }]),
) as Record<SetupStepId, SetupStepSpec>;

/** The step the assistant ends with: published once everything before it that the owner wants is done (§4.1). */
const LAST_STEP: SetupStepId = 'site';

/** Which steps the page opens first: the required ones in screen order, then the optional ones, then the site. */
function openingRank(id: SetupStepId): number {
    if (id === LAST_STEP) {
        return 2;
    }
    return SETUP_STEP_SPECS[id].optional ? 1 : 0;
}

/** Screen order sorted by {@link openingRank} (stable: the screen order within each rank). */
const OPENING_ORDER: readonly SetupStepId[] = [...SETUP_STEPS].sort((left, right) => openingRank(left) - openingRank(right));

/**
 * The first step not settled whose prerequisites are all settled, in opening order (the required steps, then the
 * optional ones, then Publish the map); null once every step is settled. `settled` is the steps done and, since M6, the
 * ones postponed (CR-M6-4).
 */
export function nextSetupStep(settled: ReadonlySet<SetupStepId>): SetupStepId | null {
    return OPENING_ORDER.find((id) => !settled.has(id) && SETUP_STEP_SPECS[id].after.every((before) => settled.has(before))) ?? null;
}

/** The happy-path input budget of a run through `steps` (the e2e `inputBudget` limits, §3.5; M6 §4.2). */
export function setupInputBudget(steps: readonly SetupStepId[] = SETUP_STEPS): { readonly inputs: number; readonly consents: number } {
    return steps.reduce(
        (total, id) => ({ inputs: total.inputs + SETUP_STEP_SPECS[id].inputs, consents: total.consents + SETUP_STEP_SPECS[id].consents }),
        { inputs: 0, consents: 0 },
    );
}
