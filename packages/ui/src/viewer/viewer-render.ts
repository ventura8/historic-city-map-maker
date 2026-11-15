/**
 * The template of `<hcm-map-viewer>`, split by region: the frame (panes per window class), the map pane with its
 * status layer (skeleton, error card, no-WebGL fallback) and floating controls, the modal layer (the modal sheets, the
 * About dialog and the lightbox), above the map and Mapbox's own logo and attribution, which move into the part of
 * the map a modal sheet leaves in view (scenario V18, `viewer-legal.ts`). Every floating control carries
 * `data-layout-check` (its name): the e2e tour checks that no two of them overlap at any viewport
 * (docs/research/design-review-testability.md §4.3). Every function takes the view (state plus derived values) and
 * the element's handlers; none keeps state. The map container is the one static `<div class="map">`: Lit never
 * re-creates it, so the Mapbox canvas that the engine mounts into it survives every render.
 */
import { localized, translate, type Manifest, type Photo, type Poi, type PoiCategory, type ViewerLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { cssProperties, type CssPropertyValues } from '../components/css-properties.js';
import type { CameraOffset } from '../map/mapbox-types.js';
import { EMPTY } from './empty.js';
import type { MapLabelDetail } from './hcm-layer-panel.js';
import { dialogMode, isDialogSheet } from './input-commands.js';
import { DOCKED_OPEN, type Placement, type SheetMode, type ViewerLayout } from './layout.js';
import type { LegalLift } from './legal-lift.js';
import { renderSheetFrame } from './sheet-frame.js';
import type { ThemeChoice, ViewerError, ViewerState } from './store-port.js';
import { dateMenu, timelineDock, type TimelineDock } from './timeline-dock.js';
import { frontOfYear } from './timeline-dates.js';
import { photosNearYear, type TimelineStop } from './timeline-model.js';
import { yearOpacity } from './timeline-opacity.js';
import type { MenuPoint } from './map-menu-trigger.js';
import { lightbox, mapMenu, type LightboxHandlers, type MapMenuHandlers } from './viewer-lightbox.js';
import { menuActions, menuItem } from './viewer-menu.js';
import { nearYearChip, textChip } from './viewer-near-year.js';
import { storiesSheet } from './viewer-stories.js';
import { unplacedSheet } from './viewer-unplaced.js';
import { statusOrCard } from './viewer-wordless.js';
import type { CameraSource } from './hcm-compass.js';
import { markMenuOpen, zoomButtons, type MapSize } from './viewer-zoom.js';
import { modalOpen, renderConsentBanner } from './viewer-legal.js';
import { toastDock, type UpdateOffer } from './viewer-update.js';

/** What one render needs, derived from the store state by the element. */
export interface ViewerView {
    readonly state: ViewerState | null;
    readonly bootError: ViewerError | null;
    readonly layout: ViewerLayout;
    readonly locale: ViewerLocale;
    readonly stops: readonly TimelineStop[];
    readonly manifestUrl: string;
    readonly engineVersion: string;
    readonly mapboxCssUrl: string;
    /** The map container's box (null before the first render): Zoom out's limit (`viewer-zoom.ts`). */
    readonly mapSize: MapSize | null;
    /** The compass's camera (V64): the attached store, null before one is. */
    readonly camera: CameraSource | null;
    /** Where the map's menu is open (V62); null: closed. */
    readonly mapMenu: MenuPoint | null;
    /** How far Mapbox's bottom corners move out from under the open modal sheet (V18, `legal-lift.ts`). */
    readonly legalLift: LegalLift;
    /** A mouse, not a finger, is the main pointer (`(pointer: fine)`): only then a large window shows text chips. */
    readonly finePointer: boolean;
    /** The timeline's pill on a phone (V12) and its date picker (V13). */
    readonly dock: TimelineDock;
    /** A games console's browser (`game-console.ts`): the no-WebGL message says what it lacks. */
    readonly gameConsole?: boolean;
    /** A newer deploy waits for a safe moment (`viewer-update.ts`): the Reload snackbar; null or absent: none. */
    readonly update?: UpdateOffer | null;
}

/** `hcm-photo-locate` of `<hcm-photo-sheet>`: the photo, and its place's offset from the map's centre (`locateOffset`). */
interface PhotoLocateDetail {
    readonly photoId: string;
    readonly offset: CameraOffset;
}

/** `hcm-overlay-opacity` of `<hcm-overlay-list>`: `final` is false while dragging, true on release. */
export interface OverlayOpacityDetail {
    readonly id: string;
    readonly opacity: number;
    readonly final: boolean;
}

/** The element's event handlers, bound once. */
export interface ViewerHandlers extends LightboxHandlers, MapMenuHandlers {
    readonly onYearChange: (event: CustomEvent<{ readonly year: number | null }>) => void;
    readonly onOverlayVisibility: (event: CustomEvent<{ readonly id: string; readonly visible: boolean }>) => void;
    readonly onOverlayOpacity: (event: CustomEvent<OverlayOpacityDetail>) => void;
    readonly onSheetClose: (event: Event) => void;
    /** V75: the open photo came from the list (its sheet shows Back), and where the list was scrolled. */
    readonly photoReturn?: { readonly fromList: boolean; readonly scroll: number };
    /** The photo sheet's "Show on map" (V51). */
    readonly onPhotoLocate: (event: CustomEvent<PhotoLocateDetail>) => void;
    /** M17: a story to open (null: their list), and a place a story names. */
    readonly onStorySelect: (event: CustomEvent<{ readonly storyId: string | null }>) => void;
    readonly onPoiSelect: (event: CustomEvent<{ readonly poiId: string }>) => void;
    readonly onLightboxOpen: (event: Event) => void;
    /** The photo sheet's thumbnail was decoded (or failed): the `photo_timing` field measurement. */
    readonly onPhotoShown: (event: CustomEvent<{ readonly ok: boolean }>) => void;
    readonly onMenuSelect: (event: CustomEvent<{ readonly value: string }>) => void;
    readonly onLocaleChange: (event: CustomEvent<{ readonly locale: ViewerLocale }>) => void;
    /** Settings' theme choices: the mode (`theme`) or the colours (`accent`), one at a time. */
    readonly onThemeChange: (event: CustomEvent<ThemeChoice>) => void;
    readonly onConsent: (event: CustomEvent<{ readonly decision: 'granted' | 'denied' }>) => void;
    readonly onRetry: (event: Event) => void;
    /** The Layers panel's Compare button (M4, V06). */
    readonly onCompareToggle: (event: Event) => void;
    /** The Layers panel's Map labels switches (V31). */
    readonly onMapLabel: (event: CustomEvent<MapLabelDetail>) => void;
    /** The extra-large Layers pane minimized to its rail, or restored (V03). */
    readonly onLayersMinimize: (event: CustomEvent<{ readonly minimized: boolean }>) => void;
    readonly onToastDismiss: (event: Event) => void;
    /** The zoom buttons: one level in (1) or out (-1). */
    readonly onZoom: (step: number) => void;
    /** The compass (V64): the map back to north up and level. */
    readonly onCompass: () => void;
    /** The help panel's switch of the single-key shortcuts. */
    readonly onShortcuts: (event: CustomEvent<{ readonly enabled: boolean }>) => void;
    /** About's button to the help panel. */
    readonly onHelpOpen: (event: Event) => void;
    readonly onSkip: () => void;
    readonly onNearYear: () => void;
    /** V13: a date picked in the timeline's date picker. */
    readonly onDatePick: (event: CustomEvent<{ readonly layerId: string }>) => void;
}

/** A ready viewer: the state with its manifest. */
interface Ready {
    readonly state: ViewerState;
    readonly manifest: Manifest;
}

function readyOf(view: ViewerView): Ready | null {
    const state = view.state;
    return state?.status === 'ready' && state.manifest !== null ? { state, manifest: state.manifest } : null;
}

type DockedSheet = 'layers' | 'photo' | 'poi' | 'photos' | 'unplaced' | 'stories';

/** About is always a dialog; the layers panel has its own pane when it is always docked. */
function isDockable(sheet: ViewerState['sheet'], layersDocked: boolean): sheet is DockedSheet {
    return ['photo', 'poi', 'photos', 'unplaced', 'stories'].includes(sheet) || (sheet === 'layers' && !layersDocked);
}

/** The sheet that shows in the docked trailing pane, if any. */
function dockedSheet(view: ViewerView, ready: Ready | null): DockedSheet | 'none' {
    if (ready === null || view.layout.sheetMode !== 'docked') {
        return 'none';
    }
    const sheet = ready.state.sheet;
    return isDockable(sheet, view.layout.layersDocked) ? sheet : 'none';
}

type Panes = 'none' | 'leading' | 'trailing' | 'both';

function panes(view: ViewerView, ready: Ready | null): Panes {
    const trailing = dockedSheet(view, ready) !== 'none';
    if (ready !== null && view.layout.layersDocked) {
        return trailing ? 'both' : 'leading';
    }
    return trailing ? 'trailing' : 'none';
}

function hasTimeline(view: ViewerView, ready: Ready | null): boolean {
    return ready !== null && ready.state.webgl && view.stops.length > 1;
}

/** V12: the timeline rests as its pill on a phone, upright (standing) or on its side (a short window). */
function timelineCollapsed(view: ViewerView, ready: Ready | null): boolean {
    return hasTimeline(view, ready) && view.dock.collapsed(view.layout.timeline === 'vertical' || ready?.state.compactHeight === true);
}

/** A city without historical layers yet (Bucharest until M3) has no timeline: a note says the layers are coming. */
function timelineArea(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    if (hasTimeline(view, ready)) {
        return timeline(view, ready, handlers);
    }
    return ready.state.webgl ? timelineNote(view.locale) : EMPTY;
}

function timelineNote(locale: ViewerLocale): TemplateResult {
    return html`<div class="dock timeline-note">
        <p class="note" data-layout-check="timeline-note">
            <hcm-icon name="timeline"></hcm-icon><span>${translate(locale, 'timeline.empty')}</span>
        </p>
    </div>`;
}

/** A modal surface is over the frame: a modal sheet, About, the lightbox or the timeline's date picker. */
function frameInert(view: ViewerView): boolean {
    return modalOpen(view.state, view.layout.sheetMode) || view.dock.modal();
}

/**
 * The Layers sheet is open as a standard bottom or side sheet over the map (the owner, 2026-11-15: no dimming, the map
 * stays usable): the floating controls it would cover step aside until it closes (`viewer-styles.ts`).
 */
function layersSheetOpen(view: ViewerView): boolean {
    return view.state?.sheet === 'layers' && view.layout.sheetMode !== 'docked';
}

/** The lift as the properties the styles move Mapbox's bottom corners by (`viewer-styles.ts`); none without a sheet. */
function liftProperties(lift: LegalLift): CssPropertyValues {
    const px = (value: number): string | undefined => (value === 0 ? undefined : `${String(value)}px`);
    return { '--hcm-legal-lift-bottom': px(lift.bottom), '--hcm-legal-lift-left': px(lift.left), '--hcm-legal-lift-right': px(lift.right) };
}

export function renderViewer(view: ViewerView, handlers: ViewerHandlers): TemplateResult {
    const ready = readyOf(view);
    return html`${stylesheet(view)}
        <div class="viewer">
            <div
                class="frame"
                data-panes=${panes(view, ready)}
                ?data-compact-height=${view.state?.compactHeight === true}
                data-timeline=${hasTimeline(view, ready) ? view.layout.timeline : nothing}
                ?data-timeline-collapsed=${timelineCollapsed(view, ready)}
                ?inert=${frameInert(view)}
                ?data-layers-sheet=${layersSheetOpen(view)}
                ${cssProperties(liftProperties(view.legalLift))}
            >
                ${skipLink(view, ready, handlers)} ${leadingPane(view, ready, handlers)}
                <div class="map-pane">
                    <div class="map" dir="ltr" role="region" aria-label=${mapLabel(view, ready)}></div>
                    ${statusOrCard(view, () => statusLayer(view, handlers))} ${ready === null ? nothing : controls(view, ready, handlers)}
                </div>
                ${trailingPane(view, ready, handlers)}
            </div>
            ${ready === null ? nothing : html`<div class="modal-layer">${overlays(view, ready, handlers)}</div>`}
        </div>`;
}

/** mapbox-gl.css inside the shadow root (the page's copy cannot reach it); the browser reuses its cached file. */
function stylesheet(view: ViewerView): TemplateResult {
    return view.mapboxCssUrl === '' ? EMPTY : html`<link rel="stylesheet" href=${view.mapboxCssUrl} />`;
}

function mapLabel(view: ViewerView, ready: Ready | null): string {
    return translate(view.locale, 'viewer.mapLabel', { city: ready === null ? '' : localized(ready.manifest.city.name, view.locale) });
}

function skipLink(view: ViewerView, ready: Ready | null, handlers: ViewerHandlers): TemplateResult {
    return hasTimeline(view, ready)
        ? html`<button type="button" class="skip" @click=${handlers.onSkip}>${translate(view.locale, 'viewer.skipToTimeline')}</button>`
        : EMPTY;
}

function leadingPane(view: ViewerView, ready: Ready | null, handlers: ViewerHandlers): TemplateResult {
    return ready !== null && view.layout.layersDocked
        ? html`<div class="pane leading">${layerPanel(view, ready, { ...DOCKED_OPEN, minimizable: true }, handlers)}</div>`
        : EMPTY;
}

function statusLayer(view: ViewerView, handlers: ViewerHandlers): TemplateResult {
    const state = view.state;
    if (state === null) {
        return view.bootError === null ? skeleton(view.locale) : errorLayer(view.bootError, view.locale, handlers);
    }
    if (!state.webgl && state.manifest !== null) {
        return noWebgl(view, state.manifest, handlers);
    }
    return stateLayer(view, state, handlers);
}

function stateLayer(view: ViewerView, state: ViewerState, handlers: ViewerHandlers): TemplateResult {
    if (state.status === 'error' && state.error !== null) {
        return errorLayer(state.error, view.locale, handlers);
    }
    return state.status === 'ready' ? EMPTY : skeleton(view.locale);
}

/**
 * The boot state: the kit's M3 Expressive loading indicator (a wait of a few seconds). A linear `hcm-progress` has no
 * width of its own and collapsed to nothing in this centred grid, so the screen showed only the static shimmer.
 */
function skeleton(locale: ViewerLocale): TemplateResult {
    return html`<div class="status">
        <div class="skeleton" role="status">
            <hcm-loading-indicator .label=${translate(locale, 'viewer.loading')}></hcm-loading-indicator>
            <div class="shimmer"></div>
            <p>${translate(locale, 'viewer.loading')}</p>
        </div>
    </div>`;
}

function errorLayer(error: ViewerError, locale: ViewerLocale, handlers: ViewerHandlers): TemplateResult {
    return html`<div class="status">
        <hcm-error-card .error=${error} .locale=${locale} @hcm-retry=${handlers.onRetry}></hcm-error-card>
    </div>`;
}

/** The consent card is asked while analytics is set up and the visitor has not answered yet. */
function consentAsked(state: ViewerState | null, manifest: Manifest): boolean {
    return manifest.city.analytics.measurementId !== undefined && state?.consent === 'unknown';
}

function noWebgl(view: ViewerView, manifest: Manifest, handlers: ViewerHandlers): TemplateResult {
    return html`<div class="status">
        <div class="fallback">
            <hcm-error-card
                .error=${{ code: view.gameConsole ? 'error.webglConsole' : 'error.webgl', retryable: false }}
                .locale=${view.locale}
            ></hcm-error-card>
            ${consentAsked(view.state, manifest) ? renderConsentBanner(view.locale, handlers.onConsent, false) : nothing}
            <hcm-photo-list
                .photos=${manifest.photos}
                .locale=${view.locale}
                .manifestUrl=${view.manifestUrl}
                @hcm-photo-select=${handlers.onPhotoSelect}
            ></hcm-photo-list>
        </div>
    </div>`;
}

function controls(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    const { state, manifest } = ready;
    // Without a map the consent card is in the fallback's column (`noWebgl`).
    const consent = state.webgl && consentAsked(state, manifest);
    const items = menuActions({ webgl: state.webgl, layersDocked: view.layout.layersDocked, manifest }).map((action) =>
        menuItem(action, view.locale, state.myLocation !== null),
    );
    return html`${timelineArea(view, ready, handlers)}
        ${nearYearChip(
            { locale: view.locale, wide: view.finePointer && textChip(state.windowClass, state.compactHeight) },
            state.year,
            manifest.photos,
            handlers.onNearYear,
        )}
        <div class="dock menu" @hcm-toggle=${markMenuOpen}>
            <hcm-fab-menu
                data-layout-check="menu"
                icon="menu"
                .label=${translate(view.locale, 'action.menu')}
                .closeLabel=${translate(view.locale, 'action.close')}
                .items=${items}
                @hcm-select=${handlers.onMenuSelect}
            ></hcm-fab-menu>
        </div>
        ${state.webgl ? zoomButtons(view, state.view, manifest, handlers) : nothing}
        ${consent ? renderConsentBanner(view.locale, handlers.onConsent) : nothing}
        ${toastDock(view.locale, state.toast, handlers.onToastDismiss, view.update)} ${mapMenu(view, state, handlers)}`;
}

function timeline(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    const { layers } = ready.manifest;
    const { year, overlays, front } = ready.state;
    const opacity = year === null ? null : yearOpacity(overlays, frontOfYear(layers, year, front), view.locale);
    const dock = { ...view, year, orientation: view.layout.timeline, layers, collapsed: timelineCollapsed(view, ready), opacity };
    return timelineDock(dock, view.dock, handlers.onYearChange, handlers.onOverlayOpacity);
}

function layerPanel(view: ViewerView, ready: Ready, placement: Placement, handlers: ViewerHandlers): TemplateResult {
    return html`<hcm-layer-panel
        .overlays=${ready.state.overlays}
        .manifest=${ready.manifest}
        .locale=${view.locale}
        .mode=${placement.mode}
        .open=${placement.open}
        .minimizable=${placement.minimizable === true}
        .minimized=${ready.state.layersHidden}
        .canCompare=${ready.state.webgl && ready.manifest.layers.length > 0}
        .comparing=${ready.state.compare !== null}
        .labels=${ready.state.webgl ? ready.state.mapLabels : null}
        .year=${ready.state.year}
        ?inert=${placement.inert === true}
        @hcm-close=${handlers.onSheetClose}
        @hcm-overlay-visibility=${handlers.onOverlayVisibility}
        @hcm-overlay-opacity=${handlers.onOverlayOpacity}
        @hcm-compare-toggle=${handlers.onCompareToggle}
        @hcm-map-label=${handlers.onMapLabel}
        @hcm-layers-minimize=${handlers.onLayersMinimize}
    ></hcm-layer-panel>`;
}

interface Selection {
    readonly photo: Photo | null;
    readonly poi: Poi | null;
    readonly category: PoiCategory | null;
}

function selectedPoi({ state, manifest }: Ready): Poi | null {
    return state.sheet === 'poi' ? ((manifest.pois ?? []).find((candidate) => candidate.id === state.selectedPoiId) ?? null) : null;
}

function categoryOf(manifest: Manifest, poi: Poi | null): PoiCategory | null {
    return poi === null ? null : ((manifest.poiCategories ?? []).find((candidate) => candidate.id === poi.category) ?? null);
}

function selection(ready: Ready): Selection {
    const poi = selectedPoi(ready);
    const photo = ready.manifest.photos.find((candidate) => candidate.id === ready.state.selectedPhotoId) ?? null;
    return { photo, poi, category: categoryOf(ready.manifest, poi) };
}

function photoSheet(view: ViewerView, ready: Ready, placement: Placement, handlers: ViewerHandlers): TemplateResult {
    const { photo, poi, category } = selection(ready);
    return html`<hcm-photo-sheet
        .photo=${photo}
        .poi=${poi}
        .category=${category}
        .layers=${ready.manifest.layers}
        .photos=${ready.manifest.photos}
        .locale=${view.locale}
        .mode=${placement.mode}
        .open=${placement.open}
        .manifestUrl=${view.manifestUrl}
        .contributeUrl=${ready.manifest.contributeUrl ?? null}
        .stories=${ready.manifest.stories ?? []}
        .canLocate=${ready.state.webgl}
        .years=${view.stops}
        .photoVersion=${ready.state.photoVersion}
        .backToList=${handlers.photoReturn?.fromList === true}
        ?inert=${placement.inert === true}
        @hcm-close=${handlers.onSheetClose}
        @hcm-photo-back=${handlers.onSheetClose}
        @hcm-year-change=${handlers.onYearChange}
        @hcm-photo-locate=${handlers.onPhotoLocate}
        @hcm-photo-select=${handlers.onPhotoSelect}
        @hcm-story-select=${handlers.onStorySelect}
        @hcm-lightbox-open=${handlers.onLightboxOpen}
        @hcm-photo-shown=${handlers.onPhotoShown}
        @hcm-photo-version=${handlers.onPhotoVersion}
    ></hcm-photo-sheet>`;
}

function photosSheet(view: ViewerView, ready: Ready, placement: Placement, handlers: ViewerHandlers): TemplateResult {
    const { year } = ready.state;
    const photos = year === null ? ready.manifest.photos : photosNearYear(ready.manifest.photos, year);
    const label = year === null ? translate(view.locale, 'photos.list') : translate(view.locale, 'photos.nearYear', { year: String(year) });
    const content = html`<hcm-photo-list
        .photos=${photos}
        .locale=${view.locale}
        .manifestUrl=${view.manifestUrl}
        .restoreScroll=${handlers.photoReturn?.scroll ?? 0}
        @hcm-photo-select=${handlers.onPhotoSelect}
    ></hcm-photo-list>`;
    const onClose = (): void => {
        handlers.onSheetClose(new CustomEvent('hcm-close'));
    };
    return html`<div class="photos-sheet" ?inert=${placement.inert === true} @hcm-close=${handlers.onSheetClose}>
        ${renderSheetFrame({ ...placement, label, closeLabel: translate(view.locale, 'action.close'), handleLabel: translate(view.locale, 'sheet.resize'), onClose }, content)}
    </div>`;
}

function trailingPane(view: ViewerView, ready: Ready | null, handlers: ViewerHandlers): TemplateResult {
    const sheet = dockedSheet(view, ready);
    if (ready === null || sheet === 'none') {
        return EMPTY;
    }
    const content = {
        layers: () => layerPanel(view, ready, DOCKED_OPEN, handlers),
        photos: () => photosSheet(view, ready, DOCKED_OPEN, handlers),
        unplaced: () => unplacedSheet(view, ready.manifest, DOCKED_OPEN, handlers.onSheetClose),
        photo: () => photoSheet(view, ready, DOCKED_OPEN, handlers),
        poi: () => photoSheet(view, ready, DOCKED_OPEN, handlers),
        stories: () => storiesSheet({ ...view, storyId: ready.state.selectedStoryId }, ready.manifest, DOCKED_OPEN, handlers),
    }[sheet];
    return html`<div class="pane trailing">${content()}</div>`;
}

function overlays(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    const { state, manifest } = ready;
    const mode = view.layout.sheetMode;
    const modal = mode === 'docked' ? nothing : modalSheets(view, ready, mode, handlers);
    return html`${modal}
        <hcm-about-dialog
            .open=${isDialogSheet(state.sheet)}
            .mode=${dialogMode(state.sheet)}
            .shortcuts=${state.shortcuts}
            .city=${manifest.city}
            .locale=${view.locale}
            .engineVersion=${view.engineVersion}
            .consent=${state.consent}
            .analytics=${manifest.city.analytics.measurementId !== undefined}
            ?fullscreen=${view.layout.aboutFullscreen}
            @hcm-close=${handlers.onSheetClose}
            .theme=${state.theme}
            .accent=${state.accent}
            @hcm-consent=${handlers.onConsent}
            @hcm-locale-change=${handlers.onLocaleChange}
            @hcm-theme-change=${handlers.onThemeChange}
            @hcm-shortcuts-change=${handlers.onShortcuts}
            @hcm-help-open=${handlers.onHelpOpen}
        ></hcm-about-dialog>
        ${lightbox(state, manifest.photos, view, handlers)}
        ${dateMenu({ ...view, layers: manifest.layers, orientation: view.layout.timeline, front: state.front }, view.dock, handlers.onDatePick)}`;
}

/**
 * The modal sheets; under the lightbox (opened from the photo sheet) they are inert, as the frame is: the tour found the
 * photo sheet's image button, handle and Close usable and in the Tab order beneath the lightbox.
 */
function modalSheets(view: ViewerView, ready: Ready, mode: SheetMode, handlers: ViewerHandlers): TemplateResult {
    const { sheet, lightbox: inert } = ready.state;
    return html`${layerPanel(view, ready, { mode, open: sheet === 'layers', inert }, handlers)}
    ${photoSheet(view, ready, { mode, open: sheet === 'photo' || sheet === 'poi', inert }, handlers)}
    ${photosSheet(view, ready, { mode, open: sheet === 'photos', inert }, handlers)}
    ${unplacedSheet(view, ready.manifest, { mode, open: sheet === 'unplaced', inert }, handlers.onSheetClose)}
    ${storiesSheet({ ...view, storyId: ready.state.selectedStoryId }, ready.manifest, { mode, open: sheet === 'stories', inert }, handlers)}`;
}
