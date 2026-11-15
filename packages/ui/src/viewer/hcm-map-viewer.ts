/**
 * `<hcm-map-viewer>`: the public element of the engine (docs/ENGINE_API.md → `<hcm-map-viewer>`). It renders the
 * viewer store's state (`store-port.ts`) in its shadow root, adapts its layout to its own size (window classes from
 * a ResizeObserver, container queries for the rest), maps the parts' events to store actions and fires the public
 * events. The engine (`@hcm/engine` `mount`) creates the store and the map and `attach`es them; a declarative element
 * (`<hcm-map-viewer manifest-url=...>`) asks the engine to do so through `setViewerBootstrap` when it connects.
 *
 * It never touches the map or the URL hash: the store does. The map container is a stable `<div>` in the shadow root
 * (`mapContainer`); mapbox-gl.css is linked inside the shadow root (`mapboxCssUrl`), the city theme is adopted on the
 * host (`applyTheme`). It listens on that container for what opens the map's menu (`watchMapMenu`).
 */
import { isRtl, resolveViewerLocale, type MessageKey } from '@hcm/shared';
import { LitElement, type TemplateResult } from 'lit';

import { deepActiveElement, restoreFocus, tabbableElements } from '../components/focus.js';
import { applyTheme } from '../theme/apply.js';
import { OverlayChangeTracker, overlayEvents, viewerEvents, type PublicEvent } from './events.js';
import type { HcmTimeline } from './hcm-timeline.js';
import { commandAllowed, isDialogSheet, runInputCommand, type InputCommand } from './input-commands.js';
import { layoutFor, type ViewerLayout } from './layout.js';
import { LegalLiftWatcher, NO_LIFT, sameLift, type LegalLift } from './legal-lift.js';
import { watchMapMenu, type MenuPoint } from './map-menu-trigger.js';
import { stopMyLocation } from './my-location.js';
import { browserServices, type ViewerServices } from './services.js';
import type { Unsubscribe, ViewerController, ViewerError, ViewerState, ViewerStorePort } from './store-port.js';
import { TimelineDock } from './timeline-dock.js';
import { timelineStops, type TimelineStop } from './timeline-model.js';
import { syncLocale } from './viewer-actions.js';
import { themeChanged, viewerTokens } from './viewer-theme.js';
import { createHandlers } from './viewer-handlers.js';
import { isGameConsole, reportConsole } from './game-console.js';
import { activate as activateIn, askForPadKeys, navigate as navigateIn, spatialKey, type Direction } from './spatial-nav.js';
import { isViewerKey, shortcutOf } from './viewer-keyboard.js';
import { modalOpen } from './viewer-legal.js';
import { renderViewer, type OverlayOpacityDetail, type ViewerHandlers } from './viewer-render.js';
import { viewerStyles } from './viewer-styles.js';
import { ViewerUpdates } from './viewer-update.js';
import type { MapSize } from './viewer-zoom.js';

export const HCM_MAP_VIEWER_TAG = 'hcm-map-viewer';

/** Boots a declarative `<hcm-map-viewer>` from its attributes (set by the engine's `defineElements`). */
export type ViewerBootstrap = (element: HcmMapViewer) => void;

let bootstrap: ViewerBootstrap | null = null;

/** The engine's boot function for declarative elements (`@hcm/engine` `defineElements` sets it; null clears it). */
export function setViewerBootstrap(boot: ViewerBootstrap | null): void {
    bootstrap = boot;
}

function layoutOf(state: ViewerState | null): ViewerLayout {
    return state === null ? layoutFor('compact', false) : layoutFor(state.windowClass, state.compactHeight, state.dockable);
}

function stopsOf(state: ViewerState | null): readonly TimelineStop[] {
    return timelineStops(state?.manifest?.layers ?? []);
}

/** A copy of `state` before boot: the starting point of the events of a store attached in any state. */
function idleOf(state: ViewerState): ViewerState {
    return { ...state, status: 'idle', selectedPhotoId: null, selectedPoiId: null };
}

