/**
 * The layer editor's Crop as its element reads it (`docs/research/M3-interfaces.md` §10.5), mirroring
 * `packages/admin/src/layers/geometry/types.ts` (checked at compile time by `packages/admin/test/app/admin-port.test.ts`).
 */
import type { AdminNoticeInputPort } from '../../notice-port.js';

export type CropPhasePort = 'loading' | 'drawing' | 'drawn' | 'saving' | 'no-map';

export interface CropStatePort {
    readonly phase: CropPhasePort;
    readonly vertices: number;
    readonly refusal: AdminNoticeInputPort | null;
}

/** What the element's buttons do (the layers page's intents). */
export interface CropActionsPort {
    readonly redraw: () => void;
    readonly addCorner: () => void;
    readonly save: () => void;
    readonly close: () => void;
}
