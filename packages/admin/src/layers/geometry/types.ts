/**
 * The layer editor's Crop as the layers area sees it (`docs/research/M3-interfaces.md` §10.5; CR-M3-7): the tool lives
 * in the lazy `layer-geometry` chunk (`./crop-tool.ts`, `../../pages/layer-geometry.ts`); the layers chunk knows only
 * these types and the slot that loads it (`../crop-slot.ts`).
 */
import type { CallablesPort } from '../../firebase/ports.js';
import type { NoticeInput } from '../../state/state.js';
import type { AreaMap } from '../map-session.js';

/** What the tool needs of the area's services (`ContentServices` has them all). */
interface CropServices {
    readonly cityId: string;
    readonly callables: CallablesPort;
    readonly notify: (notice: NoticeInput) => void;
    readonly readOnly: () => boolean;
}

/** `loading` (the tools), `drawing` (corners being clicked), `drawn` (Save offered), `saving`, `no-map` (no map to draw on). */
type CropPhase = 'loading' | 'drawing' | 'drawn' | 'saving' | 'no-map';

export interface CropState {
    readonly phase: CropPhase;
    /** The drawn polygon's corners. */
    readonly vertices: number;
    /** Why `imagery.crop` refused the polygon, or null. */
    readonly refusal: NoticeInput | null;
}

export interface CropToolDeps {
    readonly services: CropServices;
    readonly map: Pick<AreaMap, 'drawing'>;
    readonly layerId: string;
    readonly changed: (state: CropState) => void;
    /** The crop was sent: the tool closes. */
    readonly done: () => void;
}

export interface CropTool {
    /** Attaches the drawing tools to the editor's map and starts the polygon. */
    start(): Promise<void>;
    /** Clears the polygon and starts a new one. */
    redraw(): void;
    /** The keyboard's way: a corner at the map's centre (the map pans with the arrow keys); three make the polygon. */
    addCorner(): void;
    /** `imagery.crop` of the drawn polygon: true once its job is queued. */
    save(): Promise<boolean>;
    /** Detaches the drawing tools. */
    close(): void;
}

export type CropToolFactory = (deps: CropToolDeps) => CropTool;
