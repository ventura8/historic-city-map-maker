/**
 * `<hcm-layer-panel>`: the Layers sheet or docked panel (docs/research/M1-interfaces.md §5.2, PLAN Addendum 3 → Live
 * transparency). It lists every overlay (historical layers, the photos, the POI categories) in the ui-kit's
 * `<hcm-overlay-list>`, with a switch and a 0–100 % slider each, and the attribution of every visible historical
 * layer. It is presentational: the list's `hcm-overlay-visibility` and `hcm-overlay-opacity` events bubble to
 * `<hcm-map-viewer>`, which updates the store (the map follows live, the hash on release). A city without historical
 * layers yet gets a note at the top, where the layers will be (below the photos and places it read as a footnote).
 * With historical layers and a map, a Compare button and the Map labels group (Street names, POIs; V31) sit at the top of
 * the panel (the owner, 2026-11-10), in the pinned section, which scrolls with the list (2026-11-22: sticky, it hid the rows
 * scrolled under it and a year's revealed layer). Compare opens swipe compare (M4, V06)
 * or closes it while the visitor compares (`hcm-compare-toggle`). Each map-label switch fires `hcm-map-label`; its note
 * tells them from the city's own Places below. M27 (`docs/research/M27-lost-streets.md`): a POI category marked `pinned` (the
 * Disappeared streets) leads the Places section, with its own switch and slider (the owner, 2026-11-22; it was in the
 * strip before).
 *
 * The extra-large pane that is always there is `minimizable` (the owner, 2026-11-08): its close button ("Restrânge
 * straturile", a chevron, `aria-expanded="true"`) turns it into one floating button on the map's leading edge ("Straturi",
 * `aria-expanded="false"`, the owner 2026-11-09: no rail, the map takes the full width) that brings it back. Each fires `hcm-layers-minimize` (`{minimized}`): the viewer keeps it in the
 * store (`layersHidden`, for the session only) and binds `minimized` (reflected for the viewer's grid) to it, so the pane
 * re-created when the window comes back to extra-large is still minimized. The switches and sliders are the store's, so
 * minimizing loses none of them. The focus follows: to the rail's button, then back to the panel's close button.
 */
import { DEFAULT_LOCALE, translate, type ViewerLocale, type Manifest, type Overlay } from '@hcm/shared';
import { translateMapLabels, type MapLabelKind, type MapLabels, type MapLabelsKey } from '@hcm/shared/map-labels';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { tabbableElements } from '../components/focus.js';
import { stateLayer } from '../components/styles.js';
import { EMPTY } from './empty.js';
import type { OverlayListGroup } from '../components/overlay-list.js';
import { labelsNote, listedOverlays, overlayItems, attributionLines } from './layer-panel-model.js';
import type { SheetMode } from './layout.js';
import { revealLayers, syncPinnedOffset } from './pinned-offset.js';
import { loadSections, renderSection, saveSections, sectionStyles, type PanelSection, type SectionState } from './layer-panel-sections.js';
import { closeEvent, renderSheetFrame } from './sheet-frame.js';
import { baseStyles, sheetStyles } from './shared-styles.js';

export const HCM_LAYER_PANEL_TAG = 'hcm-layer-panel';

/** `hcm-map-label`: a Map labels switch moved. */
export interface MapLabelDetail {
    readonly kind: MapLabelKind;
    readonly visible: boolean;
}

/** What the Map labels group shows: what is drawn, and the kinds the basemap has (null until a map has answered). */
export interface LayerPanelLabels {
    readonly shown: MapLabels;
    readonly available: readonly MapLabelKind[] | null;
}

const LABEL_NAMES: Readonly<Record<MapLabelKind, MapLabelsKey>> = { streets: 'mapLabels.streets', pois: 'mapLabels.pois' };

export { attributionLines, overlayGroups, overlayItems, pinnedIds, splitPinned } from './layer-panel-model.js';

export class HcmLayerPanel extends LitElement {
    static override readonly properties = {
        overlays: { attribute: false },
        manifest: { attribute: false },
        locale: { type: String },
        mode: { type: String },
        open: { type: Boolean },
        minimizable: { type: Boolean },
        minimized: { type: Boolean, reflect: true },
        canCompare: { type: Boolean, attribute: 'can-compare' },
        comparing: { type: Boolean },
        labels: { attribute: false },
        year: { attribute: false },
        photosNear: { attribute: false },
    };

