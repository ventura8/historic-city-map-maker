/**
 * The New city flow (`docs/research/M5-interfaces.md` §1.6; behaviour A50): `#/cities/new`, the project owner's two
 * inputs. The Romanian name (the id follows it, `suggestCityId`; editable, never required; the English name optional):
 * once the admin stops typing, `cities.locate` finds the city on OpenStreetMap and its rectangle is drawn on the map,
 * which flies there (the M5 UX review; `docs/LESSONS.md` 252). One the admin drags (or types) instead is never replaced.
 * `cityBoundsProblem` says why a rectangle cannot be a city, and Create waits; then **Create the city**: `cities.create`
 * with the first offered seed's theme (Settings changes it later with the live preview).
 * The server derives the rest; the viewer's Mapbox token is minted right after (`setup.rotatePublicToken`, best effort:
 * a project without Mapbox gets one from the Setup's Mapbox card). A taken id is answered with a free one, which takes
 * the id field. The done screen links the new city's pages (a page load into it: `switchCity`).
 */
import {
    NEW_CITY_SEEDS,
    cityBoundsProblem,
    citiesCreateRequestSchema,
    isUsableCityId,
    suggestCityId,
    type CallableResponse,
    type CitiesCreateRequest,
    type CityBounds,
    type StartFirstCity,
} from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import type { ContentServices } from '../content/services.js';
import type { MapStatus } from '../layers/map-session.js';
import { tokensOf } from '../settings/theme.js';
import type { NoticeInput } from '../state/state.js';
import { Store } from '../state/store.js';
import type { ScreenPoint, ScreenSize } from './area-drag.js';
import { NewCityMap } from './new-city-map.js';

type AreaProblem = ReturnType<typeof cityBoundsProblem>;

export interface NewCityState {
    readonly nameRo: string;
    readonly nameEn: string;
    /** The id field: the name's suggestion until the admin types one. */
    readonly cityId: string;
    readonly idEdited: boolean;
    /** The dragged (or typed) rectangle, or null before one. */
    readonly bounds: CityBounds | null;
    /** Why the rectangle cannot be a city (`validation.tooSmall`, `.tooBig`, `.bounds`), or null. */
    readonly problem: AreaProblem;
    /** The place OpenStreetMap names for the rectangle `cities.locate` drew, or null (none yet, or the admin's own). */
    readonly located: string | null;
    readonly seed: string;
    readonly map: MapStatus;
    /** `cities.create` is running. */
    readonly busy: boolean;
    /** Why the city was not created (a taken id, a refusal), shown at the form. */
    readonly error: NoticeInput | null;
    /** The city just created: the done screen. */
    readonly created: { readonly cityId: string; readonly name: string } | null;
}

export interface NewCityIntents {
    setNameRo(name: string): void;
    setNameEn(name: string): void;
    setId(cityId: string): void;
    /** The four number fields' rectangle (the keyboard's way: WCAG 2.1.1), or null to clear it. */
    setArea(bounds: CityBounds | null): void;
    /** A drag (or two clicks) on the map, in the map's own pixels. */
    dragArea(from: ScreenPoint, to: ScreenPoint, size: ScreenSize): void;
    /** The map's zoom buttons. */
    zoomBy(delta: number): void;
    attachMap(container: HTMLElement): void;
    detachMap(): void;
    /** **Create the city**; true once it exists. */
    create(): Promise<boolean>;
    /** Another city: the form again, empty. */
    startOver(): void;
}

const INITIAL: NewCityState = {
    nameRo: '',
    nameEn: '',
    cityId: '',
    idEdited: false,
    bounds: null,
    problem: null,
    located: null,
    seed: NEW_CITY_SEEDS[0],
    map: 'none',
    busy: false,
    error: null,
    created: null,
};

/** How long the name rests before `cities.locate` looks for it (one request per name the admin stops typing). */
export const LOCATE_AFTER_MS = 800;

/** Whether the form may be sent: a name, an id a city may take, a usable rectangle, and nothing running. */
export function canCreate(state: Pick<NewCityState, 'nameRo' | 'cityId' | 'bounds' | 'problem' | 'busy'>): boolean {
    return state.nameRo.trim() !== '' && isUsableCityId(state.cityId) && state.bounds !== null && state.problem === null && !state.busy;
}

