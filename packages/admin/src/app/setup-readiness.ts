/**
 * Whether Setup is complete (`DECISIONS-for-review.md` §34i): while an admin is signed in (normal mode) the shell watches
 * `setup/status` and sets `setupReady` once Setup is done (`setupDone` of `@hcm/shared`, M6: billing, provisioning and
 * Mapbox `ok`, USGS `ok`, postponed or waiting for USGS's approval of a saved token, and the installer's targets once
 * recorded; findings 16 and 24 of 2026-10-25), as the Setup page's header says. Then an empty address opens the dashboard and the dashboard takes
 * Setup's place on the compact bar (`../routing/router.ts`). This browser remembers the answer per project
 * (`SETUP_READY_KEY`), so the next visit's empty address opens the dashboard before the watch answers; the watch corrects
 * it either way. A `permission-denied` (the admin was removed) asks the server again who this is, as the city's theme does.
 * A city of the `e2e` build's own (`?city=`) is not watched: its first screen is Setup, whatever another spec left there.
 */
import { FIRESTORE_PATHS, SERVICE_STATES, isContributorOnly, setupDone, type ServiceState, type SetupDoneInput } from '@hcm/shared';

import type { DocumentData, DocumentsPort } from '../firebase/ports.js';
import type { ShellState, ShellStateAccess } from '../state/state.js';
import type { KeyValueStore, Unsubscribe } from './ports.js';

/** `localStorage`: the project whose Setup this browser last saw complete. */
export const SETUP_READY_KEY = 'hcm:admin:setupReady';

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(value: unknown): Fields | undefined {
    return typeof value === 'object' && value !== null ? (value as Fields) : undefined;
}

function isServiceState(value: unknown): value is ServiceState {
    return (SERVICE_STATES as readonly unknown[]).includes(value);
}

/** A text field of a record, or undefined. */
function textOf(record: Fields, name: string): string | undefined {
    const value = record[name];
    return typeof value === 'string' ? value : undefined;
}

/** An area of `setup/status` as `setupDone` reads it: its state, its reason and when it was postponed; else undefined. */
function areaOf(data: DocumentData | null, area: 'billing' | 'provision' | 'mapbox' | 'usgs'): SetupDoneInput['usgs'] {
    const record = fieldsOf(data?.[area]) ?? {};
    const state = record['state'];
    return isServiceState(state) ? { state, detail: textOf(record, 'detail'), postponedAt: record['postponedAt'] } : undefined;
}

/** One installer target's state (`setup/status.install.<target>.state`, installer), or undefined. */
function targetOf(install: Fields | undefined, target: 'server' | 'site'): { readonly state: string } | undefined {
    const state = fieldsOf(install?.[target])?.['state'];
    return typeof state === 'string' ? { state } : undefined;
}

/** What the installer recorded (`setup/status.install`), or undefined before it records anything. */
function installOf(data: DocumentData | null): SetupDoneInput['install'] {
    const install = fieldsOf(data?.['install']);
    return install === undefined ? undefined : { server: targetOf(install, 'server'), site: targetOf(install, 'site') };
}

/** `setup/status` complete (`setupDone`): a missing document, or a required area never checked, is not. */
export function setupReadyOf(data: DocumentData | null): boolean {
    return setupDone({
        billing: areaOf(data, 'billing'),
        provision: areaOf(data, 'provision'),
        mapbox: areaOf(data, 'mapbox'),
        usgs: areaOf(data, 'usgs'),
        install: installOf(data),
    });
}

/** What this browser remembers of `projectId`'s Setup: true when it was last seen complete, else unknown. */
export function rememberedSetupReady(local: KeyValueStore, projectId: string): true | null {
    return local.get(SETUP_READY_KEY) === projectId ? true : null;
}

export interface SetupReadinessDeps {
    readonly documents: DocumentsPort;
    readonly shell: ShellStateAccess;
    readonly local: KeyValueStore;
    readonly projectId: string;
    /** An admin read was denied. */
    readonly denied: () => void;
    /**
     * False in a city of the `e2e` build's own (`?city=`, CR-M2c-7), which never reads the singleton `setup/status` that the
     * Setup Assistant's specs rewrite meanwhile (as its map token); true otherwise, always in production.
     */
    readonly watch: boolean;
}

/** M13 §1: a moderator's or an uploader's account reads no `setup/status`; their pages do not need it. */
function wantsSetupStatus(state: ShellState): boolean {
    const limited = isContributorOnly(Object.fromEntries(state.cities.map((city) => [city.id, city.role])));
    return state.auth === 'admin' && state.mode === 'normal' && !limited;
}

export class SetupReadiness {
    readonly #deps: SetupReadinessDeps;
    #stop: Unsubscribe | null = null;

    constructor(deps: SetupReadinessDeps) {
        this.#deps = deps;
    }

    /** Watches `setup/status` while an admin is signed in with the server (normal mode), and stops otherwise. */
    stateChanged(state: ShellState): void {
        const watching = this.#deps.watch && wantsSetupStatus(state);
        if (watching === (this.#stop !== null)) {
            return;
        }
        if (watching) {
            this.#start();
        } else {
            this.stop();
        }
    }

    stop(): void {
        this.#stop?.();
        this.#stop = null;
    }

    #start(): void {
        this.#stop = this.#deps.documents.watch(
            FIRESTORE_PATHS.setupStatus,
            (data) => {
                this.#known(setupReadyOf(data));
            },
            (code) => {
                this.#stop = null;
                if (code === 'permission-denied') {
                    this.#deps.denied();
                }
            },
        );
    }

    #known(ready: boolean): void {
        const { local, shell, projectId } = this.#deps;
        if (ready) {
            local.set(SETUP_READY_KEY, projectId);
        } else {
            local.remove(SETUP_READY_KEY);
        }
        if (shell.get().setupReady !== ready) {
            shell.update({ setupReady: ready });
        }
    }
}
