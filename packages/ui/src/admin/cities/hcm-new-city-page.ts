/**
 * `<hcm-new-city-page>`: `#/cities/new` (`docs/research/M5-interfaces.md` §1.6; behaviour A50), the project owner's New
 * city flow in two inputs: the Romanian name (the id follows it; once typing rests, the city is found on OpenStreetMap and
 * its rectangle drawn), **Create the city**. The id and the English name are there to change, never required (an id a
 * city cannot take is said at its field); the rectangle can be dragged on the map instead, its four edges are number
 * fields too (the keyboard's way, WCAG 2.1.1: `area-edges.ts`), and two clicks on the map make it as a drag does (the
 * single-pointer way, WCAG 2.5.7). A rectangle that cannot be a city says why beside the map and Create waits. The done
 * screen links the new city's pages (a page load into it); its heading takes the focus and one live region says what
 * happened. While the page draws, the gesture on the map makes the rectangle and the map stays still
 * (`area-gesture.ts`); **Move the map** hands the pointer back to the map, **Draw the area** takes it again.
 */
import { CITY_SPAN_LIMITS, isUsableCityId, type CityBounds, type UiLocale } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { visuallyHidden } from '../../components/styles.js';
import { MAPBOX_GL_CSS_URL } from '../../map/mapbox-loader.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { defineHcmAdminMap } from '../map/hcm-admin-map.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import { trackAreaFunnels } from '../editing/area-funnel.js';
import { completeBounds, EDGES, nextDraft, type Edge, type EdgeDraft } from './area-edges.js';
import { AreaGesture } from './area-gesture.js';
import type { NewCityIntentsPort, NewCityViewState } from './cities-port.js';
import { newCityFunnel } from './new-city-funnel.js';
import { publicAddressLink, publicAddressStyles } from './public-address.js';

export const HCM_NEW_CITY_PAGE_TAG = 'hcm-new-city-page';

/** Why the rectangle cannot be a city, as the page says it (only typed edges can cross: a drag is always in order). */
const PROBLEMS = {
    'validation.tooSmall': 'adminContent.cities.new.areaTooSmall',
    'validation.tooBig': 'adminContent.cities.new.areaTooBig',
    'validation.bounds': 'adminContent.cities.new.areaBounds',
} as const;

/** The edges typed while the rectangle is incomplete, and the rectangle they belong to (another one replaces them). */
interface TypedEdges {
    readonly base: CityBounds | null;
    readonly edges: EdgeDraft;
}

const newCityStyles = css`
    form {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-inline-size: 960px;
    }

    /* The area's group is a fieldset without the browser's frame: the map keeps the pane's whole width on a phone. */
    fieldset {
        min-inline-size: 0;
        margin: 0;
        padding: 0;
        border: 0;
    }

    .map-wrap {
        position: relative;
        block-size: clamp(240px, 60vh, 480px);
    }

    .map-wrap hcm-admin-map {
        position: absolute;
        inset: 0;
    }

    .edges {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 8px;
    }
`;

/** The form holds a name, an id a city may take and a rectangle that can be a city. */
function filled(view: NewCityViewState): boolean {
    return view.nameRo.trim() !== '' && isUsableCityId(view.cityId) && view.bounds !== null && view.problem === null;
}

/** An id typed that no city may take (an empty field takes the name's suggestion). */
function wrongId(view: NewCityViewState): boolean {
    return view.cityId !== '' && !isUsableCityId(view.cityId);
}

export class HcmNewCityPage extends AreaPage<NewCityViewState, NewCityIntentsPort> {
    static override readonly properties = {
        ...AreaPage.properties,
        drawing: { state: true },
        typed: { state: true },
        mapCss: { attribute: false },
    };

    /** A form, not a list and detail page: the shell's page area scrolls it (the map sits below the names). */
    static override readonly fillsPage: boolean = false;

    static override readonly styles = [...editingStyles, visuallyHidden, newCityStyles, publicAddressStyles];