    static override readonly styles = [
        baseStyles,
        sheetStyles,
        stateLayer,
        sectionStyles,
        css`
            :host {
                display: contents;
            }

            .rail {
                position: absolute;
                inset-block-start: var(--hcm-gutter);
                inset-inline-start: var(--hcm-gutter);
                z-index: 20;
                display: flex;
                align-items: center;
                gap: 8px;
                min-block-size: 48px;
                padding-inline: 16px 20px;
                border: 0;
                border-radius: var(--md-sys-shape-corner-large);
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
                box-shadow: var(--md-sys-elevation-level2);
                font: inherit;
                font-size: var(--md-sys-typescale-label-large-size);
            }

            .content {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .pinned {
                display: flex;
                flex-direction: column;
                gap: 4px;

                /* Compare's 48 px ring reaches 4 px above its 40 px button: inside the strip, not cut by the scroller's edge. */
                padding-block: 4px;
                background: var(--md-sys-color-surface-container-low);
                box-shadow: 0 1px 0 var(--md-sys-color-outline-variant);
            }

            /*
             * The pinned section scrolls with the list everywhere (the owner, 2026-11-22). Sticky in the docked pane, it grew
             * with Map labels and the Photos switch into a collapsible section of 600 px: the rows scrolled under it read as
             * overlapping ones, and a year's revealed layer landed hidden behind it.
             */
            .pinned {
                box-shadow: none;
            }

            .empty {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 12px;
                border-radius: var(--md-sys-shape-corner-medium);
                background: var(--md-sys-color-surface-container-high);
                color: var(--md-sys-color-on-surface-variant);
                font-size: var(--md-sys-typescale-body-medium-size);
                line-height: var(--md-sys-typescale-body-medium-line-height);
            }

            .attribution {
                font-size: var(--md-sys-typescale-body-small-size);
                color: var(--md-sys-color-on-surface-variant);
            }

            /*
             * Compare starts at the list rows' inline inset (0, the pane's padding) and keeps the pane's 12 px section gap below:
             * the strip's 4 px row gap plus 8 px, the same space as between the strip and the historical layers (owner, 2026-11-14).
             */
            .compare {
                align-self: flex-start;
                margin-block-end: 8px;
            }

            /* The size, weight and margins are baseStyles' h3 (title small); a list and a paragraph have no margin there. */
            .labels h3 {
                color: var(--md-sys-color-primary);
                line-height: var(--md-sys-typescale-title-small-line-height);
            }

            .labels li {
                display: flex;
                gap: 12px;
                align-items: center;
                justify-content: space-between;

                /* 48 px rows: each switch's 48 px touch target stays its own, none reaches over its neighbour (docs/LESSONS.md 618). */
                min-block-size: 48px;
            }

            .labels p {
                color: var(--md-sys-color-on-surface-variant);
                font-size: var(--md-sys-typescale-body-small-size);
                line-height: var(--md-sys-typescale-body-small-line-height);
            }
        `,
    ];

    declare overlays: readonly Overlay[];
    declare manifest: Manifest | null;
    declare locale: ViewerLocale;
    declare mode: SheetMode;
    declare open: boolean;
    /** The pane is always docked (extra-large): its close button minimizes it to one floating button. */
    declare minimizable: boolean;
    /** The minimizable pane shows as its floating button. */
    declare minimized: boolean;
    /** The city has historical layers and the map is drawn: the Compare button shows (M4). */
    declare canCompare: boolean;
    /** The visitor compares: the button closes compare. */
    declare comparing: boolean;
    /** The basemap's own labels; null: no map (no WebGL), no group. */
    declare labels: LayerPanelLabels | null;
    /** The timeline's year: a new one scrolls to its layers and marks them, now or (`#pendingYear`) when the panel shows. */
    declare year: number | null;
    /** Design B: the photos' scope (null: every photo), for the Photos switch's popover. */
    declare photosNear: number | null;
    #pendingYear: number | null = null;
    /** Which sections are expanded: pinned and Places by default, Layers collapsed (remembered per viewer). */
    #sections: SectionState = loadSections();

    constructor() {
        super();
        this.overlays = [];
        this.manifest = null;
        this.locale = DEFAULT_LOCALE;
        this.mode = 'bottom';
        this.open = false;
        this.minimizable = false;
        this.minimized = false;
        this.canCompare = false;
        this.comparing = false;
        this.labels = null;
        this.year = null;
        this.photosNear = null;
    }

