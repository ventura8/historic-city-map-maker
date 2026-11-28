/**
 * Viewer frame, floating controls and modal sheets. The map container survives each Lit render so Mapbox keeps its canvas.
 * The layout tour checks each named control for overlap and keeps attribution visible beside an open sheet.
 */
import { localized, translate, type Manifest, type ViewerLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { cssProperties, type CssPropertyValues } from '../components/css-properties.js';
import { dockedSheet } from './docked-sheet.js';
import { EMPTY } from './empty.js';
import { loadCityFavorites } from './favorites.js';
import { dialogMode, isDialogSheet } from './input-commands.js';
import { DOCKED_OPEN, type Placement, type SheetMode } from './layout.js';
import type { LegalLift } from './legal-lift.js';
import { renderSheetFrame } from './sheet-frame.js';
import { selectionOf } from './viewer-selection.js';
import type { ViewerError, ViewerState } from './store-port.js';
import { dateMenu, shownLayers, timelineDock } from './timeline-dock.js';
import { photosNearYear } from './timeline-model.js';
import { yearOpacity } from './timeline-opacity.js';
import { lightbox, mapMenu } from './viewer-lightbox.js';
import { menuActions, menuItem } from './viewer-menu.js';
import { nearYearChip, textChip } from './viewer-near-year.js';
import { favoritesSheet } from './viewer-favorites.js';
import { storiesSheet } from './viewer-stories.js';
import { searchDock } from './viewer-search.js';
import { unplacedSheet } from './viewer-unplaced.js';
import { statusOrCard } from './viewer-wordless.js';
import { markMenuOpen, zoomButtons } from './viewer-zoom.js';
import { modalOpen, renderConsentBanner } from './viewer-legal.js';
import { toastDock } from './viewer-update.js';
import type { Ready, ViewerHandlers, ViewerView } from './viewer-render-types.js';

export type { OverlayOpacityDetail, ViewerHandlers, ViewerView } from './viewer-render-types.js';

function readyOf(view: ViewerView): Ready | null {
    const state = view.state;
    // V91: the city's favourites, read once per city from this browser (a no-op after the first render).
    loadCityFavorites(state);
    return state?.status === 'ready' && state.manifest !== null ? { state, manifest: state.manifest } : null;
}

type Panes = 'none' | 'leading' | 'trailing' | 'both';

function panes(view: ViewerView, ready: Ready | null): Panes {
    const trailing = dockedSheet(view.layout, ready) !== 'none';
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

/** The photos the near-year chip may offer: none while the photos are switched off (the owner, 2026-11-22). */
function shownPhotos(state: ViewerState, manifest: Manifest): Manifest['photos'] {
    return state.overlays.some((overlay) => overlay.kind === 'photos' && overlay.visible) ? manifest.photos : [];
}

function controls(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    const { state, manifest } = ready;
    // Without a map the consent card is in the fallback's column (`noWebgl`).
    const consent = state.webgl && consentAsked(state, manifest);
    const items = menuActions({ webgl: state.webgl, layersDocked: view.layout.layersDocked, manifest }).map((action) =>
        menuItem(action, view.locale, state.myLocation !== null),
    );
    return html`${timelineArea(view, ready, handlers)} ${searchDock(state.webgl, manifest, view.locale, handlers)}
        ${nearYearChip(
            { locale: view.locale, wide: view.finePointer && textChip(state.windowClass, state.compactHeight) },
            state.year,
            shownPhotos(state, manifest),
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
        ${state.webgl ? zoomButtons({ ...view, locating: state.myLocation !== null }, state, manifest, handlers) : nothing}
        ${consent ? renderConsentBanner(view.locale, handlers.onConsent) : nothing}
        ${toastDock(view.locale, state.toast, handlers.onToastDismiss, view.update)} ${mapMenu(view, state, handlers)}`;
}

function timeline(view: ViewerView, ready: Ready, handlers: ViewerHandlers): TemplateResult {
    const { layers } = ready.manifest;
    const { year, overlays, photosNear: near } = ready.state;
    const opacity = year === null ? null : yearOpacity(overlays, layers, year, view.locale);
    const dock = {
        ...view,
        front: ready.state.front,
        year,
        orientation: view.layout.timeline,
        layers,
        collapsed: timelineCollapsed(view, ready),
        opacity,
        near,
    };
    return timelineDock(dock, view.dock, handlers);
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
        .photosNear=${ready.state.photosNear}
        ?inert=${placement.inert === true}
        @hcm-close=${handlers.onSheetClose}
        @hcm-overlay-visibility=${handlers.onOverlayVisibility}
        @hcm-overlay-group=${handlers.onOverlayGroup}
        @hcm-overlay-opacity=${handlers.onOverlayOpacity}
        @hcm-compare-toggle=${handlers.onCompareToggle}
        @hcm-map-label=${handlers.onMapLabel}
        @hcm-photos-near=${handlers.onPhotosNear}
        @hcm-layers-minimize=${handlers.onLayersMinimize}
    ></hcm-layer-panel>`;
}

function photoSheet(view: ViewerView, ready: Ready, placement: Placement, handlers: ViewerHandlers): TemplateResult {
    const { photo, poi, category, thumbnail } = selectionOf(ready.state, ready.manifest);
    return html`<hcm-photo-sheet
        .photo=${photo}
        .poi=${poi}
        .category=${category}
        .thumbnail=${thumbnail}
        .layers=${ready.manifest.layers}
        .photos=${ready.manifest.photos}
        .locale=${view.locale}
        .mode=${placement.mode}
        .open=${placement.open}
        .manifestUrl=${view.manifestUrl}
        .contributeUrl=${ready.manifest.contributeUrl ?? null}
        .stories=${ready.manifest.stories ?? []}
        .pois=${ready.manifest.pois ?? []}
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
        @hcm-layer-show=${handlers.onLayerShow}
        @hcm-poi-select=${handlers.onPoiSelect}
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
    const sheet = dockedSheet(view.layout, ready);
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
        favorites: () => favoritesSheet(view.locale, ready.manifest, DOCKED_OPEN, handlers),
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
            .manifest=${manifest}
            .manifestUrl=${view.manifestUrl}
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
            @hcm-licence-open=${handlers.onLicenceOpen}
        ></hcm-about-dialog>
        ${lightbox(state, manifest.photos, view, handlers)}
        ${dateMenu(
            { ...view, layers: manifest.layers, orientation: view.layout.timeline, front: state.front, shown: shownLayers(state.overlays) },
            view.dock,
            handlers,
        )}`;
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
    ${storiesSheet({ ...view, storyId: ready.state.selectedStoryId }, ready.manifest, { mode, open: sheet === 'stories', inert }, handlers)}
    ${favoritesSheet(view.locale, ready.manifest, { mode, open: sheet === 'favorites', inert }, handlers)}`;
}