    protected readonly route: AdminRouteIdPort = 'cities';
    readonly #gesture = new AreaGesture((from, to, size) => {
        this.intents?.dragArea(from, to, size);
    });
    /** The gesture on the map draws the rectangle (rather than moving the map). */
    declare drawing: boolean;
    /** The edges typed so far while they make no rectangle yet, or null. */
    declare typed: TypedEdges | null;
    /** The city whose done screen took the focus already. */
    #focused: string | null = null;
    /** mapbox-gl.css of the pinned release for the map's shadow root (empty in tests: no network). */
    declare mapCss: string;

    constructor() {
        super();
        this.drawing = true;
        this.typed = null;
        this.mapCss = MAPBOX_GL_CSS_URL;
    }

    protected storeOf(content: ContentPort): AreaPort<NewCityViewState, NewCityIntentsPort> | null {
        return content.cities;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.cities.new.title')}</h2>
            <p class="visually-hidden" role="status" data-live>${this.#news(locale, view)}</p>
            ${view.created === null ? this.#form(locale, view) : this.#done(locale, view.created)}
        </div>`;
    }

    /** What the page's one live region says: the city made, or the place found (both also shown in the page). */
    #news(locale: UiLocale, view: NewCityViewState): string {
        if (view.created !== null) {
            return contentText(locale, 'adminContent.cities.created.title', { city: view.created.name });
        }
        return view.located === null ? '' : contentText(locale, 'adminContent.cities.new.located', { place: view.located });
    }

    /** The done screen replaced the form: its heading takes the focus, which would otherwise fall to the page. */
    protected override updated(): void {
        // The wizard's funnel (§200): what changed since the last render, as codes.
        trackAreaFunnels(this, this.view, (view) => [newCityFunnel(view)]);
        const cityId = this.view?.created?.cityId;
        if (cityId !== undefined && cityId !== this.#focused) {
            this.#focused = cityId;
            this.#focusHeading();
        }
    }

    #focusHeading(): void {
        this.renderRoot.querySelector<HTMLElement>('[data-detail-heading]')?.focus();
    }

    /** Create the city; once it exists, the city menu lists it at once (not after its minute). */
    async #create(): Promise<void> {
        if ((await this.intents?.create()) === true) {
            await this.app?.intents.refreshCities?.(true);
        }
    }

    #form(locale: UiLocale, view: NewCityViewState): TemplateResult {
        const submit = (event: SubmitEvent): void => {
            event.preventDefault();
            void this.#create();
        };
        return html`<form @submit=${submit} novalidate>
            <p class="note">${contentText(locale, 'adminContent.cities.new.intro')}</p>
            ${this.#names(locale, view)} ${this.#area(locale, view)} ${this.#error(locale, view)}
            <div class="actions">
                <hcm-button variant="filled" icon="add_location_alt" ?disabled=${!this.#ready(view)} @click=${this.#submit}
                    >${contentText(locale, view.busy ? 'adminContent.cities.new.creating' : 'adminContent.cities.new.create')}</hcm-button
                >
            </div>
        </form>`;
    }

    /** The kit's button is not a native submit button: its click submits the form it sits in. */
    readonly #submit = (event: Event): void => {
        (event.currentTarget as HTMLElement).closest('form')?.requestSubmit();
    };

    #ready(view: NewCityViewState): boolean {
        return filled(view) && !view.busy && !this.readOnly;
    }

    #names(locale: UiLocale, view: NewCityViewState): TemplateResult {
        const intents = this.intents;
        const value = (event: Event): string => (event.currentTarget as HTMLInputElement).value;
        return html`<div class="field">
                <label for="name-ro">${contentText(locale, 'adminContent.cities.new.nameRo')}</label>
                <input
                    id="name-ro"
                    required
                    maxlength="100"
                    .value=${view.nameRo}
                    @input=${(event: Event) => intents?.setNameRo(value(event))}
                />
            </div>
            <div class="field">
                <label for="city-id">${contentText(locale, 'adminContent.cities.new.id')}</label>
                <input
                    id="city-id"
                    maxlength="32"
                    spellcheck="false"
                    autocomplete="off"
                    aria-invalid=${wrongId(view) ? 'true' : nothing}
                    aria-describedby=${wrongId(view) ? 'city-id-help city-id-problem' : 'city-id-help'}
                    .value=${view.cityId}
                    @change=${(event: Event) => intents?.setId(value(event))}
                />
                <p id="city-id-help" class="note">
                    ${contentText(locale, 'adminContent.cities.new.idHelp', { cityId: view.cityId || '…' })}
                </p>
                ${
                    wrongId(view)
                        ? html`<p id="city-id-problem" class="alert" data-id-problem>
                              ${contentText(locale, 'adminContent.cities.new.idInvalid')}
                          </p>`
                        : EMPTY
                }
            </div>
            <div class="field">
                <label for="name-en">${contentText(locale, 'adminContent.cities.new.nameEn')}</label>
                <input id="name-en" maxlength="100" .value=${view.nameEn} @input=${(event: Event) => intents?.setNameEn(value(event))} />
            </div>`;
    }

    #area(locale: UiLocale, view: NewCityViewState): TemplateResult {
        const problem = view.problem === null ? null : PROBLEMS[view.problem];
        return html`<fieldset class="field">
            <legend>${contentText(locale, 'adminContent.cities.new.area')}</legend>
            <p class="note" id="area-help">${contentText(locale, 'adminContent.cities.new.areaHelp')}</p>
            ${this.#mapTools(locale)}
            <div class="map-wrap">
                <hcm-admin-map
                    .status=${view.map}
                    .locale=${locale}
                    .cssUrl=${this.mapCss}
                    @hcm-map-host=${this.#mapHost}
                    @hcm-zoom=${(event: CustomEvent<{ readonly delta: number }>) => this.intents?.zoomBy(event.detail.delta)}
                ></hcm-admin-map>
            </div>
            ${
                view.located === null
                    ? EMPTY
                    : html`<p class="note" data-area-located>
                          ${contentText(locale, 'adminContent.cities.new.located', { place: view.located })}
                      </p>`
            }
            ${problem === null ? EMPTY : html`<p class="alert" role="alert" data-area-problem>${contentText(locale, problem)}</p>`}
            ${this.#edges(locale, view)}
        </fieldset>`;
    }

    /** The map's element: the store opens the map in it, the gesture listens on it. */
    readonly #mapHost = (event: Event): void => {
        const container = (event as CustomEvent<{ readonly container: HTMLElement }>).detail.container;
        this.#gesture.attach(container);
        this.intents?.attachMap(container);
    };

    #mapTools(locale: UiLocale): TemplateResult {
        const toggle = (): void => {
            this.#gesture.setDrawing(!this.#gesture.drawing);
            this.drawing = this.#gesture.drawing;
        };
        return html`<div class="actions">
            <hcm-button variant="tonal" icon=${this.drawing ? 'explore' : 'crop_free'} @click=${toggle}
                >${contentText(locale, this.drawing ? 'adminContent.cities.new.moveMap' : 'adminContent.cities.new.drawArea')}</hcm-button
            >
        </div>`;
    }

    /** The edges on screen: the ones typed while they make no rectangle yet, else the rectangle's (none: empty). */
    #edgeValues(view: NewCityViewState): EdgeDraft {
        const typed = this.typed;
        return typed !== null && typed.base === view.bounds ? typed.edges : (view.bounds ?? {});
    }

    /** One edge typed: four make the rectangle; fewer stay typed, the rectangle on the map gone until they are four. */
    #typeEdge(view: NewCityViewState, edge: Edge, text: string): void {
        const edges = nextDraft(this.#edgeValues(view), edge, text);
        const bounds = completeBounds(edges);
        this.typed = bounds === null ? { base: null, edges } : null;
        if (bounds !== null || view.bounds !== null) {
            this.intents?.setArea(bounds);
        }
    }

    /** The rectangle's four edges (degrees), the keyboard's way to the same area. */
    #edges(locale: UiLocale, view: NewCityViewState): TemplateResult {
        const values = this.#edgeValues(view);
        const change =
            (edge: Edge) =>
            (event: Event): void => {
                this.#typeEdge(view, edge, (event.currentTarget as HTMLInputElement).value);
            };
        const incomplete = completeBounds(values) === null && Object.keys(values).length > 0;
        return html`<div class="edges">
                ${EDGES.map(
                    (edge) =>
                        html`<div class="field">
                            <label for=${`edge-${edge}`}>${contentText(locale, `adminContent.settings.${edge}`)}</label>
                            <input
                                id=${`edge-${edge}`}
                                type="number"
                                inputmode="decimal"
                                step="0.00001"
                                .value=${String(values[edge] ?? '')}
                                @change=${change(edge)}
                            />
                        </div>`,
                )}
            </div>
            ${incomplete ? html`<p class="note" data-edges-incomplete>${contentText(locale, 'adminContent.cities.new.edgesIncomplete')}</p>` : EMPTY}
            <p class="note">
                ${contentText(locale, 'adminContent.cities.new.areaLimits', { min: String(CITY_SPAN_LIMITS.minDeg), max: String(CITY_SPAN_LIMITS.maxDeg) })}
            </p>`;
    }

    #error(locale: UiLocale, view: NewCityViewState): TemplateResult {
        return view.error === null ? EMPTY : html`<p class="alert" role="alert">${noticeOf(locale, view.error)}</p>`;
    }

    /** The city exists: what comes next, each a page of the new city (a page load into it). */
    #done(locale: UiLocale, created: { readonly cityId: string; readonly name: string }): TemplateResult {
        const open = (id: AdminRouteIdPort) => (): void => {
            this.app?.intents.switchCity?.(created.cityId, { id, params: [] });
        };
        const again = (): void => {
            this.intents?.startOver();
        };
        // The imagery is looked for only once USGS is set up (the harvest needs it).
        const usgs = this.state?.setup?.steps.usgs.state === 'ok';
        return html`<p data-city-created=${created.cityId}>
                ${contentText(locale, 'adminContent.cities.created.title', { city: created.name })}
            </p>
            <p class="note">${contentText(locale, 'adminContent.cities.created.unpublished')}</p>
            <p class="note" data-harvest=${usgs ? 'now' : 'later'}>
                ${contentText(locale, usgs ? 'adminContent.cities.created.harvest' : 'adminContent.cities.created.harvestLater')}
            </p>
            <p class="note">${contentText(locale, 'adminContent.cities.created.siteLater')}</p>
            ${publicAddressLink(locale, created.cityId)}
            <p class="note">${contentText(locale, 'adminContent.cities.created.exportInstead')}</p>
            <h3>${contentText(locale, 'adminContent.cities.created.next')}</h3>
            <div class="actions">
                <hcm-button variant="filled" icon="photo_library" @click=${open('photos')}
                    >${contentText(locale, 'adminContent.cities.created.photos')}</hcm-button
                >
                <hcm-button variant="tonal" icon="place" @click=${open('pois')}
                    >${contentText(locale, 'adminContent.cities.created.places')}</hcm-button
                >
                <hcm-button variant="tonal" icon="satellite_alt" @click=${open('imagery')}
                    >${contentText(locale, 'adminContent.cities.created.imagery')}</hcm-button
                >
                <hcm-button variant="text" icon="add_location_alt" @click=${again}
                    >${contentText(locale, 'adminContent.cities.new.title')}</hcm-button
                >
            </div>`;
    }

    override disconnectedCallback(): void {
        this.#gesture.detach();
        this.intents?.detachMap();
        super.disconnectedCallback();
    }
}

/** Registers the New city page and the admin map it shows; the kit and the editing kit come with `defineAdminElements`. */
export function defineHcmNewCityPage(registry: CustomElementRegistry = customElements): void {
    defineHcmAdminMap(registry);
    if (registry.get(HCM_NEW_CITY_PAGE_TAG) === undefined) {
        registry.define(HCM_NEW_CITY_PAGE_TAG, HcmNewCityPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-new-city-page': HcmNewCityPage;
    }
}