/** The request of the form, or the first field issue. */
function requestOf(
    state: NewCityState,
    services: ContentServices,
): { readonly request: CitiesCreateRequest } | { readonly error: NoticeInput } {
    const nameEn = state.nameEn.trim();
    const parsed = citiesCreateRequestSchema.safeParse({
        cityId: state.cityId,
        name: nameEn === '' ? { ro: state.nameRo.trim() } : { ro: state.nameRo.trim(), en: nameEn },
        bounds: state.bounds,
        theme: { seedColor: state.seed, tokens: tokensOf(services.theme(state.seed)) },
    });
    return parsed.success ? { request: parsed.data } : { error: { key: 'apiError.invalidRequest' } };
}

class NewCityStore implements AreaStore<NewCityState, NewCityIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<NewCityState>;
    readonly #map: NewCityMap;
    readonly intents: NewCityIntents;
    /** The pending `cities.locate` of the name being typed. */
    #locating: unknown = null;
    #prefilled = false;
    /** The form holds only what the start page was told: nothing of the admin's own to lose. */
    #untouched = false;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<NewCityState>(INITIAL, services.log);
        this.#map = new NewCityMap({
            services,
            status: (map) => {
                this.#cell.update({ map });
            },
            moved: (bounds) => {
                this.#touched();
                this.#area(bounds, false);
            },
        });
        this.intents = {
            setNameRo: (name) => {
                this.#touched();
                this.#name(name);
            },
            setNameEn: (nameEn) => {
                this.#touched();
                this.#cell.update({ nameEn, error: null });
            },
            setId: (cityId) => {
                this.#touched();
                this.#id(cityId.trim().toLowerCase());
            },
            setArea: (bounds) => {
                this.#touched();
                this.#area(bounds, true);
            },
            dragArea: (from, to, size) => {
                this.#touched();
                this.#area(this.#map.boundsOf(from, to, size), true);
            },
            zoomBy: (delta) => {
                this.#map.zoomBy(delta);
            },
            attachMap: (container) => {
                this.#map.attach(container);
            },
            detachMap: () => {
                this.#map.detach();
            },
            create: () => this.#create(),
            startOver: () => {
                this.#cell.update({ ...INITIAL, map: this.#cell.state.map });
                void this.#map.show(null);
            },
        };
    }

    get state(): NewCityState {
        return this.#cell.state;
    }

    subscribe(listener: (state: NewCityState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(): void {
        // The form keeps what was typed until the page goes; nothing is read before the map host shows.
        this.#fromStartPage();
    }

    /**
     * M14 (`docs/research/M14-start-your-map.md` §8): what the start page was told fills an empty form, once, while that city
     * does not exist. `project.json` keeps `firstCity` for ever, so whether it does is the session's roster, not the file's.
     */
    #fromStartPage(): void {
        const city = this.#services.firstCity;
        if (city === undefined || !this.#mayFill() || this.#services.adminCityIds().includes(city.id)) {
            return;
        }
        this.#prefilled = true;
        this.#untouched = true;
        this.#fill(city);
    }

    #mayFill(): boolean {
        const { nameRo, created } = this.#cell.state;
        return !this.#prefilled && nameRo === '' && created === null;
    }

    #touched(): void {
        this.#untouched = false;
    }

    #fill(city: StartFirstCity): void {
        this.#cell.update({ nameRo: city.name.ro, nameEn: city.name.en ?? '', cityId: city.id, idEdited: true });
        if (city.bounds === undefined) {
            this.#name(city.name.ro);
        } else {
            this.#area(city.bounds, true);
        }
    }

    close(): void {
        this.#services.clock.clearTimeout(this.#locating);
        this.#map.detach();
    }

    hasUnsavedChanges(): boolean {
        const state = this.#cell.state;
        return !this.#untouched && state.created === null && (state.nameRo.trim() !== '' || state.bounds !== null);
    }

    destroy(): void {
        this.close();
        this.#cell.update(INITIAL);
    }

    /** The Romanian name; the id follows it until the admin types one, and the city is looked for once it rests. */
    #name(nameRo: string): void {
        const state = this.#cell.state;
        this.#cell.update({ nameRo, cityId: state.idEdited ? state.cityId : suggestCityId(nameRo), error: null });
        this.#services.clock.clearTimeout(this.#locating);
        this.#locating = this.#services.clock.setTimeout(() => void this.#locate(nameRo.trim()), LOCATE_AFTER_MS);
    }

    /** The id the admin typed; an emptied field takes the name's suggestion again. */
    #id(typed: string): void {
        const nameRo = this.#cell.state.nameRo;
        this.#cell.update(
            typed === '' ? { cityId: suggestCityId(nameRo), idEdited: false, error: null } : { cityId: typed, idEdited: true, error: null },
        );
    }

    /** The admin's own rectangle (null: none), its problem, and (from a drag or the fields) its drawing on the map. */
    #area(bounds: CityBounds | null, draw: boolean): void {
        this.#cell.update({ bounds, problem: bounds === null ? null : cityBoundsProblem(bounds), located: null, error: null });
        if (draw) {
            void this.#map.show(bounds);
        }
    }

    /**
     * `cities.locate` of the name that rested: its rectangle drawn and the map flown to it, unless the admin has one of
     * their own by then, typed another name, or the city exists; nothing found leaves the map to them.
     */
    async #locate(name: string): Promise<void> {
        if (name === '' || !this.#mayLocate()) {
            return;
        }
        const found = await outcomeOf(() => this.#services.callables.call('cities.locate', { name }));
        if (found.ok) {
            this.#located(found.value, name);
        }
    }

    /** The rectangle `cities.locate` found for `name`, drawn and flown to while still asked; none leaves the map as it is. */
    #located(answer: CallableResponse<'cities.locate'>, name: string): void {
        const bounds = answer.bounds;
        if (bounds === null || this.#cell.state.nameRo.trim() !== name || !this.#mayLocate()) {
            return;
        }
        this.#cell.update({ bounds, problem: cityBoundsProblem(bounds), located: answer.place ?? name, error: null });
        this.#map.frame(bounds);
        void this.#map.show(bounds);
    }

    /** No rectangle of the admin's own and no city made yet. */
    #mayLocate(): boolean {
        const state = this.#cell.state;
        return state.created === null && (state.bounds === null || state.located !== null);
    }

    async #create(): Promise<boolean> {
        const state = this.#cell.state;
        const made = requestOf(state, this.#services);
        if ('error' in made || !canCreate(state)) {
            this.#cell.update({ error: 'error' in made ? made.error : { key: 'apiError.invalidRequest' } });
            return false;
        }
        this.#cell.update({ busy: true, error: null });
        const outcome = await outcomeOf(() => this.#services.callables.call('cities.create', made.request));
        if (!outcome.ok) {
            this.#refused(outcome.error);
            return false;
        }
        this.#cell.update({ busy: false, created: { cityId: outcome.value.cityId, name: made.request.name.ro } });
        await this.#viewerToken(outcome.value.cityId);
        return true;
    }

    /** A refusal at the form; a taken id gives way to the free one the server offers. */
    #refused(error: NoticeInput): void {
        const suggestion = error.key === 'apiError.city.idTaken' ? error.params?.['suggestion'] : undefined;
        this.#cell.update({ busy: false, error, ...(suggestion === undefined ? {} : { cityId: suggestion, idEdited: true }) });
    }

    /** The new city's viewer token, minted as Settings' rotation does; a project without Mapbox yet answers no. */
    async #viewerToken(cityId: string): Promise<void> {
        const minted = await outcomeOf(() => this.#services.callables.call('setup.rotatePublicToken', { cityId, audience: 'viewer' }));
        if (!minted.ok) {
            this.#services.log.info('no viewer token for the new city yet', { cityId, reason: minted.error.key });
        }
    }
}

export const CITIES_MODULE: AreaModule<NewCityState, NewCityIntents> = {
    area: 'cities',
    create: (services) => new NewCityStore(services),
};
