/**
 * What the shell gives the Setup Assistant (setup-ui, `packages/admin/src/setup/`) and later pages: the injected ports,
 * Google consent with the shell's messages, the state, and the hooks of the bootstrap switch (§3.3 d2). The Setup
 * Assistant is plugged into `mount` as a `SetupModuleSpec`: its initial state lives in `AdminState.setup`, its intents in
 * `AdminIntents.setup`.
 */
import {
    apiErrorFromFailure,
    type AdminCallableName,
    type CallableRequest,
    type CallableResponse,
    type Logger,
    type StartFirstCity,
} from '@hcm/shared';

import type { GoogleAccess } from '../auth/google-auth.js';
import type { GoogleOutcome } from '../auth/google-service.js';
import { CallableFailure, type CallablesPort, type CallOptions, type FirebasePorts } from '../firebase/ports.js';
import type { GoogleScope } from '../google/scopes.js';
import type { AdminState, NoticeInput } from '../state/state.js';
import type { AdminRuntime, FirebaseWebConfig } from './config.js';
import type { Clock, KeyValueStore, PageVisibility, Unsubscribe } from './ports.js';
import type { AdminEvent } from './telemetry.js';

/** The part of `infra/project.json` (§3.7, google-clients' `ProjectConfig`) the shell reads. */
export interface AdminProject {
    readonly projectId: string;
    /** The cities this project serves; the first is the one the admin edits. */
    readonly cities: readonly string[];
    /** M14: what the start page was told of the first city; New city opens with it filled in. */
    readonly firstCity?: StartFirstCity | undefined;
}

/** A call's result for a screen: the value, or the message to show. */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: NoticeInput };

/**
 * Google consent for a step (setup-ui's module, `packages/admin/src/setup/module.ts`, reads it): the live token, Google's
 * popup with its outcome (a failure is also shown in the snackbar), forgetting the token.
 */
interface ShellGoogle {
    /** One popup for `scope`: must be the first await of a click handler; the granted token is kept in memory. */
    request(scope: GoogleScope): Promise<GoogleOutcome>;
    /** The signed-in user's token for `scope` with more than `minRemainingMs` left (default 0), or null. */
    live(scope: GoogleScope, minRemainingMs?: number): GoogleAccess | null;
    /** After a Google 401: the token is gone, the step shows Continue (§1.5). */
    drop(): void;
}

export interface ShellServices<Setup> {
    readonly config: FirebaseWebConfig;
    readonly runtime: AdminRuntime;
    readonly project: AdminProject;
    /** The Firebase ports; a callable answering `apiError.notAdmin` makes the shell ask who this is again. */
    readonly firebase: FirebasePorts;
    /** The Google REST clients' transport. */
    readonly fetch: typeof fetch;
    readonly clock: Clock;
    readonly session: KeyValueStore;
    readonly visibility: PageVisibility;
    readonly log: Logger;
    readonly google: ShellGoogle;
    getState(): AdminState<Setup>;
    subscribe(listener: (state: AdminState<Setup>) => void): Unsubscribe;
    /** Replaces the Setup Assistant's part of the state. */
    setSetup(setup: Setup): void;
    /** Shows a message in the snackbar. */
    notify(notice: NoticeInput): void;
    /** A GA4 event (dropped without consent). */
    track(event: AdminEvent): void;
    /**
     * Step (d) saw every function `ACTIVE`: the shell probes again; when the server answers it claims the map (no click
     * while the provisioning's token is alive) and switches to normal mode. True when the server answered.
     */
    serverReady(): Promise<boolean>;
}

/** The Setup Assistant as `mount` takes it: its initial state, and its intents built over the shell's services. */
export interface SetupModuleSpec<Setup, SetupIntents> {
    readonly initial: Setup;
    create(shell: ShellServices<Setup>): SetupIntents;
}

/** No Setup Assistant (the shell alone): what the entry passes until setup-ui's module is wired. */
export const NO_SETUP: SetupModuleSpec<null, null> = { initial: null, create: () => null };

/** Callables whose `apiError.notAdmin` failure (a removed admin, §1.5) calls `denied` before it is rethrown. */
export function guardCallables(callables: CallablesPort, denied: () => void): CallablesPort {
    return {
        call: async <N extends AdminCallableName>(
            name: N,
            request: CallableRequest<N>,
            options?: CallOptions,
        ): Promise<CallableResponse<N>> => {
            try {
                return await callables.call(name, request, options);
            } catch (error) {
                if (error instanceof CallableFailure && error.details.code === 'apiError.notAdmin') {
                    denied();
                }
                throw error;
            }
        },
    };
}

/** A callable's result as an `Outcome` (its error code, with its parameters, as the message). */
export async function outcomeOf<T>(call: () => Promise<T>): Promise<Outcome<T>> {
    try {
        return { ok: true, value: await call() };
    } catch (error) {
        const details = error instanceof CallableFailure ? error.details : apiErrorFromFailure(undefined, undefined);
        return { ok: false, error: details.params === undefined ? { key: details.code } : { key: details.code, params: details.params } };
    }
}
