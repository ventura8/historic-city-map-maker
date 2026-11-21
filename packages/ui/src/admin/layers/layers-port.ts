/**
 * What `<hcm-layers-page>` reads of the layers area (`packages/admin/src/layers/layers.ts`), mirrored structurally
 * because `@hcm/ui` sits below `@hcm/admin` (`docs/research/M2c-interfaces.md` §2.3);
 * `packages/admin/test/app/admin-port.test.ts` checks that the real store satisfies it. The draft and the preview sink
 * are shared with the settings page.
 */
import type { ApiErrorCode, LayerAdjustmentName, LayerAdjustments, LayerDoc, LayerSource, UiLocale, ValidationIssue } from '@hcm/shared';

import type { ListStatePort, LoadStatusPort, StoredPort, StoreFailurePort } from '../area-port.js';
import type { AssistActionsPort, AssistViewPort } from '../assist/assist-port.js';
import type { CropStatePort } from './geometry/crop-port.js';

export interface DraftConflictPort {
    readonly by: string;
    readonly at: string;
    readonly fields: readonly string[];
}

/** One document's draft (`EditDraft`): the base read, the value edited, what changed and what Save found. */
export interface DraftStatePort<T> {
    readonly base: StoredPort<T> | null;
    readonly value: T | null;
    readonly dirty: readonly string[];
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: DraftConflictPort | null;
    readonly gone: boolean;
}

/** A save, a reorder or a batch: written, or why not. */
export type WriteOutcomePort =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly reason: 'conflict' | 'gone' | 'denied' | 'offline' | 'invalid';
          readonly issues?: readonly ValidationIssue[];
      };

/** What the page's map previews (the pois' `MapPreview` satisfies it). */
type PreviewChangePort =
    | {
          readonly kind: 'layer';
          readonly id: string;
          readonly opacity?: number;
          readonly visible?: boolean;
          readonly adjustments?: LayerAdjustments;
      }
    | { readonly kind: 'photos-overlay'; readonly opacity: number }
    | { readonly kind: 'poi-category'; readonly id: string; readonly opacity?: number; readonly color?: string; readonly icon?: string };

type PreviewTargetPort =
    | { readonly kind: 'layer'; readonly id: string }
    | { readonly kind: 'photos-overlay' }
    | { readonly kind: 'poi-category'; readonly id: string };

export interface PreviewSinkPort {
    preview(change: PreviewChangePort): void;
    restore(target: PreviewTargetPort): void;
}

export interface LayerItemPort {
    readonly id: string;
    readonly label: LayerDoc['label'];
    readonly year: number;
    readonly status: LayerDoc['status'];
    readonly published: boolean;
    readonly order: number;
    readonly opacity: number;
    readonly defaultVisible: boolean;
    readonly sourceType: LayerSource['type'];
    readonly linked: boolean;
    readonly version: string;
}

export interface LayerEditorPort {
    readonly id: string;
    readonly doc: { readonly status: LoadStatusPort; readonly reconnecting: boolean; readonly failure: StoreFailurePort | null };
    readonly notFound: boolean;
    readonly draft: DraftStatePort<LayerDoc>;
}

export type LayerDeletionPort =
    | { readonly phase: 'idle' }
    | { readonly phase: 'confirm' | 'running'; readonly id: string; readonly label: string; readonly graceDays: number };

export interface LinkFormPort {
    readonly address: string;
    readonly tileSize: 256 | 512;
    readonly labelRo: string;
    readonly labelEn: string;
    readonly year: string;
    readonly kind: LayerDoc['kind'];
    readonly attribution: string;
}

export interface LinkStatePort {
    readonly form: LinkFormPort;
    readonly issues: readonly ValidationIssue[];
    readonly refusal: { readonly code: ApiErrorCode; readonly params?: Readonly<Record<string, string>> } | null;
    readonly origins: readonly string[];
    readonly tried: boolean;
    readonly sending: boolean;
    /** M3: Check's answer (`imagery.probeTiles`) for the address as it stands. */
    readonly probe:
        | { readonly status: 'idle' | 'checking' }
        | { readonly status: 'ok'; readonly contentType: string }
        | {
              readonly status: 'failed';
              readonly refusal: { readonly code: ApiErrorCode; readonly params?: Readonly<Record<string, string>> };
          };
}

/** The page's map: none yet, loading, ready, or why there is none (as `hcm-admin-map` shows it). */
export type MapStatusPort = 'none' | 'loading' | 'ready' | 'no-token' | 'no-webgl' | 'failed';

export interface LayersViewState {
    readonly list: ListStatePort<LayerItemPort>;
    readonly editor: LayerEditorPort | null;
    readonly reordering: boolean;
    readonly deletion: LayerDeletionPort;
    readonly link: LinkStatePort | null;
    readonly map: MapStatusPort;
    /** M3 (CR-M3-7): the open Crop, or null. */
    readonly crop: CropStatePort | null;
    /** M4 (CR-M4-4): the open layer's translation drafts. */
    readonly assist: AssistViewPort;
}

export type LayerTextFieldPort = 'label.ro' | 'label.en' | 'description.ro' | 'description.en' | 'attribution' | 'year' | 'date';

/** M4 (CR-M4-4): the draft buttons beside the name and the description ride with the area's intents. */
export interface LayersIntentsPort extends AssistActionsPort {
    retry(): void;
    edit(patch: Partial<Pick<LayerDoc, 'defaultVisible' | 'published'>>): void;
    setField(field: LayerTextFieldPort, text: string): void;
    setOpacity(percent: number): void;
    setAdjustment(name: LayerAdjustmentName, percent: number): void;
    resetAdjustments(): void;
    save(): Promise<WriteOutcomePort | null>;
    discard(): void;
    keepMine(): void;
    takeTheirs(): void;
    move(id: string, direction: 'up' | 'down'): Promise<WriteOutcomePort | null>;
    moveTo(id: string, index: number): Promise<WriteOutcomePort | null>;
    askDelete(): void;
    cancelDelete(): void;
    confirmDelete(): Promise<boolean>;
    openLink(): void;
    editLink(patch: Partial<LinkFormPort>): void;
    closeLink(): void;
    submitLink(): Promise<string | null>;
    /** M3: Check, one tile of the address asked by the server. */
    checkLink(): Promise<void>;
    attachPreview(sink: PreviewSinkPort | null): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    // M3 (CR-M3-7): the layer editor's Crop.
    crop(): Promise<void>;
    redrawCrop(): void;
    addCropCorner(): void;
    saveCrop(): Promise<boolean>;
    closeCrop(): void;
}

/** The text of a layer's label in the admin's language (English falls back to Romanian). */
export function labelOf(label: LayerDoc['label'], locale: UiLocale): string {
    return locale === 'en' ? (label.en ?? label.ro) : label.ro;
}
