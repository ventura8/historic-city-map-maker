import type { Manifest, ViewerLocale } from '@hcm/shared';
import type { CameraOffset } from '../map/mapbox-types.js';
import type { MapLabelDetail } from './hcm-layer-panel.js';
import type { ViewerLayout } from './layout.js';
import type { LegalLift } from './legal-lift.js';
import type { ThemeChoice, ViewerError, ViewerState } from './store-port.js';
import type { TimelineDock } from './timeline-dock.js';
import type { TimelineStop } from './timeline-model.js';
import type { MenuPoint } from './map-menu-trigger.js';
import type { LightboxHandlers, MapMenuHandlers } from './viewer-lightbox.js';
import type { PlaceHandlers } from './viewer-stories.js';
import type { SearchHandlers } from './viewer-search.js';
import type { CameraSource } from './hcm-compass.js';
import type { MapSize } from './viewer-zoom.js';
import type { UpdateOffer } from './viewer-update.js';

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
export interface ViewerHandlers extends LightboxHandlers, MapMenuHandlers, PlaceHandlers, SearchHandlers {
    readonly onYearChange: (event: CustomEvent<{ readonly year: number | null }>) => void;
    readonly onOverlayVisibility: (event: CustomEvent<{ readonly id: string; readonly visible: boolean }>) => void;
    /** A place category's sub-group switch (`overlay-subgroups.ts`). */
    readonly onOverlayGroup: (event: CustomEvent<{ readonly id: string; readonly group: string; readonly visible: boolean }>) => void;
    readonly onOverlayOpacity: (event: CustomEvent<OverlayOpacityDetail>) => void;
    readonly onSheetClose: (event: Event) => void;
    /** V75: the open photo came from the list (its sheet shows Back), and where the list was scrolled. */
    readonly photoReturn?: { readonly fromList: boolean; readonly scroll: number };
    /** The photo sheet's "Show on map" (V51). */
    readonly onPhotoLocate: (event: CustomEvent<PhotoLocateDetail>) => void;
    /** M17: a story to open (null: their list); a place a story names is `PlaceHandlers`'. */
    readonly onStorySelect: (event: CustomEvent<{ readonly storyId: string | null }>) => void;
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
    /** Design B: the Photos switch's popover chose every photo (null) or a window of years. */
    readonly onPhotosNear: (event: CustomEvent<{ readonly near: number | null }>) => void;
    /** The extra-large Layers pane minimized to its rail, or restored (V03). */
    readonly onLayersMinimize: (event: CustomEvent<{ readonly minimized: boolean }>) => void;
    readonly onToastDismiss: (event: Event) => void;
    /** The zoom buttons: one level in (1) or out (-1). */
    readonly onZoom: (step: number) => void;
    /** The compass (V64): the map back to north up and level. */
    readonly onCompass: () => void;
    /** Show my location's icon button (V10), above the compass. */
    readonly onLocate: () => void;
    /** V93: the shot direction button, under Show my location. */
    readonly onShotDirection: () => void;
    /** The help panel's switch of the single-key shortcuts. */
    readonly onShortcuts: (event: CustomEvent<{ readonly enabled: boolean }>) => void;
    /** About's button to the help panel. */
    readonly onHelpOpen: (event: Event) => void;
    /** About's button to the Licence and citation panel (V92). */
    readonly onLicenceOpen: (event: Event) => void;
    readonly onSkip: () => void;
    readonly onNearYear: () => void;
    /** V13: a date picked in the timeline's date picker. */
    readonly onDatePick: (event: CustomEvent<{ readonly layerId: string }>) => void;
    /** The year panel's checkbox: a layer shown or hidden on the map (`hcm-date-show`, the store's `toggleOverlay`). */
    readonly onDateShow: (event: CustomEvent<{ readonly layerId: string; readonly visible: boolean }>) => void;
}

/** A ready viewer: the state with its manifest. */
export interface Ready {
    readonly state: ViewerState;
    readonly manifest: Manifest;
}
