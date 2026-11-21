/**
 * `<hcm-pois-page>`: `#/pois` and `#/pois/<poiId>` (docs/research/M2c-interfaces.md §1.2, §7; behaviours A32, A33, A34,
 * A38). The list pane (`hcm-poi-list`) beside, or instead of, the detail pane: the page's one map (every listed place, the
 * open one with the drawing tools) above the open place's editor (`hcm-poi-editor`), or, with no place open, a hint. On a
 * compact window the list offers List | Map. The map is created the first time its box shows and destroyed when the
 * page goes (every map load is billed, §3.5). The page's dialogs: delete (one place, or the selection), redraw, move
 * the selection, the photo picker and the import; the export is saved as a file from here.
 */
import type { UiLocale } from '@hcm/shared';
import { cityRoleOfState } from '../shell/city-role.js';
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { WindowClassController } from '../../layout/window-class.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { splitsAt } from '../editing/hcm-list-detail.js';
import { EMPTY } from '../shell/empty.js';
import { confirmDialog, importDialog, isConfirmed, moveDialog, photoPicker, type ConfirmedDialog, type PageDialog } from './poi-dialogs.js';
import { localized, poiHistoryHref, poiText } from './poi-text.js';
import { poiStyles } from './poi-styles.js';
import type {
    BulkActionPort,
    ImportFilePort,
    PlaceEditorPort,
    PoiShapePort,
    PoisIntentsPort,
    PoisViewState,
    PoiValuePort,
} from './pois-port.js';

export const HCM_POIS_PAGE_TAG = 'hcm-pois-page';

