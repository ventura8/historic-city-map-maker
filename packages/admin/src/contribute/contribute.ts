/**
 * The Contribute page's store (M13, `docs/research/M13-roles.md` §§3, 4; behaviours A92, A93): `#/contribute/<city>` asks for a
 * role, `#/contribute/<city>/<photoId>` suggests a place or a correction with the photo editor's map session. Everything goes
 * through the signed-in callables: a visitor reads no Firestore and needs no role. The address is the only place the city
 * comes from: an account may have no city at all.
 */
import {
    contentLocale,
    bboxCenter,
    bearingBetween,
    roundTo,
    type CallableRequest,
    type ContributeContextResponse,
    type LngLat,
    type UiLocale,
    type MapView,
    type SuggestionProposal,
} from '@hcm/shared';

import { outcomeOf, type Outcome } from '../app/services.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import type { ContentServices } from '../content/services.js';
import type { MapStatus } from '../photos/map.js';
import { PhotoMapSession } from '../photos/map.js';
import type { PhotoMapFactory } from '../photos/ports.js';
import type { NoticeInput } from '../state/state.js';
import { Store } from '../state/store.js';

export interface ContributeState {
    readonly status: 'loading' | 'ready' | 'error';
    readonly context: ContributeContextResponse | null;
    readonly failure: NoticeInput | null;
    readonly busy: boolean;
    readonly problem: NoticeInput | null;
    readonly thanks: { readonly remaining: number } | null;
    readonly proposal: SuggestionProposal;
    readonly map: MapStatus;
    readonly picking: boolean;
}

interface ContributeWords {
    readonly reason?: string | undefined;
    readonly sourceUrl?: string | undefined;
    readonly credit?: string | undefined;
}

export interface ContributeIntents {
    retry(): void;
    request(role: 'uploader' | 'moderator', reason: string, credit: string): Promise<Outcome<{ readonly status: 'pending' }>>;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    edit(patch: SuggestionProposal): void;
    placeAtCentre(): void;
    pickDirection(): Promise<void>;
    cancelPick(): void;
    suggest(words: ContributeWords): Promise<Outcome<{ readonly remainingToday: number }>>;
}

const INITIAL: ContributeState = {
    status: 'loading',
    context: null,
    failure: null,
    busy: false,
    problem: null,
    thanks: null,
    proposal: {},
    map: 'none',
    picking: false,
};

const ZOOM = 14;

/** `undefined` values are absent: a schema's strict object wants the keys left out. */
function defined<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined && field !== '')) as T;
}

function trimmed(text: string | undefined): string | undefined {
    return text?.trim();
}

function currentOfPhoto(photo: ContributeContextResponse['photo'], locale: UiLocale): Readonly<Record<string, unknown>> {
    return photo === null ? {} : { ...photo, dateText: photo.dateText?.[contentLocale(locale)] };
}

/**
 * What the form says that the photo does not (M13 §4): the form starts from the photo's place, and a date correction must not carry
 * it, or approving it would move a photo back. An end year names its start; a date text says the language it was typed in.
 */
export function changedFrom(photo: ContributeContextResponse['photo'], proposal: SuggestionProposal, locale: UiLocale): SuggestionProposal {
    const current = currentOfPhoto(photo, locale);
    const kept = Object.entries(proposal).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value));
    const changed: SuggestionProposal = Object.fromEntries(kept);
    const start = proposal.year ?? current['year'];
    return defined({
        ...changed,
        ...(changed.yearEnd === undefined ? {} : { year: start as number | undefined }),
        ...(changed.dateText === undefined ? {} : { dateLocale: contentLocale(locale) }),
    });
}

/** A placed photo is corrected; a photo with no place gets one. */
function kindOf(context: ContributeContextResponse | null): 'place' | 'correction' {
    return context?.photo?.location === undefined ? 'place' : 'correction';
}

