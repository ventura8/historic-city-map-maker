/**
 * The layers area's state and intents (`docs/research/M2c-interfaces.md` §8.1–§8.4): the list, the open layer's editor,
 * a reorder being written, a deletion, the Link dialog and the page's map; and the checks of a layer's draft.
 */
import type { AdminContentKey, LayerAdjustmentName, LayerDoc } from '@hcm/shared';

import { NO_ASSIST, type AssistState } from '../assist/assist.js';
import type { AssistIntents } from '../assist/editor-assists.js';
import type { DocState } from '../content/doc.js';
import { LOADING_LIST, type ListState } from '../content/list.js';
import type { WriteOutcome } from '../content/services.js';
import type { DraftState } from './draft.js';
import type { DeletionState } from './deletion.js';
import type { CropState } from './geometry/types.js';
import type { LayerTextField } from './fields.js';
import type { LinkState } from './linker.js';
import type { LinkForm } from './link.js';
import type { MapStatus } from './map-session.js';
import type { LayerItem, MoveDirection } from './model.js';
import type { PreviewSink } from './preview.js';

/** The fields the layer editor changes (`CLIENT_WRITES.layer.update` without the order, which a reorder writes, and the stamp). */
export const LAYER_EDITABLE = [
    'label',
    'description',
    'attribution',
    'year',
    'date',
    'opacity',
    'defaultVisible',
    'adjustments',
    'published',
] as const satisfies readonly (keyof LayerDoc)[];

/** What the editor's fields change directly (the sliders have their own intents). */
export type LayerPatch = Partial<
    Pick<LayerDoc, 'label' | 'description' | 'attribution' | 'year' | 'date' | 'defaultVisible' | 'published'>
>;

export interface LayerEditorState {
    readonly id: string;
    /** The document's listener: loading, ready (the draft holds it) or error, and "Reconnecting…". */
    readonly doc: Omit<DocState<LayerDoc>, 'doc'>;
    /** Read, and no such layer. */
    readonly notFound: boolean;
    readonly draft: DraftState<LayerDoc>;
}

export interface LayersState {
    readonly list: ListState<LayerItem>;
    /** `#/layers/<layerId>`, or null on the list alone. */
    readonly editor: LayerEditorState | null;
    /** A reorder is being written. */
    readonly reordering: boolean;
    readonly deletion: DeletionState;
    /** The Link dialog, while it is open. */
    readonly link: LinkState | null;
    /** The page's map: none yet, loading, ready, or why there is none. */
    readonly map: MapStatus;
    /** M3 (CR-M3-7): the open layer's Crop, while it is open. */
    readonly crop: CropState | null;
    /** M4 (CR-M4-4): the open layer's translation drafts. */
    readonly assist: AssistState;
}

/** M4 (CR-M4-4): the layer editor's draft buttons (`assist.translateDraft`) ride with the area's intents. */
export interface LayersIntents extends AssistIntents {
    /** Try again after a listener's failure (the list and the open layer). */
    retry(): void;
    edit(patch: LayerPatch): void;
    /** A text field as typed: a name or description in one language, the attribution, the year or the date. */
    setField(field: LayerTextField, text: string): void;
    /** The default opacity slider, in percent (previewed at once). */
    setOpacity(percent: number): void;
    /** One adjustment slider, in percent (the levels never cross). */
    setAdjustment(name: LayerAdjustmentName, percent: number): void;
    /** Every adjustment back to neutral. */
    resetAdjustments(): void;
    save(): Promise<WriteOutcome | null>;
    discard(): void;
    keepMine(): void;
    takeTheirs(): void;
    /** Move up or Move down in the drawing order (written at once, in one batch). */
    move(id: string, direction: MoveDirection): Promise<WriteOutcome | null>;
    /** A drag: `id` to the place `index` of the top-first list. */
    moveTo(id: string, index: number): Promise<WriteOutcome | null>;
    askDelete(): void;
    cancelDelete(): void;
    /** `layers.delete` of the open layer: true when it is gone (the page goes back to the list). */
    confirmDelete(): Promise<boolean>;
    openLink(): void;
    editLink(patch: Partial<LinkForm>): void;
    closeLink(): void;
    /** `layers.link`: the new layer's id (the page opens its editor), or null when refused. */
    submitLink(): Promise<string | null>;
    /** M3: Check, one tile of the address asked by the server (`imagery.probeTiles`). */
    checkLink(): Promise<void>;
    /** The page's map preview, once its map exists (null when it goes). */
    attachPreview(sink: PreviewSink | null): void;
    /** The page shows its map's host (`hcm-admin-map`'s `hcm-map-host`): the map is created into it. */
    attachMap(container: HTMLElement): void;
    /** The map's zoom buttons. */
    zoomBy(delta: number): void;
    /** M3 (CR-M3-7): Crop on the open layer (loads the `layer-geometry` chunk once). */
    crop(): Promise<void>;
    /** The crop polygon again from nothing. */
    redrawCrop(): void;
    /** The keyboard's way: a corner at the map's centre. */
    addCropCorner(): void;
    /** `imagery.crop` of the drawn polygon: true once its job is queued (the tool closes). */
    saveCrop(): Promise<boolean>;
    closeCrop(): void;
}

export const INITIAL: LayersState = {
    list: LOADING_LIST,
    editor: null,
    reordering: false,
    deletion: { phase: 'idle' },
    link: null,
    map: 'none',
    crop: null,
    assist: NO_ASSIST,
};

type WriteFailure = Extract<WriteOutcome, { readonly ok: false }>['reason'];

/** What the snackbar says when a save or a reorder is refused. */
export const REFUSED: Readonly<Record<WriteFailure, AdminContentKey>> = {
    conflict: 'adminContent.layers.refused.conflict',
    gone: 'adminContent.layers.refused.gone',
    denied: 'adminContent.layers.refused.denied',
    offline: 'adminContent.layers.refused.offline',
    invalid: 'adminContent.layers.refused.invalid',
};

export const LOADING_EDITOR_DOC: LayerEditorState['doc'] = { status: 'loading', reconnecting: false, failure: null };

/** Read, and no such layer (a layer deleted while open is `gone`, not missing). */
export function missing(state: DocState<LayerDoc>, editor: LayerEditorState): boolean {
    return state.status === 'ready' && state.doc === null && !editor.draft.gone;
}

/** A layer is published only once its tiles are ready: the manifest lists no other (`M2-interfaces.md` Addendum A, CR-M2-32 c). */
export function publishCheck(layer: LayerDoc): { path: string; code: 'validation.value' }[] {
    return layer.published && layer.status !== 'ready' ? [{ path: 'published', code: 'validation.value' }] : [];
}