/** Saves `text` as a file the browser downloads (a Blob behind a short-lived link). */
export function saveFile(document: Document, file: { readonly name: string; readonly type: string; readonly text: string }): void {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/** The city's categories were listed by the server (an empty list then means the city has none). */
function categoriesListed(view: PoisViewState): boolean {
    return view.categories.status === 'ready' && !view.categories.reconnecting;
}

export class HcmPoisPage extends AreaPage<PoisViewState, PoisIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, dialog: { state: true }, mapView: { state: true } };

    static override readonly styles = poiStyles;

    protected readonly route: AdminRouteIdPort = 'pois';
    declare dialog: PageDialog | null;
    /** The compact list's List | Map choice. */
    declare mapView: boolean;
    readonly #size = new WindowClassController(this);
    #mapHost: HTMLElement | null = null;
    #clicks = 0;

    constructor() {
        super();
        this.dialog = null;
        this.mapView = false;
    }

    protected storeOf(content: ContentPort): AreaPort<PoisViewState, PoisIntentsPort> | null {
        return content.pois;
    }

    get #split(): boolean {
        return splitsAt(this.#size.size);
    }

    /** The map's box shows: side by side, a place is open, or the compact list's Map view. */
    get mapVisible(): boolean {
        return this.#split || this.params.length > 0 || this.mapView;
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#mapHost = null;
    }

    protected override updated(changed: PropertyValues<this>): void {
        super.updated(changed);
        this.#attachMap();
        this.#followClicks();
    }

    #attachMap(): void {
        const host = this.#mapHost;
        if (host !== null && this.mapVisible && this.intents !== null && !host.dataset['attached']) {
            host.dataset['attached'] = 'true';
            this.intents.attachMap(host);
        }
    }

    /** A place clicked on the map opens (the drawing's own shapes are not places). */
    #followClicks(): void {
        const clicked = this.view?.clicked ?? null;
        if (clicked !== null && clicked.seq !== this.#clicks) {
            this.#clicks = clicked.seq;
            this.go([clicked.id]);
        }
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const open = this.params[0] ?? '';
        // The compact list's Map view is the detail pane without a place: the one map box never moves (§3.5).
        const mapOnly = this.mapView && !this.#split;
        return html`<hcm-list-detail
                ?detail=${open !== '' || mapOnly}
                .detailKey=${open}
                .listLabel=${poiText(locale, 'adminContent.pois.list')}
                .detailLabel=${poiText(locale, 'adminContent.pois.detail')}
                .backLabel=${poiText(locale, 'adminContent.common.back')}
                .closeLabel=${poiText(locale, 'adminContent.common.close')}
                @hcm-back=${() => {
                    this.#back(open);
                }}
            >
                <div slot="list">${this.#viewChoice(locale)} ${this.#list(locale, view, open)}</div>
                <div slot="detail" class="detail">${this.#mapBox(locale, view)} ${this.#detail(locale, view, open)}</div>
            </hcm-list-detail>
            ${this.#dialogs(locale, view)}`;
    }

    /** Back (or Close): from a place to the list, from the compact Map view to the list. */
    #back(open: string): void {
        this.mapView = false;
        if (open !== '') {
            this.go([]);
        }
    }

    #viewChoice(locale: UiLocale): TemplateResult {
        if (this.#split) {
            return EMPTY;
        }
        return html`<div class="pane">
            <hcm-segmented-button
                .label=${poiText(locale, 'adminContent.pois.view')}
                .options=${[
                    { value: 'list', label: poiText(locale, 'adminContent.pois.view.list') },
                    { value: 'map', label: poiText(locale, 'adminContent.pois.view.map') },
                ]}
                .value=${this.mapView ? 'map' : 'list'}
                @hcm-change=${(event: CustomEvent<{ readonly value: string }>) => {
                    this.mapView = event.detail.value === 'map';
                }}
            ></hcm-segmented-button>
        </div>`;
    }

    #mapBox(locale: UiLocale, view: PoisViewState): TemplateResult {
        return html`<hcm-admin-map
            .status=${view.map}
            .locale=${locale}
            @hcm-map-host=${(event: CustomEvent<{ readonly container: HTMLElement }>) => {
                this.#mapHost = event.detail.container;
                this.#attachMap();
            }}
            @hcm-zoom=${(event: CustomEvent<{ readonly delta: number }>) => this.intents?.zoomBy(event.detail.delta)}
        ></hcm-admin-map>`;
    }

    #list(locale: UiLocale, view: PoisViewState, open: string): TemplateResult {
        return html`<hcm-poi-list
            .view=${view}
            .intents=${this.intents}
            .locale=${locale}
            .selected=${open}
            .role=${cityRoleOfState(this.state)}
            ?read-only=${this.readOnly}
            @hcm-add=${(event: CustomEvent<{ readonly shape: PoiShapePort }>) => {
                this.#add(event.detail.shape);
            }}
            @hcm-import=${(event: CustomEvent<{ readonly file: ImportFilePort }>) => void this.intents?.chooseImport(event.detail.file)}
            @hcm-export=${(event: CustomEvent<{ readonly selection: boolean }>) => void this.#export(event.detail.selection)}
            @hcm-bulk=${(event: CustomEvent<{ readonly action: BulkActionPort }>) => {
                this.#bulk(event.detail.action, view.selection.length);
            }}
        ></hcm-poi-list>`;
    }

    #detail(locale: UiLocale, view: PoisViewState, open: string): TemplateResult {
        const editor = view.editor;
        if (open === '' || editor === null) {
            return html`<hcm-empty-state icon="place" .text=${poiText(locale, 'adminContent.pois.overview')}></hcm-empty-state>`;
        }
        return editor.status === 'not-found' ? this.#notFound(locale, editor.id) : this.#editor(locale, view, editor);
    }

    #notFound(locale: UiLocale, id: string): TemplateResult {
        return html`<div class="pane">
            <h2 data-detail-heading tabindex="-1">${poiText(locale, 'adminContent.pois.notFound')}</h2>
            <p><a href=${poiHistoryHref(id)}>${poiText(locale, 'adminContent.pois.openHistory')}</a></p>
            <p><a href="#/pois">${poiText(locale, 'adminContent.common.back')}</a></p>
        </div>`;
    }

    #editor(locale: UiLocale, view: PoisViewState, editor: PlaceEditorPort): TemplateResult {
        const value = editor.draft?.value ?? null;
        return html`<hcm-poi-editor
            .editor=${editor}
            .role=${cityRoleOfState(this.state)}
            .assist=${view.assist}
            .traceLayers=${view.traceLayers}
            .traceOpacity=${view.traceOpacity}
            .categories=${view.categories.items}
            .categoriesKnown=${categoriesListed(view)}
            .photos=${[...view.linkedPhotos, ...(view.photos?.items ?? [])]}
            .intents=${this.intents}
            .locale=${locale}
            .centreKnown=${view.frame !== null}
            ?read-only=${this.readOnly}
            .who=${{ self: this.self, people: this.people }}
            @hcm-history=${() => {
                this.app?.intents.navigate({ id: 'history', params: ['poi', editor.id] });
            }}
            @hcm-delete=${() => {
                this.dialog = { kind: 'delete', title: value === null ? '' : localized(locale, value.title) };
            }}
            @hcm-redraw=${(event: CustomEvent<{ readonly shape: PoiShapePort }>) => {
                this.#redraw(event.detail.shape, value);
            }}
            @hcm-pick-photos=${() => {
                this.intents?.loadPhotos();
                this.dialog = { kind: 'photos' };
            }}
        ></hcm-poi-editor>`;
    }

    #add(shape: PoiShapePort): void {
        const id = this.intents?.add(shape);
        if (id !== undefined) {
            this.go([id]);
        }
    }

    /** Redrawing a drawn place asks first: its shape leaves the draft. */
    #redraw(shape: PoiShapePort, value: PoiValuePort | null): void {
        if (value?.geometry === null) {
            this.intents?.redraw(shape);
        } else {
            this.dialog = { kind: 'redraw', shape };
        }
    }

    async #export(selection: boolean): Promise<void> {
        const file = await this.intents?.exportPlaces(selection);
        if (file !== undefined && file !== null) {
            saveFile(this.ownerDocument, file);
        }
    }

    #bulk(action: BulkActionPort, count: number): void {
        if (action.kind === 'publish') {
            void this.intents?.bulk(action);
            return;
        }
        this.dialog = action.kind === 'delete' ? { kind: 'bulk-delete', count } : { kind: 'move', count };
    }

    async #confirm(): Promise<void> {
        const dialog = this.dialog;
        this.dialog = null;
        if (isConfirmed(dialog)) {
            await (CONFIRMATIONS[dialog.kind] as Confirmation)(this.intents, dialog, () => {
                this.go([]);
            });
        }
    }

    #dialogs(locale: UiLocale, view: PoisViewState): TemplateResult {
        const close = (): void => {
            this.dialog = null;
        };
        const intents = this.intents;
        return html`${confirmDialog(locale, this.dialog, { confirm: () => void this.#confirm(), close })}
        ${moveDialog(locale, this.dialog, view.categories.items, {
            move: (category) => {
                this.dialog = null;
                void intents?.bulk({ kind: 'move', category });
            },
            close,
        })}
        ${this.#picker(locale, view, close)}
        ${importDialog(locale, view.importing, view.categories.items, {
            choose: (category) => intents?.setImportCategory(category),
            commit: () => void intents?.commitImport(),
            close: () => intents?.closeImport(),
        })}`;
    }

    #picker(locale: UiLocale, view: PoisViewState, close: () => void): TemplateResult {
        const chosen = chosenPhotos(view);
        const toggle = (id: string): void => {
            this.intents?.edit({ photoIds: chosen.includes(id) ? chosen.filter((photo) => photo !== id) : [...chosen, id] });
        };
        const handlers = { toggle, close, more: () => this.intents?.morePhotos(), retry: () => this.intents?.retry() };
        return photoPicker(locale, this.dialog?.kind === 'photos', { photos: view.photos, chosen }, handlers);
    }
}

