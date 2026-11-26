/**
 * What every step flow shares: the ports, the state store, and the few writes a flow makes (patch a step, count an
 * input or a consent, change a slice). In bootstrap mode every change is mirrored into the bootstrap record, so a
 * reload keeps what the steps detected (`docs/research/M2b-interfaces.md` §3.2).
 */
import type { SetupStatusView } from '@hcm/shared';

import { GOOGLE_SCOPES, type GoogleScope } from '../google/scopes.js';
import { writeBootstrapRecord } from './bootstrap-record.js';
import type { StepFailure } from './messages.js';
import type { SetupDeps } from './ports.js';
import { applyStatusView, bootstrapRecordOf } from './records.js';
import { withCount, withStep, type SetupState, type StepCounts, type StepPatch } from './state.js';
import type { SetupStepId } from './steps.js';

export interface SetupStore {
    get(): SetupState;
    set(next: SetupState): void;
    subscribe(listener: (state: SetupState) => void): () => void;
}

/**
 * A plain observable value; listeners run synchronously after every change. A change made by a listener is delivered
 * after the current round, to every listener, so nobody ever sees an older state after a newer one.
 */
export function createSetupStore(initial: SetupState): SetupStore {
    let current = initial;
    let notifying = false;
    let again = false;
    const listeners = new Set<(state: SetupState) => void>();
    /** A listener changed the state during the round just delivered (read through a call: listeners set it). */
    const changedMeanwhile = (): boolean => again;
    const notify = (): void => {
        notifying = true;
        try {
            do {
                again = false;
                for (const listener of [...listeners]) {
                    listener(current);
                }
            } while (changedMeanwhile());
        } finally {
            notifying = false;
        }
    };
    return {
        get: () => current,
        set(next) {
            current = next;
            if (notifying) {
                again = true;
                return;
            }
            notify();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export interface SetupContext {
    readonly deps: SetupDeps;
    state(): SetupState;
    /** Replaces the state through `change` (and mirrors it into the bootstrap record in bootstrap mode). */
    update(change: (state: SetupState) => SetupState): void;
    patchStep(id: SetupStepId, patch: StepPatch): void;
    /** Counts one in-app input or Google consent on step `id` (the e2e input budget). */
    count(id: SetupStepId, kind: keyof StepCounts): void;
    /** Records a failed check or action on step `id` (Continue when the Google token expired). */
    fail(id: SetupStepId, failure: StepFailure): void;
    /**
     * A save the server refused (Mapbox, USGS): its message, then the status the server recorded with the reason, so the
     * chip says it too (S-A06-BAD-REVOKED); a status that cannot be read leaves the chip as it was, the message says why.
     */
    failRecorded(id: SetupStepId, failure: StepFailure): Promise<void>;
    /** Normal mode: the server's `setup/status` replaces what the cards show. */
    applyStatus(view: SetupStatusView): void;
    /**
     * From now on every change in bootstrap mode is mirrored into the bootstrap record: called once the controller has
     * read it. Before, a change (the claim card's, while the shell claims) would replace the record with an empty one
     * and lose what the start-up steps found (S-A26-BAD-TOKEN-GONE).
     */
    mirrorBootstrap(): void;
    /** ISO 8601 of the clock's now. */
    nowIso(): string;
}

/** A step's token must live this much longer to count as live (`MIN_TOKEN_LIFE_MS` of `google-access.ts`). */
const LIVE_TOKEN_MS = 5 * 60_000;

const SCOPE_NAMES = Object.keys(GOOGLE_SCOPES) as readonly GoogleScope[];

/**
 * M6 setup-ux (finding 7 of 2026-10-25): the scopes a live token holds now, so a card shows the consent note only when its
 * button will open Google's popup; read again with every change (a poll's, a click's, an expiry's `Continue`).
 */
function withLiveScopes(state: SetupState, deps: SetupDeps): SetupState {
    const now = deps.clock.now();
    const live = SCOPE_NAMES.filter((scope) => {
        const access = deps.google.live(scope);
        return access !== null && access.expiresAt - now >= LIVE_TOKEN_MS;
    });
    const same = live.length === state.liveScopes.length && live.every((scope) => state.liveScopes.includes(scope));
    return same ? state : { ...state, liveScopes: live };
}

export function createSetupContext(deps: SetupDeps, store: SetupStore): SetupContext {
    const nowIso = (): string => new Date(deps.clock.now()).toISOString();
    let mirroring = false;
    const update = (change: (state: SetupState) => SetupState): void => {
        const next = withLiveScopes(change(store.get()), deps);
        store.set(next);
        if (next.mode === 'bootstrap' && mirroring) {
            writeBootstrapRecord(deps.session, bootstrapRecordOf(next, nowIso()));
        }
    };
    const fail = (id: SetupStepId, failure: StepFailure): void => {
        if (failure.expired) {
            deps.google.drop();
        }
        update((state) => withStep(state, id, { busy: false, error: failure.message, needsContinue: failure.expired }));
    };
    const applyStatus = (view: SetupStatusView): void => {
        update((state) => applyStatusView(state, view, deps.clock.now()));
    };
    return {
        deps,
        state: () => store.get(),
        update,
        patchStep(id, patch) {
            update((state) => withStep(state, id, patch));
        },
        count(id, kind) {
            update((state) => withCount(state, id, kind));
        },
        fail,
        async failRecorded(id, failure) {
            fail(id, failure);
            try {
                applyStatus(await deps.backend.status());
            } catch (error) {
                deps.log.warn('setup status not read after a refused save', { step: id, error: String(error) });
            }
        },
        applyStatus,
        mirrorBootstrap() {
            mirroring = true;
        },
        nowIso,
    };
}
