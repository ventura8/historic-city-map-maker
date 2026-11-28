/**
 * `<hcm-georef-page>`: the georeferencer, `#/georef/<versionId>` (`docs/research/M3-interfaces.md` §10.4; behaviour
 * A16). The scan and the reference map side by side (a Scan | Map switch on compact windows), **Add pairs** (then a click
 * on each, in either order; Esc drops the half pair) or **Add at the centres** from the keyboard, the transform as a
 * radio group (one without enough pairs is disabled with the count missing), the fit's errors and the warning over the
 * city's threshold, the live warped preview and its opacity, the residual table, and **Save**, which queues the job and
 * opens the version's page. A version that takes no points shows them read-only. A right-click, a long press or the
 * ContextMenu key on either pane opens the context menu (`./georef-menu-host.ts`): Add a point here, Move and Delete this
 * point, Undo; nothing that edits on a read-only version.
 */
import { createLogger } from '@hcm/shared';
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { defineHcmCompass } from '../../viewer/hcm-compass.js';
import { deepActiveElement } from '../../components/focus.js';
import { MAPBOX_GL_CSS_URL } from '../../map/mapbox-loader.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { errorTemplate, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { labelText } from '../imagery/imagery-text.js';
import { when, withValue } from '../imagery/when.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { trackAreaFunnels } from '../editing/area-funnel.js';
import { enterScreen, FullScreenInert, leaveScreen, screenElement } from './full-screen.js';
import type { GeorefMenuOpen } from './georef-menu-host.js';
import type * as GeorefMenuChunk from './georef-menu.js';
import { panes } from './georef-panes.js';
import { guide, previewControls, summary, tools, transforms, type GeorefContext } from './georef-parts.js';
import type { GeorefIntentsPort, GeorefVersionPort, GeorefViewState } from './georef-port.js';
import { georefStyles } from './georef-styles.js';
import type { HcmScanViewer } from './hcm-scan-viewer.js';
import { residualTable, type ResidualSort } from './residual-table.js';
import { SUGGESTIONS_HEADING_ID, suggestionsPanel, suggestionsStyles, type SuggestionDecision } from './suggestions-panel.js';
import { georefFunnel } from './georef-funnel.js';

export const HCM_GEOREF_PAGE_TAG = 'hcm-georef-page';

const log = createLogger('georef-page');

class HcmGeorefPage extends AreaPage<GeorefViewState, GeorefIntentsPort> {
    static override readonly fillsPage: boolean = true;

    static override readonly properties = {
        ...AreaPage.properties,
        sort: { state: true },
        full: { state: true },
        fullRefused: { state: true },
        mapCss: { attribute: false },
        menu: { state: true },
    };

    static override readonly styles = [...georefStyles, suggestionsStyles];

    protected readonly route: AdminRouteIdPort = 'georef';
    declare sort: ResidualSort;
    /** M22 (§13.2): the actions, the scan and the map fill the window (Esc leaves it). */
    declare full: boolean;
    /** The browser refused its own full screen: the page fills the window instead, and says so. */
    declare fullRefused: boolean;
    /** mapbox-gl.css of the pinned release ('' in tests: no network). */
    declare mapCss: string;
    /** The context menu, where it is open (null: closed). */
    declare menu: GeorefMenuOpen | null;
    /** What had the focus when the menu opened: it gets it back. */
    #menuOpener: Element | null = null;
    /** The saved version the page opened. */
    #opened: string | null = null;
    /** What full screen made inert around the page. */
    readonly #inert = new FullScreenInert();