/** The map container's box: read at each render, which a resize of the map follows (Mapbox's `moveend`). */
function sizeOf(map: HTMLElement | null): MapSize | null {
    return map === null ? null : { width: map.clientWidth, height: map.clientHeight };
}

type Opener = 'sheet' | 'lightbox';

/** The full-size view and About (or its help panel) are side-loaded (`extras-loader.ts`). */
function hasExtras(state: ViewerState): boolean {
    return state.lightbox || isDialogSheet(state.sheet);
}

/** Extras that could not load: the full-size view or About closes, and a toast says the full-size image failed. */
function closeExtras(store: ViewerStorePort): void {
    if (store.getState().lightbox) {
        store.setLightbox(false);
        store.showToast('error.photoImage');
    } else {
        store.openSheet('none');
    }
}

export class HcmMapViewer extends LitElement {
    static override readonly properties = {
        manifestUrl: { type: String, attribute: 'manifest-url' },
        cityId: { type: String, attribute: 'city-id' },
        engineBase: { type: String, attribute: 'engine-base' },
        manifest: { attribute: false },
        bootError: { attribute: false },
        services: { attribute: false },
        mapboxCssUrl: { attribute: false },
        engineVersion: { attribute: false },
        viewState: { state: true },
        mapMenu: { state: true },
        finePointer: { state: true },
        legalLift: {
            state: true,
            hasChanged: (next: LegalLift, previous?: LegalLift) => previous === undefined || !sameLift(next, previous),
        },
    };

    static override readonly styles = viewerStyles;

    /** The native `lang` attribute is observed too: setting it switches the language live. */
    static override get observedAttributes(): string[] {
        return [...super.observedAttributes, 'lang'];
    }

    declare manifestUrl: string;
    declare cityId: string;
    declare engineBase: string;
    /** An inline City Manifest v1 (set it before the element is connected). */
    declare manifest: unknown;
    /** A boot error found before any store exists (an invalid configuration). */
    declare bootError: ViewerError | null;
    declare services: ViewerServices;
    declare mapboxCssUrl: string;
    declare engineVersion: string;
    declare viewState: ViewerState | null;
    /** Where the map's menu is open (V62), in the map's px; null: closed. */
    declare mapMenu: MenuPoint | null;
    /** How far Mapbox's bottom corners move out from under the open modal sheet (V18, `legal-lift.ts`). */
    declare legalLift: LegalLift;
    /** A mouse is the main pointer: a large window shows the text chip, a tablet's finger the icon button (`viewer-near-year.ts`). */
    declare finePointer: boolean;

