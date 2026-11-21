/**
 * M8 (`docs/research/M8-join-interfaces.md` §6): what the admin does about one date's frames. **Join frames** calls
 * `imagery.join` (the server imports what is missing and holds the join until its frames are ready); **Add {year}** saves
 * the year among the city's target years and searches again, because only a search ranks the scenes anew. One action
 * runs at a time; a join's refusal stays beside its button (by the request's first frame) until the next one. M18 item 4
 * (`docs/research/M18-improvements.md`): a join refused because a frame's layer is still being processed or published
 * (`apiError.imagery.joinLayerBusy`) says so in plain words, and the snackbar offers **Join when it ends**: the admin then asks
 * again every `JOIN_WAIT_MS` while it is open, and starts the join by itself once that work ended (at most `JOIN_WAIT_TRIES`).
 */
import { FIRESTORE_PATHS, type ImagerySettings } from '@hcm/shared';

import type { ContentServices, WriteOutcome } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { callImagery, refusalOf } from './api.js';

export interface JoinActionsState {
    /** The first frame of the join on its way. */
    readonly joining: string | null;
    readonly joinRefusal: { readonly id: string; readonly notice: NoticeInput } | null;
    /** The target year being saved. */
    readonly addingYear: number | null;
}

export const IDLE_JOIN: JoinActionsState = { joining: null, joinRefusal: null, addingYear: null };

/** How often a waiting join asks again, and how many times (two hours). */
export const JOIN_WAIT_MS = 60_000;
export const JOIN_WAIT_TRIES = 120;
const BUSY = 'apiError.imagery.joinLayerBusy';

/** What Add {year} needs to know: the city's settings as read, their version, and the search that ranks again. */
export interface YearTarget {
    readonly settings: ImagerySettings;
    readonly version: string | null;
    readonly search: () => Promise<void>;
}

export class JoinActions {
    readonly #services: ContentServices;
    readonly #changed: (state: Partial<JoinActionsState>) => void;
    #busy = false;
    #timer: unknown = null;

    constructor(services: ContentServices, changed: (state: Partial<JoinActionsState>) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    /** `imagery.join` of the frames: the join version's id (the page opens it), or null when refused or not run. */
    async join(entityIds: readonly string[]): Promise<string | null> {
        const [id] = entityIds;
        if (this.#busy || id === undefined) {
            return null;
        }
        this.stop();
        this.#busy = true;
        this.#changed({ joining: id, joinRefusal: null });
        const answer = await this.#ask(entityIds);
        this.#busy = false;
        if (typeof answer === 'string') {
            this.#changed({ joining: null });
            return answer;
        }
        this.#changed({ joining: null, joinRefusal: { id, notice: answer } });
        if (answer.key === BUSY) {
            this.#offerWait(entityIds, answer);
        }
        return null;
    }

    /** Stops a join waiting for its layer (the area ends, or another join is asked). */
    stop(): void {
        if (this.#timer !== null) {
            this.#services.clock.clearTimeout(this.#timer);
            this.#timer = null;
        }
    }

    /** The join version's id, or the refusal. */
    async #ask(entityIds: readonly string[]): Promise<string | NoticeInput> {
        const { cityId, callables } = this.#services;
        try {
            return (await callImagery(callables, 'imagery.join', { cityId, entityIds: [...entityIds] })).versionId;
        } catch (error) {
            return refusalOf(error);
        }
    }

    /** The plain words of the busy layer in the snackbar, with Join when it ends. */
    #offerWait(entityIds: readonly string[], notice: NoticeInput): void {
        const run = (): void => {
            this.#changed({ joinRefusal: { id: entityIds[0] ?? '', notice: { key: 'adminContent.imagery.join.waitingFree' } } });
            this.#wait(entityIds, JOIN_WAIT_TRIES);
        };
        this.#services.notify({ ...notice, action: { key: 'adminContent.imagery.join.whenFree', run } });
    }

    #wait(entityIds: readonly string[], tries: number): void {
        this.stop();
        this.#timer = this.#services.clock.setTimeout(() => {
            this.#timer = null;
            void this.#tryAgain(entityIds, tries - 1);
        }, JOIN_WAIT_MS);
    }

    /** One more ask: busy again waits on (while tries are left), anything else ends the wait and is said. */
    async #tryAgain(entityIds: readonly string[], tries: number): Promise<void> {
        const answer = await this.#ask(entityIds);
        if (typeof answer === 'string') {
            this.#changed({ joinRefusal: null });
            this.#services.notify({ key: 'adminContent.imagery.join.started' });
            return;
        }
        if (answer.key === BUSY && tries > 0) {
            this.#wait(entityIds, tries);
            return;
        }
        this.#changed({ joinRefusal: { id: entityIds[0] ?? '', notice: answer } });
        this.#services.notify(answer);
    }

    /** Saves `year` among the target years, then ranks again; true once it is saved (a search that fails says so on Find). */
    async addYear(year: number, target: YearTarget): Promise<boolean> {
        if (this.#busy) {
            return false;
        }
        this.#busy = true;
        this.#changed({ addingYear: year });
        const { settings, version, search } = target;
        const imagery = { ...settings, targetYears: [...settings.targetYears, year].toSorted((a, b) => a - b) };
        const outcome = await this.#services.store.update(FIRESTORE_PATHS.city(this.#services.cityId), { imagery }, version);
        this.#report(outcome);
        this.#changed({ addingYear: null });
        this.#busy = false;
        if (outcome.ok) {
            void search();
        }
        return outcome.ok;
    }

    /** What the snackbar says (the words of Settings, whose save this is); a refusal for access makes the shell ask again. */
    #report(outcome: WriteOutcome): void {
        const { denied, notify } = this.#services;
        if (!outcome.ok && outcome.reason === 'denied') {
            denied();
        }
        notify({ key: outcome.ok ? 'adminContent.settings.saved' : `adminContent.settings.refused.${outcome.reason}` });
    }
}
