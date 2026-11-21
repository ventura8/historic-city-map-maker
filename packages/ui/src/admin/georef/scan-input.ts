/**
 * What `<hcm-scan-viewer>` (`./hcm-scan-viewer.ts`) keeps of a pointer, a pinch and an arrow key, and how it loads a picture: out of the
 * element, which keeps its 400 lines with the ghost and the sharper scan (2026-11-12); and the holder of the sharper scan's tiles.
 */
import { emit } from '../../components/internal.js';
import type { ScanMarker } from './scan-draw.js';
import type { OpenDetail, ScanDetailScene } from './scan-tiles.js';
import { panView, rotateView, type Point, type ScanView, type Size } from './scan-view.js';

/** One pointer's press: where it began, the view then, the marker it drags (null: the view pans). */
export interface Gesture {
    readonly start: Point;
    readonly view: ScanView;
    /** The marker being dragged, or null (the view pans). */
    readonly marker: ScanMarker | null;
    moved: boolean;
    last: Point;
    /** Ctrl was down: the drag turns the scan about the pane's centre instead of panning it. */
    readonly turning?: boolean;
}

/** One press of a turn button or key: 15 degrees. */
export const TURN_STEP = Math.PI / 12;

/** What the keys that act at once need of the scan pane. */
interface CommandViewer extends HTMLElement {
    pickCentre(): boolean;
    deleteSelected(): boolean;
    rotateBy(delta: number): boolean;
    upright(): boolean;
}

/** The keys that act at once, and what they do (true: handled). */
export const COMMANDS: Readonly<Record<string, ((viewer: CommandViewer) => boolean) | undefined>> = {
    Enter: (viewer) => viewer.pickCentre(),
    Delete: (viewer) => viewer.deleteSelected(),
    Backspace: (viewer) => viewer.deleteSelected(),
    Escape: (viewer) => {
        emit(viewer, 'hcm-escape', {});
        return true;
    },
    // Turning the scan: r to the right, R (Shift) to the left, n upright again.
    r: (viewer) => viewer.rotateBy(TURN_STEP),
    R: (viewer) => viewer.rotateBy(-TURN_STEP),
    n: (viewer) => viewer.upright(),
};

/** The linked map's place for the pane: one without an angle (the panes turn apart) keeps the pane as the owner turned it. */
export function followed<Camera extends { readonly angle?: number }>(
    follow: Camera,
    current: ScanView | null,
): Camera & { readonly angle: number | undefined } {
    return { ...follow, angle: follow.angle ?? current?.angle };
}

/** The view a drag without a marker leaves: panned by the drag, or (Ctrl) turned about the pane's centre by the angle it swept. */
export function draggedView(gesture: Gesture, at: Point, pane: Size): ScanView {
    if (gesture.turning !== true) {
        return panView(gesture.view, at.x - gesture.start.x, at.y - gesture.start.y);
    }
    const centre = { x: pane.width / 2, y: pane.height / 2 };
    const swept = Math.atan2(at.y - centre.y, at.x - centre.x) - Math.atan2(gesture.start.y - centre.y, gesture.start.x - centre.x);
    return rotateView(gesture.view, swept, centre);
}

/** Two fingers: the view when they came down, their spread and their midpoint. */
export interface Pinch {
    readonly view: ScanView;
    readonly startDistance: number;
    readonly centre: Point;
}

/** What an arrow key moves: the selected marker by one preview pixel, or the view. */
export const ARROW_STEPS: Readonly<Record<string, Point>> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
};

/** An image of `url`; `loaded` hears it once it is in (a picture that never loads is never heard). */
export function imageOf(url: string, loaded: (image: HTMLImageElement) => void): HTMLImageElement {
    const image = new Image();
    image.addEventListener('load', () => {
        loaded(image);
    });
    image.src = url;
    return image;
}

/** The sharper scan a pane was handed: its tiles' file and its pixels per scan pixel. */
export interface ScanDetailFile {
    readonly file: Blob;
    readonly scale: number;
}

/** A lazy chunk that did not load: the preview stays. */
const NOTHING = (): void => undefined;

/**
 * The pane's sharper scan (`./scan-tiles.ts`, a lazy chunk fetched when a version's first arrives): opened from its file, kept while
 * it is still the one the pane wants, its decoded tiles closed when the pane lets it go.
 */
export class DetailTiles {
    #wanted: ScanDetailFile | null = null;
    #opened: OpenDetail | null = null;

    /** Opens `detail` (null: none); `changed` hears it open and each tile decoded. */
    load(detail: ScanDetailFile | null, changed: () => void): void {
        this.drop();
        this.#wanted = detail;
        if (detail !== null) {
            void import('./scan-tiles.js')
                .then(async ({ openDetail }) => openDetail(detail, changed))
                .then((opened) => {
                    this.#keep(detail, opened);
                    changed();
                }, NOTHING);
        }
    }

    #keep(detail: ScanDetailFile, opened: OpenDetail | null): void {
        if (this.#wanted === detail) {
            this.#opened = opened;
        } else {
            opened?.dispose();
        }
    }

    /** Lets the sharper scan go: its decoded tiles are closed, one still opening is dropped when it arrives. */
    drop(): void {
        this.#wanted = null;
        this.#opened?.dispose();
        this.#opened = null;
    }

    /** What to draw of it for a view (null: none open, or the preview is enough). */
    scene(view: ScanView, pane: Size, previewScale: number): ScanDetailScene | null {
        return this.#opened?.scene({ view, pane, previewScale, ratio: Math.max(globalThis.devicePixelRatio, 1) }) ?? null;
    }
}
