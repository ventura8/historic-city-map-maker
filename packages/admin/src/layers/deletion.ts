/**
 * Deleting a layer (`docs/research/M2c-interfaces.md` §8.4, §9.5; behaviour A33): Delete asks first, naming the layer
 * and what follows (it leaves the public map within about a minute, it can be restored from History, and the tileset
 * the raster pipeline made for it is deleted after `LAYER_DELETE_GRACE_DAYS` unless it is restored); the confirmation
 * calls `layers.delete`. No client deletes a layer document (the rules refuse it): the callable deletes it and queues the
 * tileset's deletion in one transaction. The snackbar says when the job will run; a refusal (`apiError.layers.busy`,
 * `apiError.notFound`) is shown as its message and changes nothing.
 */
import { LAYER_DELETE_GRACE_DAYS, type ApiErrorCode } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import { CallableFailure } from '../firebase/ports.js';

export type DeletionState =
    | { readonly phase: 'idle' }
    | { readonly phase: 'confirm' | 'running'; readonly id: string; readonly label: string; readonly graceDays: number };

const IDLE: DeletionState = { phase: 'idle' };

export class LayerDeletion {
    readonly #services: ContentServices;
    readonly #changed: (state: DeletionState) => void;
    #state: DeletionState = IDLE;

    constructor(services: ContentServices, changed: (state: DeletionState) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    /** Opens the confirmation for the open layer (nothing without one, or while a deletion runs). */
    ask(layer: { readonly id: string; readonly label: string } | null): void {
        if (layer !== null && this.#state.phase !== 'running') {
            this.#set({ phase: 'confirm', id: layer.id, label: layer.label, graceDays: LAYER_DELETE_GRACE_DAYS });
        }
    }

    cancel(): void {
        if (this.#state.phase === 'confirm') {
            this.#set(IDLE);
        }
    }

    /** Calls `layers.delete`; true once the layer is gone. */
    async confirm(): Promise<boolean> {
        const state = this.#state;
        if (state.phase !== 'confirm') {
            return false;
        }
        this.#set({ ...state, phase: 'running' });
        const { callables, cityId, notify } = this.#services;
        try {
            const { runsAt } = await callables.call('layers.delete', { cityId, layerId: state.id });
            notify({ key: 'adminContent.layers.deleted', params: { name: state.label, date: runsAt.slice(0, 10) } });
            return true;
        } catch (error) {
            notify({ key: codeOf(error) });
            return false;
        } finally {
            this.#set(IDLE);
        }
    }

    #set(state: DeletionState): void {
        this.#state = state;
        this.#changed(state);
    }
}

/** The API error a callable failed with (`apiError.unavailable` for a failure that is not one: the network). */
export function codeOf(error: unknown): ApiErrorCode {
    return error instanceof CallableFailure ? error.details.code : 'apiError.unavailable';
}