    #store: ViewerStorePort | null = null;
    readonly #pointer = window.matchMedia('(pointer: fine)');
    readonly #onPointer = (): void => {
        this.finePointer = this.#pointer.matches;
    };
    #controller: ViewerController | null = null;
    #unsubscribe: Unsubscribe = () => undefined;
    #stopWatching: () => void = () => undefined;
    readonly #lift = new LegalLiftWatcher(
        () => this.shadowRoot,
        () => this.getBoundingClientRect(),
        (lift) => {
            this.legalLift = lift;
        },
    );
    readonly #tracker = new OverlayChangeTracker();
    /** A newer deploy: the page script's reload held while something is open, else the Reload snackbar (`viewer-update.ts`). */
    readonly #updates = new ViewerUpdates(this);
    /** The timeline's pill on a phone (V12) and its date picker (V13). */
    readonly #dock = new TimelineDock(this);
    readonly #openers: Record<Opener, Element | null> = { sheet: null, lightbox: null };
    readonly #resizeObserver = new ResizeObserver((entries) => {
        this.#onResize(entries);
    });

    /** A hidden page stops Show my location: no position is watched while nobody looks at the map. */
    readonly #onVisibility = (): void => {
        if (this.ownerDocument.visibilityState === 'hidden') {
            this.#stopMyLocation();
        }
    };

    readonly #onKey = (event: KeyboardEvent): void => {
        const command = this.viewState?.shortcuts === true ? shortcutOf(event) : null;
        if (command === null) {
            spatialKey(this, event, isViewerKey);
        } else if (isViewerKey(this, event)) {
            event.preventDefault();
            this.runInput(command);
        }
    };

    readonly #handlers: ViewerHandlers = createHandlers({
        act: (event, action) => {
            this.#act(event, action);
        },
        setOpacity: (store, detail) => {
            this.#setOpacity(store, detail);
        },
        services: () => this.services,
        mapMenu: (point) => {
            this.mapMenu = point;
        },
        focusTimeline: () => {
            this.#dock.expand();
            this.renderRoot.querySelector<HcmTimeline>('#timeline')?.focus();
        },
        // Bound already (an arrow property), and created before the handlers.
        closeDates: this.#dock.closeDates,
    });

    constructor() {
        super();
        this.manifestUrl = '';
        this.cityId = '';
        this.engineBase = '';
        this.manifest = undefined;
        this.bootError = null;
        this.services = browserServices(window);
        this.mapboxCssUrl = '';
        this.engineVersion = '';
        this.viewState = null;
        this.mapMenu = null;
        this.legalLift = NO_LIFT;
        this.finePointer = true;
    }

    /** The controller `mount` returned for this element; null before the engine attached one. */
    get controller(): ViewerController | null {
        return this.#controller;
    }

    /** The element the map is mounted into (exists after the first render: await `updateComplete`). */
    get mapContainer(): HTMLElement | null {
        return this.renderRoot.querySelector<HTMLElement>('.map');
    }

    /** A keyboard shortcut or a gamepad button: what the state allows of `command` (docs/research/viewer-input.md §1). */
    runInput(command: InputCommand): void {
        this.#act(null, (store) => {
            if (!this.#dock.closedBy(command) && commandAllowed(store.getState(), command)) {
                runInputCommand(store, command);
                this.#focusLayers(command);
            }
        });
    }

    /** `layers` takes the focus into the panel, also where it is always docked and nothing opens. */
    #focusLayers(command: InputCommand): void {
        if (command === 'layers' && (this.#store?.getState().sheet === 'layers' || layoutOf(this.viewState).layersDocked)) {
            void this.updateComplete.then(() => {
                tabbableElements(this.renderRoot.querySelector('hcm-layer-panel')?.shadowRoot ?? this.shadowRoot ?? this)[0]?.focus();
            });
        }
    }

    /** No map to move: not ready, no WebGL, or a modal surface over it (the gamepad's lazy chunk asks). */
    mapCovered(): boolean {
        return this.viewState?.status !== 'ready' || !this.viewState.webgl || modalOpen(this.viewState, layoutOf(this.viewState).sheetMode);
    }

    /** The D-pad (the gamepad's lazy chunk, the Xbox's key emulation): spatial navigation (`spatial-nav.ts`). */
    navigate(direction: Direction): void {
        navigateIn(this, direction);
    }

    /** A on the pad: click what has the focus, or Enter on the map. */
    activate(): void {
        activateIn(this);
    }

    /** A toast from the gamepad's lazy chunk. */
    toast(key: MessageKey): void {
        this.#store?.showToast(key);
    }

    /** Connects the viewer to a store (and the controller that drives it); the current state renders at once. */
    attach(store: ViewerStorePort, controller: ViewerController | null): void {
        this.detach();
        this.#store = store;
        this.#controller = controller;
        const state = store.getState();
        this.#onState(state, idleOf(state));
        this.#subscribe();
        reportConsole(navigator.userAgent, store);
    }

    /** Disconnects the store (Show my location stops); the element shows its loading state again. */
    detach(): void {
        this.#stopMyLocation();
        this.#unsubscribe();
        this.#unsubscribe = () => undefined;
        this.#store = null;
        this.#controller = null;
        this.viewState = null;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#resizeObserver.observe(this);
        this.ownerDocument.addEventListener('keydown', this.#onKey);
        this.ownerDocument.addEventListener('visibilitychange', this.#onVisibility);
        askForPadKeys(navigator);
        this.#pointer.addEventListener('change', this.#onPointer);
        this.#onPointer();
        this.#applyTheme(this.viewState);
        this.#subscribe();
        this.#watchMapContainer();
        if (this.#store === null && this.bootError === null) {
            bootstrap?.(this);
        }
    }

    override disconnectedCallback(): void {
        this.#resizeObserver.disconnect();
        this.ownerDocument.removeEventListener('keydown', this.#onKey);
        this.ownerDocument.removeEventListener('visibilitychange', this.#onVisibility);
        this.#pointer.removeEventListener('change', this.#onPointer);
        this.#stopMyLocation();
        this.#unsubscribe();
        this.#unsubscribe = () => undefined;
        this.#stopWatching();
        this.#lift.stop();
        super.disconnectedCallback();
    }

    /** The map container exists from the first render on: it is watched from then until disconnect. */
    protected override firstUpdated(): void {
        this.#watchMapContainer();
    }

    /**
     * A modal sheet may have opened, closed or changed: Mapbox's corners follow the open one. The Layers panel and the photo
     * sheet render their sheets in their own shadow roots, after this element's update: the next frame sees them.
     */
    protected override updated(): void {
        requestAnimationFrame(() => {
            this.#lift.refresh();
        });
    }

    override attributeChangedCallback(name: string, old: string | null, value: string | null): void {
        super.attributeChangedCallback(name, old, value);
        if (name === 'lang') {
            const locale = resolveViewerLocale(value);
            // Arabic reads right to left: the whole viewer mirrors, its map container stays left to right (`viewer-render.ts`).
            this.dir = isRtl(locale) ? 'rtl' : 'ltr';
            this.#act(null, (store) => {
                syncLocale(store, locale);
            });
        }
    }

    override render(): TemplateResult {
        const state = this.viewState;
        const view = {
            state,
            bootError: this.bootError,
            layout: layoutOf(state),
            locale: state === null ? resolveViewerLocale(this.getAttribute('lang')) : state.locale,
            stops: stopsOf(state),
            manifestUrl: this.manifestUrl,
            engineVersion: this.engineVersion,
            mapboxCssUrl: this.mapboxCssUrl,
            mapSize: sizeOf(this.mapContainer),
            camera: this.#store,
            mapMenu: this.mapMenu,
            legalLift: this.legalLift,
            finePointer: this.finePointer,
            dock: this.#dock,
            gameConsole: isGameConsole(navigator.userAgent),
            update: this.#updates.offer(),
        };
        return renderViewer(view, this.#handlers);
    }

    #watchMapContainer(): void {
        this.#stopWatching();
        const container = this.mapContainer;
        if (container !== null) {
            this.#stopWatching = watchMapMenu(container, this.#openMapMenu);
        }
    }

    /** The map's menu is side-loaded with the full-size view (`extras-loader.ts`); it opens once a map shows. */
    readonly #openMapMenu = (point: MenuPoint): void => {
        if (this.viewState?.status !== 'ready') {
            return;
        }
        void (this.services.loadExtras?.() ?? Promise.resolve()).then(
            () => {
                this.mapMenu = point;
            },
            () => undefined,
        );
    };

    #stopMyLocation(): void {
        if (this.#store !== null) {
            stopMyLocation(this.#store);
        }
    }

    #subscribe(): void {
        const store = this.#store;
        if (store === null || !this.isConnected) {
            return;
        }
        this.#unsubscribe();
        this.#unsubscribe = store.subscribe((state, previous) => {
            this.#onState(state, previous);
        });
    }

    #onState(state: ViewerState, previous: ViewerState): void {
        this.viewState = state;
        this.#dispatchAll(viewerEvents(previous, state, this.#tracker, this.engineVersion));
        if (this.getAttribute('lang') !== state.locale) {
            this.setAttribute('lang', state.locale);
            this.ownerDocument.documentElement.lang = state.locale;
            this.ownerDocument.documentElement.dir = this.dir;
        }
        if (themeChanged(previous, state)) {
            this.#applyTheme(state);
        }
        this.#trackOpener('sheet', previous.sheet !== 'none', state.sheet !== 'none');
        this.#trackOpener('lightbox', previous.lightbox, state.lightbox);
        this.#loadExtras(hasExtras(previous), hasExtras(state));
    }

    /** The full-size view is side-loaded the first time it opens (`extras-loader.ts`); if it cannot load, it closes and says so. */
    #loadExtras(wasOpen: boolean, open: boolean): void {
        if (wasOpen || !open) {
            return;
        }
        this.services.loadExtras?.().catch(() => {
            this.#act(null, closeExtras);
        });
    }

    #applyTheme(state: ViewerState | null): void {
        if (this.isConnected) {
            applyTheme(this, viewerTokens(state, this.ownerDocument), state === null ? 'system' : state.theme, false);
        }
    }

    /**
     * Remembers what had focus when a sheet or the lightbox opened, and returns focus there once it is closed after
     * the render (a close that is undone in the same turn, such as stepping to the next photo, keeps the opener).
     */
    #trackOpener(kind: Opener, wasOpen: boolean, isOpen: boolean): void {
        if (wasOpen === isOpen) {
            return;
        }
        if (isOpen) {
            this.#openers[kind] ??= deepActiveElement(this.ownerDocument);
            return;
        }
        void this.updateComplete.then(() => {
            this.#restoreOpener(kind);
        });
    }

    #restoreOpener(kind: Opener): void {
        if (this.#isOpen(kind)) {
            return;
        }
        restoreFocus(this.#openers[kind]);
        this.#openers[kind] = null;
    }

    #isOpen(kind: Opener): boolean {
        const state = this.viewState;
        if (state === null) {
            return false;
        }
        return kind === 'lightbox' ? state.lightbox : state.sheet !== 'none';
    }

    #dispatchAll(events: readonly PublicEvent[]): void {
        for (const event of events) {
            this.dispatchEvent(new CustomEvent(event.type, { detail: event.detail, bubbles: true, composed: true }));
        }
    }

    /** Runs `action` on the attached store; the event (a part's viewer-internal event) never leaves the viewer. */
    #act(event: Event | null, action: (store: ViewerStorePort) => void): void {
        event?.stopPropagation();
        const store = this.#store;
        if (store !== null) {
            action(store);
        }
    }

    /** A slider's live value goes to the store at once; its release also fires the settled public events. */
    #setOpacity(store: ViewerStorePort, detail: OverlayOpacityDetail): void {
        this.#tracker.drag(detail.id, detail.final);
        store.setOverlayOpacity(detail.id, detail.opacity, detail.final);
        if (detail.final) {
            const state = store.getState();
            this.#dispatchAll(overlayEvents(this.#tracker.changes(state.overlays), state.manifest));
        }
    }

    /** The viewer's own box decides its window class (the map adapter follows its container by itself). */
    #onResize(entries: readonly ResizeObserverEntry[]): void {
        for (const entry of entries) {
            this.#act(null, (store) => {
                store.setWindowSize(entry.contentRect.width, entry.contentRect.height);
            });
        }
    }
}

/** Registers `<hcm-map-viewer>` once; calling it again is a no-op. */
export function defineHcmMapViewer(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_MAP_VIEWER_TAG) === undefined) {
        registry.define(HCM_MAP_VIEWER_TAG, HcmMapViewer);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-map-viewer': HcmMapViewer;
    }
}
