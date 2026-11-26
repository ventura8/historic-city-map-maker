/**
 * The types of swipe compare's surface (M4, docs/research/M4-interfaces.md §3): what the engine's compare session passes
 * (`CompareUiProps`, every text already in the visitor's language but the element's own labels), what it hears back
 * (`CompareUiEvents`) and the surface itself (`CompareUi`, made by a `CompareUiFactory`). Types only.
 */
import type { ViewerLocale } from '@hcm/shared';

export type CompareUiMode = 'swipe' | 'toggle';

/** One side the visitor may compare with: a historical layer, or today (`layerId` null). */
export interface CompareChoice {
    readonly layerId: string | null;
    readonly label: string;
}

export interface CompareUiProps {
    readonly locale: ViewerLocale;
    /** `swipe`: the second map behind a divider; `toggle`: a two-way switch on the one map (a compact window). */
    readonly mode: CompareUiMode;
    /** The divider's settled place, 0 (the compared side fills the map) to 1 (the main side does). */
    readonly position: number;
    /** The main side's name: its visible historical layers, or today. */
    readonly mainLabel: string;
    /** The compared side (null: today). */
    readonly layerId: string | null;
    /** Every side the visitor may compare with, in the timeline's order. */
    readonly choices: readonly CompareChoice[];
    /** The compared layer's source ("Sursa: USGS EROS"), `''` for today: the second map's own attribution is hidden. */
    readonly credit: string;
}

/** What the visitor did on compare's surface. */
export interface CompareUiEvents {
    /** The divider settled (a drag released, a key pressed, the toggle switched). */
    readonly onPosition: (position: number) => void;
    readonly onChoose: (layerId: string | null) => void;
    readonly onClose: () => void;
}

export interface CompareUi {
    update(props: CompareUiProps): void;
    /** In swipe mode, the second map's container once it is drawn and mapbox-gl.css has loaded; else null. */
    mapContainer(): Promise<HTMLElement | null>;
    /** Takes the surface away; the focus, when it was on it, goes back to where it was when compare opened. */
    remove(): void;
}

/** Builds compare's surface after `anchor` (the viewer's map container); `mapboxCssUrl` styles the second map. */
export type CompareUiFactory = (anchor: HTMLElement, mapboxCssUrl: string, events: CompareUiEvents) => CompareUi;