    override render(): TemplateResult {
        const label = translate(this.locale, 'layers.title');
        const minimize = this.minimizable;
        const closeLabel = translate(this.locale, minimize ? 'layers.minimize' : 'action.close');
        const handleLabel = translate(this.locale, 'sheet.resize');
        if (minimize && this.minimized) {
            return this.#rail(label);
        }
        const onClose = (): void => {
            if (minimize) {
                this.#minimize(true);
            } else {
                this.dispatchEvent(closeEvent());
            }
        };
        return renderSheetFrame(
            { mode: this.mode, open: this.open, label, closeLabel, handleLabel, onClose, minimize, standard: true },
            this.#content(),
        );
    }

    /**
     * Minimizing or restoring moves the focus to the rail's button or the panel's close button: it is never lost. The
     * close button renders its own button after this update, hence the wait.
     */
    protected override updated(changed: PropertyValues<this>): void {
        if (changed.get('minimized') !== undefined) {
            void this.updateComplete.then(() => tabbableElements(this.renderRoot as ShadowRoot)[0]?.focus());
        }
        if (changed.has('year') && changed.get('year') !== undefined) {
            this.#pendingYear = this.year;
        }
        syncPinnedOffset(this, this.renderRoot);
        this.#revealPending();
    }

    #showing(): boolean {
        return (this.open || this.mode === 'docked') && !(this.minimizable && this.minimized);
    }

    /** Scrolls to the pending year's layers once the panel shows; the list renders after this update, hence the wait. */
    #revealPending(): void {
        const year = this.#pendingYear;
        if (year === null || !this.#showing() || this.manifest === null) {
            return;
        }
        this.#pendingYear = null;
        this.#setSection('layers', true);
        this.#setSection('aerial', true);
        const ids = this.manifest.layers.filter((layer) => layer.year === year).map((layer) => layer.id);
        void this.updateComplete.then(revealLayers.bind(null, this, this.renderRoot, ids));
    }

    /** Minimizes or restores at once, and tells the viewer, which keeps it in the store. */
    #minimize(minimized: boolean): void {
        this.minimized = minimized;
        this.dispatchEvent(new CustomEvent('hcm-layers-minimize', { bubbles: true, detail: { minimized } }));
    }

    #rail(label: string): TemplateResult {
        const onRestore = (): void => {
            this.#minimize(false);
        };
        return html`<button type="button" class="rail interactive" aria-expanded="false" @click=${onRestore}>
            <hcm-icon name="layers"></hcm-icon>${label}
        </button>`;
    }

    #hasPinned(manifest: Manifest): boolean {
        return this.canCompare || this.#hasLabels() || manifest.photos.length > 0;
    }

    #hasLabels(): boolean {
        return (this.labels?.available?.length ?? 0) > 0;
    }

    #content(): TemplateResult {
        const manifest = this.manifest;
        if (manifest === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<div class="content">
            ${this.#hasPinned(manifest) ? this.#section('pinned', 'layers.group.pinned', this.#pinnedBody(manifest, locale)) : nothing}
            ${this.#overlaySections(manifest)}
            <ul class="attribution">
                ${attributionLines(this.overlays, manifest, locale).map((line) => html`<li>${line}</li>`)}
            </ul>
        </div>`;
    }

    #pinnedBody(manifest: Manifest, locale: ViewerLocale): TemplateResult {
        return html`${this.#compareButton(locale)}${this.#mapLabels(manifest, locale)}${this.#photos(manifest, locale)}`;
    }

    /** Places, then the maps, then (a layer whose kind is not `map`) the aerial and satellite photos; empty ones are left out. */
    #overlaySections(manifest: Manifest): TemplateResult {
        const listed = listedOverlays(this.overlays, manifest);
        const places = listed.filter((overlay) => overlay.kind === 'poi');
        const photographed = new Set(manifest.layers.filter((layer) => layer.kind !== 'map').map((layer) => layer.id));
        const rasters = listed.filter((overlay) => overlay.kind !== 'poi');
        const layers = rasters.filter((overlay) => !photographed.has(overlay.id));
        const aerial = rasters.filter((overlay) => photographed.has(overlay.id));
        const showLayers = layers.length > 0 || manifest.layers.length === 0;
        return html`${places.length > 0 ? this.#section('places', 'layers.group.places', this.#list(places, manifest, [])) : nothing}
        ${showLayers ? this.#section('layers', 'layers.group.historical', html`${this.#emptyNote(manifest)}${this.#list(layers, manifest, [])}`) : nothing}
        ${aerial.length > 0 ? this.#section('aerial', 'layers.group.aerial', this.#list(aerial, manifest, [])) : nothing}`;
    }

    #emptyNote(manifest: Manifest): TemplateResult {
        return manifest.layers.length > 0
            ? EMPTY
            : html`<p class="empty"><hcm-icon name="timeline"></hcm-icon>${translate(this.locale, 'layers.empty')}</p>`;
    }

    #section(
        id: PanelSection,
        key: 'layers.group.pinned' | 'layers.group.places' | 'layers.group.historical' | 'layers.group.aerial',
        body: TemplateResult,
    ): TemplateResult {
        const onToggle = (section: PanelSection): void => {
            this.#setSection(section, !this.#sections[section]);
        };
        return renderSection({ id, label: translate(this.locale, key), expanded: this.#sections[id], onToggle }, body);
    }

    /** Expands or collapses one section, remembers it and re-renders. */
    #setSection(id: PanelSection, expanded: boolean): void {
        if (this.#sections[id] === expanded) {
            return;
        }
        this.#sections = { ...this.#sections, [id]: expanded };
        saveSections(this.#sections);
        this.requestUpdate();
    }

    /** One overlay list; the pinned one has no group heading (the strip is its own group). */
    #list(overlays: readonly Overlay[], manifest: Manifest, groups: readonly OverlayListGroup[]): TemplateResult {
        const locale = this.locale;
        return html`<hcm-overlay-list
            .items=${overlayItems(overlays, manifest, locale)}
            .groups=${groups}
            .toggleLabel=${translate(locale, 'layers.toggle')}
            .opacityLabel=${translate(locale, 'layers.opacity')}
            .valueText=${translate(locale, 'layers.opacityValue')}
            .changedText=${translate(locale, 'layers.opacityChanged')}
            .shownText=${translate(locale, 'layers.shown')}
            .hiddenText=${translate(locale, 'layers.hidden')}
        ></hcm-overlay-list>`;
    }

    /** Design B: the Photos switch, directly under the POIs switch; nothing for a city without photos. */
    #photos(manifest: Manifest, locale: ViewerLocale): TemplateResult {
        if (manifest.photos.length === 0) {
            return EMPTY;
        }
        const photos = this.overlays.find((overlay) => overlay.kind === 'photos') ?? { visible: true, opacity: 1 };
        return html`<hcm-photos-control
            .visible=${photos.visible}
            .opacity=${photos.opacity}
            .near=${this.photosNear}
            .locale=${locale}
        ></hcm-photos-control>`;
    }

    #mapLabels(manifest: Manifest, locale: ViewerLocale): TemplateResult {
        const kinds = this.labels?.available ?? [];
        if (kinds.length === 0) {
            return EMPTY;
        }
        return html`<div class="labels" role="group" aria-labelledby="map-labels">
            <h3 id="map-labels">${translateMapLabels(locale, 'mapLabels.group')}</h3>
            <ul>
                ${kinds.map((kind) => this.#mapLabel(kind, locale))}
            </ul>
            <p>${labelsNote(manifest, locale)}</p>
        </div>`;
    }

    #mapLabel(kind: MapLabelKind, locale: ViewerLocale): TemplateResult {
        const name = translateMapLabels(locale, LABEL_NAMES[kind]);
        const onChange = (event: CustomEvent<{ readonly checked: boolean }>): void => {
            event.stopPropagation();
            const detail: MapLabelDetail = { kind, visible: event.detail.checked };
            this.dispatchEvent(new CustomEvent('hcm-map-label', { bubbles: true, composed: true, detail }));
        };
        return html`<li>
            <span>${name}</span>
            <hcm-switch compact .checked=${this.labels?.shown[kind] === true} .label=${name} @hcm-change=${onChange}></hcm-switch>
        </li>`;
    }

    #compareButton(locale: ViewerLocale): TemplateResult {
        if (!this.canCompare) {
            return EMPTY;
        }
        const onClick = (): void => {
            this.dispatchEvent(new CustomEvent('hcm-compare-toggle', { bubbles: true, composed: true }));
        };
        return html`<hcm-button class="compare" variant="tonal" icon=${this.comparing ? 'close' : 'compare'} @click=${onClick}
            >${translate(locale, this.comparing ? 'compare.close' : 'compare.open')}</hcm-button
        >`;
    }
}

/** Registers `<hcm-layer-panel>` once; calling it again is a no-op. */
export function defineHcmLayerPanel(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_LAYER_PANEL_TAG) === undefined) {
        registry.define(HCM_LAYER_PANEL_TAG, HcmLayerPanel);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-layer-panel': HcmLayerPanel;
    }
}