/** The open place's linked photos. */
function chosenPhotos(view: PoisViewState): readonly string[] {
    const draft = view.editor?.draft ?? null;
    return draft === null ? [] : draft.value.photoIds;
}

type Confirmations = {
    readonly [K in ConfirmedDialog['kind']]: (
        intents: PoisIntentsPort | null,
        dialog: Extract<ConfirmedDialog, { kind: K }>,
        back: () => void,
    ) => Promise<void>;
};

/** What each confirmed question does. */
const CONFIRMATIONS: Confirmations = {
    redraw: (intents, dialog) => {
        intents?.redraw(dialog.shape);
        return Promise.resolve();
    },
    'bulk-delete': async (intents) => {
        await intents?.bulk({ kind: 'delete' });
    },
    delete: async (intents, _dialog, back) => {
        const outcome = await intents?.remove();
        if (outcome?.ok === true) {
            back();
        }
    },
};

type Confirmation = (intents: PoisIntentsPort | null, dialog: ConfirmedDialog, back: () => void) => Promise<void>;

/** Registers `<hcm-pois-page>` once; calling it again is a no-op. */
export function defineHcmPoisPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_POIS_PAGE_TAG) === undefined) {
        registry.define(HCM_POIS_PAGE_TAG, HcmPoisPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-pois-page': HcmPoisPage;
    }
}