    constructor() {
        super();
        this.sort = 'pair';
        this.full = false;
        this.fullRefused = false;
        this.mapCss = MAPBOX_GL_CSS_URL;
        this.menu = null;
        // Esc anywhere on the page: the half pair goes, else the selected pair is let go. The scan pane handles its own
        // (and marks it handled), so one press never does both.
        this.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
                this.intents?.cancelHalf();
                this.#setFull(false);
            }
        });
    }

    protected storeOf(content: ContentPort): AreaPort<GeorefViewState, GeorefIntentsPort> | null {
        return content.georef;
    }

    /** The user left the browser's full screen by Esc or its own bar: the page goes back in its place. */
    readonly #onScreenChange = (): void => {
        if (this.full && !this.fullRefused && screenElement() === null) {
            this.full = false;
        }
    };

    override connectedCallback(): void {
        super.connectedCallback();
        document.addEventListener('fullscreenchange', this.#onScreenChange);
        document.addEventListener('webkitfullscreenchange', this.#onScreenChange);
    }

    override disconnectedCallback(): void {
        document.removeEventListener('fullscreenchange', this.#onScreenChange);
        document.removeEventListener('webkitfullscreenchange', this.#onScreenChange);
        void leaveScreen();
        this.#inert.cover(this, false);
        super.disconnectedCallback();
    }

    /** The context menu's chunk: its element, and its gestures listening on both panes from now on. */
    protected override firstUpdated(): void {
        this.menuChunk()
            .then((chunk) => {
                chunk.defineHcmGeorefMenu();
                new chunk.MenuGestures((pane, at) => {
                    this.#openMenu((always) => chunk.menuAt(pane, at, this.intents, always));
                }).attach(this.renderRoot);
            })
            .catch((error: unknown) => {
                // Offline, or a deploy swapped the hashes: the browser's own menu stays, and the cause is in the log.
                log.warn('the context menu did not load', { error: String(error) });
            });
    }

    /** The lazy chunk of the context menu (a seam for the test of a chunk that does not load). */
    protected menuChunk(): Promise<typeof GeorefMenuChunk> {
        return import('./georef-menu.js');
    }

    protected override updated(changed: PropertyValues<this>): void {
        // The wizard's funnel (§200): what changed since the last render, as codes.
        trackAreaFunnels(this, this.view, (view) => [georefFunnel(view)]);
        super.updated(changed);
        if (changed.has('full')) {
            this.#inert.cover(this, this.full);
            // Both panes (the scan and the Mapbox map) follow the new size.
            window.dispatchEvent(new Event('resize'));
        }
        const saved = this.#newlySaved();
        if (saved !== null) {
            this.#opened = saved;
            this.app?.intents.navigate({ id: 'imagery', params: ['version', saved] });
        }
    }

    /** The version a Save just queued, once (the page then opens it). */
    #newlySaved(): string | null {
        const saved = this.view?.saved ?? null;
        return saved === this.#opened ? null : saved;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        if (view.doc.status === 'error') {
            return errorTemplate(this.locale, view.doc.failure, () => this.intents?.retry());
        }
        return view.notFound ? this.#notFound() : this.#read(view);
    }

    #notFound(): TemplateResult {
        return html`<div class="page">
            <h2 tabindex="-1" data-detail-heading>${contentText(this.locale, 'adminContent.georef.notFound')}</h2>
            <p><a href="#/imagery">${contentText(this.locale, 'adminContent.georef.backToImagery')}</a></p>
        </div>`;
    }

    #read(view: GeorefViewState): TemplateResult {
        const version = view.version;
        return version === null ? loadingTemplate(this.locale) : this.#page(this.#context(view, version), version);
    }

    #context(view: GeorefViewState, version: GeorefVersionPort): GeorefContext {
        return {
            ...{ locale: this.locale, view, intents: this.intents, locked: this.readOnly || !version.editable },
            ...{ compact: this.state?.windowClass === 'compact', mapCss: this.mapCss, sort: this.sort },
            setSort: (sort) => {
                this.sort = sort;
            },
            addAtCentres: () => {
                this.#addAtCentres();
            },
            full: this.full,
            fullRefused: this.fullRefused,
            toggleFull: () => {
                this.#setFull(!this.full);
            },
        };
    }

    /** On: the browser's own full screen on this page, or the in-page maximise when it refuses; off: both left. */
    #setFull(on: boolean): void {
        this.full = on;
        this.fullRefused = false;
        if (!on) {
            void leaveScreen();
            return;
        }
        void enterScreen(this).then((shown) => {
            // Left (Esc, its button) while the browser was still entering: leave the browser's full screen too.
            if (shown && !this.full) {
                void leaveScreen();
            }
            this.fullRefused = !shown && this.full;
            if (!shown) {
                log.info('the browser refused full screen; the page fills the window instead', { reason: 'fullscreen-denied' });
            }
        });
    }

    #page(context: GeorefContext, version: GeorefVersionPort): TemplateResult {
        const { locale, view, intents } = context;
        const title = `${contentText(locale, 'adminContent.georef.title')} · ${labelText(version.label, locale)}`;
        // Full screen: the shell's own first-level heading is inert under it, so the page names itself at that level.
        const heading = when(
            context.full,
            () => html`<h1 class="visually-hidden">${contentText(locale, 'adminContent.georef.title')}</h1>`,
        );
        const readOnlyNote = when(
            !version.editable,
            () => html`<p class="note" data-state="read-only">${contentText(locale, 'adminContent.georef.notEditable')}</p>`,
        );
        // Edit points on the version the map shows: saving makes a new version, this one stays on the map until that one is approved.
        const publishedNote = when(
            version.editable && version.state === 'published',
            () => html`<p class="note" data-state="published-note">${contentText(locale, 'adminContent.georef.publishedNote')}</p>`,
        );
        return html`<div class="page" data-state=${view.adding ? 'adding' : 'editing'} ?data-full=${context.full}>
            ${heading}
            <h2 tabindex="-1" data-detail-heading>${title}</h2>
            ${reconnectingStatus(locale, view.doc.reconnecting)} ${readOnlyNote} ${publishedNote} ${summary(context)} ${guide(context)}
            ${transforms(context)} ${tools(context)} ${panes(context)} ${previewControls(context)} ${this.#suggestions(context)}
            ${this.#menuTemplate(context)}
            <h3>${contentText(locale, 'adminContent.georef.pairs')}</h3>
            ${residualTable({
                ...{ locale, pairs: view.pairs, residuals: view.fit.residuals, selected: view.selected, sort: context.sort },
                readOnly: context.locked,
                onSort: context.setSort,
                onSelect: (id) => intents?.select(id),
                onToggle: (id) => intents?.toggle(id),
                onRemove: (id) => intents?.remove(id),
            })}
        </div>`;
    }

    /** The matcher's suggestions (M4 §2.5), above the pairs they join. */
    #suggestions(context: GeorefContext): TemplateResult {
        const { locale, view, intents } = context;
        return suggestionsPanel({
            ...{ locale, view: view.suggestions, locked: context.locked },
            onDecide: (decision, id, index) => {
                void this.#decide(decision, id, index);
            },
            onAcceptAll: () => {
                void this.#acceptAll();
            },
            onSelect: (id) => intents?.selectSuggestion(id),
        });
    }

    /** Accept or Reject, then the keyboard stays in the list: on the row that took this one's place, else the heading. */
    async #decide(decision: SuggestionDecision, id: string, index: number): Promise<void> {
        if (decision === 'accept') {
            this.intents?.acceptSuggestion(id);
        } else {
            this.intents?.rejectSuggestion(id);
        }
        await this.updateComplete;
        this.#focusSuggestion(index);
    }

    /** Accept all, then the keyboard lands on the panel's heading: the list it was in is replaced by "all decided". */
    async #acceptAll(): Promise<void> {
        this.intents?.acceptAllSuggestions();
        await this.updateComplete;
        this.renderRoot.querySelector<HTMLElement>(`#${SUGGESTIONS_HEADING_ID}`)?.focus();
    }

    #focusSuggestion(index: number): void {
        const rows = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('button.suggestion')];
        const next = rows[Math.min(index, rows.length - 1)] ?? this.renderRoot.querySelector<HTMLElement>(`#${SUGGESTIONS_HEADING_ID}`);
        next?.focus();
    }

    /** Opens the menu found there, unless it would have nothing in it (`always`: Undo, or a read-only version's line). */
    #openMenu(found: (always: boolean) => GeorefMenuOpen | null): void {
        const view = this.view;
        const menu = view === null ? null : found(view.canUndo || this.#locked(view));
        if (menu !== null) {
            this.#menuOpener = deepActiveElement(this.ownerDocument);
            this.menu = menu;
        }
    }

    #locked(view: GeorefViewState): boolean {
        return this.readOnly || view.version?.editable !== true;
    }

    #menuTemplate(context: GeorefContext): TemplateResult {
        return withValue(
            this.menu,
            (menu) =>
                html`<hcm-georef-menu
                    .menu=${menu}
                    .locale=${context.locale}
                    .intents=${this.intents}
                    ?can-undo=${context.view.canUndo}
                    ?locked=${context.locked}
                    @hcm-close=${() => {
                        this.#closeMenu();
                    }}
                ></hcm-georef-menu>`,
        );
    }

    /** Closed: the focus goes back where it was when the menu opened. */
    #closeMenu(): void {
        this.menu = null;
        const opener = this.#menuOpener;
        this.#menuOpener = null;
        if (opener instanceof HTMLElement) {
            opener.focus();
        }
    }

    #addAtCentres(): void {
        const viewer = this.renderRoot.querySelector<HcmScanViewer>('hcm-scan-viewer');
        if (viewer !== null) {
            this.intents?.addAtCentres(viewer.centre);
        }
    }
}

export function defineHcmGeorefPage(registry: CustomElementRegistry = customElements): void {
    defineHcmCompass(registry);
    if (registry.get(HCM_GEOREF_PAGE_TAG) === undefined) {
        registry.define(HCM_GEOREF_PAGE_TAG, HcmGeorefPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-georef-page': HcmGeorefPage;
    }
}
