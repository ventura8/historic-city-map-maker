import type { ImageryResponse } from '../imagery/api.js';
import { callImagery, refusalOf } from '../imagery/api.js';
import type { ContentServices } from '../content/services.js';
import type { SupersededState } from './state.js';

export const NO_SUPERSEDED: SupersededState = { loading: false, deleting: false, layers: [], versions: 0, tiles: 0, error: null };

type Changed = (state: SupersededState) => void;

function listedState(answer: ImageryResponse<'imagery.listSuperseded'>): SupersededState {
    return { ...NO_SUPERSEDED, ...answer };
}

/** Superseded own-tile versions as the imagery settings section lists and deletes them. */
export class SupersededTiles {
    readonly #services: ContentServices;
    readonly #changed: Changed;
    #state: SupersededState = NO_SUPERSEDED;

    constructor(services: ContentServices, changed: Changed) {
        this.#services = services;
        this.#changed = changed;
    }

    get state(): SupersededState {
        return this.#state;
    }

    clear(): void {
        this.#set(NO_SUPERSEDED);
    }

    async refresh(): Promise<void> {
        this.#set({ ...this.#state, loading: true, error: null });
        try {
            const answer = await callImagery(this.#services.callables, 'imagery.listSuperseded', { cityId: this.#services.cityId });
            this.#set(listedState(answer));
        } catch (error) {
            this.#services.log.warn('superseded list failed', { cityId: this.#services.cityId, error: String(error) });
            this.#services.notify(refusalOf(error));
            this.#set({ ...this.#state, loading: false, error: 'load' });
        }
    }

    async deleteAll(): Promise<void> {
        this.#set({ ...this.#state, deleting: true, error: null });
        try {
            await callImagery(this.#services.callables, 'imagery.deleteSuperseded', { cityId: this.#services.cityId });
            await this.refresh();
        } catch (error) {
            this.#services.log.warn('superseded delete failed', { cityId: this.#services.cityId, error: String(error) });
            this.#services.notify(refusalOf(error));
            this.#set({ ...this.#state, deleting: false, error: 'delete' });
        }
    }

    #set(state: SupersededState): void {
        this.#state = state;
        this.#changed(state);
    }
}
