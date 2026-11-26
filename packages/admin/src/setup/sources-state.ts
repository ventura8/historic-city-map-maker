/**
 * M28 (`docs/research/M28-sources.md` §1, §4): what the Sources step and the platform card add to the Setup Assistant's state:
 * the switches and the city's choice, the USGS step the choice leaves out, and the platform card's state read from the steps
 * that set the platform up. Kept beside `state.ts`, which reads them in `refreshDerived`.
 */
import { usgsReadiness, type ServiceState } from '@hcm/shared';
import { DEFAULT_SOURCES, needsUsgsAccount, type CountryPlace, type SourceChoices } from '@hcm/shared/sources';

import type { SetupStepId } from './steps.js';

/**
 * M28 §10: where the city's country keeps its old maps and images (`countrySources/{country}`, written by `ops.tick`): still
 * reading, ready, not looked up yet (the tick places the city within the hour), or unreadable.
 */
export interface CountryFinder {
    readonly state: 'loading' | 'ready' | 'none' | 'failed';
    readonly country: string | null;
    readonly language: string;
    readonly origin: 'curated' | 'researched';
    readonly factsCheckedOn: string | null;
    readonly refreshedAt: string | null;
    readonly places: readonly CountryPlace[];
    readonly cityName: string | null;
}

/** A country's list as the Sources port reads it. */
export type CountryList = Omit<CountryFinder, 'state'>;

export const NO_FINDER: CountryFinder = {
    state: 'loading',
    country: null,
    language: 'en',
    origin: 'curated',
    factsCheckedOn: null,
    refreshedAt: null,
    places: [],
    cityName: null,
};

/** The Sources step's switches and what the city holds. */
export interface SourcesSlice {
    /** What the switches show: the saved choice (else the defaults), then the owner's changes. */
    readonly choices: SourceChoices;
    /** What the city holds (`cities/{city}.sources`, defaults filled in); null: not chosen yet. */
    readonly saved: SourceChoices | null;
    /** M28 §10: the country's archives, libraries and sellers. */
    readonly finder: CountryFinder;
}

/** Before the city's choice is read: the defaults on the switches, nothing saved. */
export const NO_SOURCES: SourcesSlice = { choices: DEFAULT_SOURCES, saved: null, finder: NO_FINDER };

/** Whether the map's sources need a USGS account (the declassified frames or Landsat), as the city holds them; before a choice, the defaults. */
function usgsChosen(state: { readonly sources: SourcesSlice }): boolean {
    return needsUsgsAccount(state.sources.saved ?? DEFAULT_SOURCES);
}

/** The steps the sources leave out: USGS when neither its frames nor Landsat are chosen. */
export function hiddenSteps(state: { readonly sources: SourcesSlice }): readonly SetupStepId[] {
    return usgsChosen(state) ? [] : ['usgs'];
}

/** The steps whose state the platform card reads (Firebase: billing and the server; Firestore: provisioning; Mapbox). */
const PLATFORM_STEPS: readonly SetupStepId[] = ['billing', 'provision', 'deploy', 'mapbox'];

/** The platform card's state: done once its steps are; Checking… while one of them is (finding 32). */
interface CheckedStep {
    readonly state: ServiceState;
    readonly firstCheck: boolean;
    readonly checkedAt: string | null;
}

export function withPlatform<Step extends CheckedStep>(steps: Readonly<Record<SetupStepId, Step>>): Readonly<Record<SetupStepId, Step>> {
    const parts = PLATFORM_STEPS.map((id) => steps[id]);
    const state: ServiceState = parts.every((step) => step.state === 'ok') ? 'ok' : 'missing';
    const firstCheck = parts.some((step) => step.firstCheck);
    return { ...steps, platform: { ...steps.platform, state, firstCheck, checkedAt: firstCheck ? null : steps.platform.checkedAt } };
}

/** What `usgsPart` reads of the state. */
interface UsgsView {
    readonly sources: SourcesSlice;
    readonly steps: { readonly usgs: { readonly state: ServiceState; readonly detail: { readonly key: string } | null } };
    readonly usgs: { readonly postponedAt: string | null };
}

/**
 * USGS's part in "done" (`usgsReadiness` of `@hcm/shared`), from the card's state and its recorded reason; M28: a map whose
 * sources need no USGS account is done without it.
 */
export function usgsPart(state: UsgsView): ReturnType<typeof usgsReadiness> {
    if (!usgsChosen(state)) {
        return 'ok';
    }
    const step = state.steps.usgs;
    const postponedAt = state.usgs.postponedAt ?? undefined;
    return usgsReadiness({ state: step.state, detail: step.detail?.key, ...(postponedAt === undefined ? {} : { postponedAt }) });
}