class ContributeStore implements AreaStore<ContributeState, ContributeIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<ContributeState>;
    #map: PhotoMapSession | null = null;
    #cityId = '';
    #photoId: string | undefined;
    readonly intents: ContributeIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<ContributeState>(INITIAL, services.log);
        this.intents = {
            retry: () => {
                void this.#load();
            },
            request: (role, reason, credit) => this.#request(role, reason, credit),
            attachMap: (container) => {
                this.#attach(container);
            },
            zoomBy: (delta) => this.#map?.zoomBy(delta),
            edit: (patch) => {
                this.#edit(patch);
            },
            placeAtCentre: () => {
                this.#placeAtCentre();
            },
            pickDirection: () => this.#pickDirection(),
            cancelPick: () => {
                this.#map?.cancelPick();
            },
            suggest: (words) => this.#suggest(words),
        };
    }

    get state(): ContributeState {
        return this.#cell.state;
    }

    subscribe(listener: (state: ContributeState) => void) {
        return this.#cell.subscribe(listener);
    }

    /** `#/contribute/<city>` and `#/contribute/<city>/<photoId>`. */
    open(params: readonly string[]): void {
        this.#cityId = params[0] ?? '';
        this.#photoId = params[1];
        void this.#load();
    }

    close(): void {
        this.#detach();
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.#detach();
    }

    #detach(): void {
        this.#map?.detach();
        this.#map = null;
        this.#cell.update({ map: 'none' });
    }

    async #load(): Promise<void> {
        this.#cell.update({ status: 'loading', failure: null, thanks: null, problem: null });
        const request = defined({ cityId: this.#cityId, photoId: this.#photoId });
        const outcome = await outcomeOf(() => this.#services.callables.call('contribute.context', request));
        if (outcome.ok) {
            const { location, bearing } = outcome.value.photo ?? {};
            this.#cell.update({ status: 'ready', context: outcome.value, proposal: defined({ location, bearing }) });
        } else {
            this.#cell.update({ status: 'error', context: null, failure: outcome.error });
        }
    }

    async #request(role: 'uploader' | 'moderator', reason: string, credit: string): Promise<Outcome<{ readonly status: 'pending' }>> {
        this.#cell.update({ busy: true, problem: null });
        const request = defined({ cityId: this.#cityId, role, reason: reason.trim(), credit: credit.trim() });
        const outcome = await outcomeOf(() => this.#services.callables.call('contribute.request', request));
        this.#cell.update({ busy: false, problem: outcome.ok ? null : outcome.error });
        if (outcome.ok) {
            await this.#load();
        }
        return outcome;
    }

    /** One map per page visit, wearing the city's public token: a visitor cannot read the admin's. */
    #attach(container: HTMLElement): void {
        const context = this.#cell.state.context;
        const maps = this.#services.maps;
        if (context === null || this.#map !== null) {
            return;
        }
        const token = context.city.publicToken;
        const factory: PhotoMapFactory | null =
            maps === null || maps === undefined
                ? null
                : { create: (host, options) => maps.create(host, { ...options, ...(token === undefined ? {} : { token }) }) };
        this.#map = new PhotoMapSession(factory, {
            status: (map) => {
                this.#mapStatus(map);
            },
            select: () => undefined,
            pin: (position) => {
                this.#edit({ location: { lat: position[1], lng: position[0] } });
            },
            refused: () => {
                this.#services.notify({ key: 'apiError.suggestion.outsideCity' });
            },
        });
        const view: MapView = { center: bboxCenter(context.city.bounds), zoom: ZOOM, bearing: 0 };
        void this.#map.attach(container, { bounds: context.city.bounds, view, locale: this.#services.locale() });
    }

    #mapStatus(map: MapStatus): void {
        this.#cell.update({ map });
        if (map === 'ready') {
            void this.#map?.editPin(this.#cell.state.proposal.location ?? null);
        }
    }

    #edit(patch: SuggestionProposal): void {
        const merged = defined({ ...this.#cell.state.proposal, ...patch });
        this.#cell.update({ proposal: merged, thanks: null });
        if (patch.location !== undefined) {
            void this.#map?.editPin(patch.location);
        }
    }

    #placeAtCentre(): void {
        const centre: LngLat | null = this.#map?.centre() ?? null;
        if (centre !== null) {
            this.#edit({ location: { lat: roundTo(centre[1], 7), lng: roundTo(centre[0], 7) } });
        }
    }

    async #pickDirection(): Promise<void> {
        const location = this.#cell.state.proposal.location;
        if (location === undefined || this.#map === null) {
            return;
        }
        this.#cell.update({ picking: true });
        const target = await this.#map.pick();
        this.#cell.update({ picking: false });
        await this.#map.editPin(location);
        if (target !== null) {
            this.#edit({ bearing: roundTo(bearingBetween([location.lng, location.lat], target), 1) });
        }
    }

    #submission(words: ContributeWords): CallableRequest<'suggestions.submit'> {
        const { context, proposal } = this.#cell.state;
        const clean = defined({ reason: trimmed(words.reason), sourceUrl: trimmed(words.sourceUrl), credit: trimmed(words.credit) });
        const changed = changedFrom(context?.photo ?? null, proposal, this.#services.locale());
        return { cityId: this.#cityId, photoId: this.#photoId ?? '', kind: kindOf(context), proposal: changed, ...clean };
    }

    async #suggest(words: ContributeWords): Promise<Outcome<{ readonly remainingToday: number }>> {
        const request = this.#submission(words);
        if (Object.keys(request.proposal).length === 0) {
            const problem: NoticeInput = { key: 'apiError.suggestion.noChange' };
            this.#cell.update({ problem, thanks: null });
            return { ok: false, error: problem };
        }
        this.#cell.update({ busy: true, problem: null });
        const outcome = await outcomeOf(() => this.#services.callables.call('suggestions.submit', request));
        this.#cell.update({
            busy: false,
            problem: outcome.ok ? null : outcome.error,
            thanks: outcome.ok ? { remaining: outcome.value.remainingToday } : null,
        });
        return outcome;
    }
}

export const CONTRIBUTE_MODULE: AreaModule<ContributeState, ContributeIntents> = {
    area: 'contribute',
    create: (services) => new ContributeStore(services),
};
