/**
 * What the photos page needs from the admin's photos area (`docs/research/M2c-interfaces.md` §2.3): `@hcm/ui` sits
 * below `@hcm/admin` (dependency-cruiser `ui-below-apps`), so these types mirror `packages/admin/src/photos/state.ts`
 * and the store's intents structurally; `packages/admin/test/photos/port.test.ts` checks at compile time that the real
 * store satisfies `PhotosAreaPort`. The elements render the state and call the intents; they never touch Firestore,
 * Storage or the map's library themselves.
 */
import type { AdminContentKey, ApiErrorCode, CityRole, FirestoreLicense, PhotoKind, ReviewStatus, ValidationIssue } from '@hcm/shared';

import type { AssistActionsPort, AssistViewPort } from '../assist/assist-port.js';
import type { PlacePickPort } from '../editing/place-pick-port.js';

/** A live list's or document's status (`LoadStatusPort` of `content-port.ts`, which imports this file). */
type PhotosLoadStatusPort = 'loading' | 'ready' | 'error';

/** Why a listener stopped (`StoreFailurePort` of `content-port.ts`). */
interface PhotosFailurePort {
    readonly kind: 'denied' | 'unavailable' | 'failed';
    readonly code: string;
}

export type PhotoFilterPort = 'all' | 'published' | 'unpublished' | 'processing' | 'failed' | 'rightsReview';

export type PublishBlockPort = 'processing' | 'failed' | 'license' | 'place';

export type PhotoMessageKey = AdminContentKey | ApiErrorCode;

interface PhotoSearchPort {
    readonly text: string;
    readonly yearFrom: number | null;
    readonly yearTo: number | null;
}

export interface PhotoRowPort {
    /** M13: where it stands in the review queue, and what the reviewer said. */
    readonly reviewStatus: ReviewStatus | null;
    readonly reviewNote: string | null;
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string | undefined };
    readonly year: number | null;
    readonly yearEnd: number | null;
    readonly author: string | null;
    readonly thumb: string | null;
    readonly published: boolean;
    readonly processing: 'pending' | 'done' | 'failed';
    readonly error: ApiErrorCode | null;
    readonly duplicateOf: string | null;
    readonly rightsReview: boolean;
    readonly checkPlace: boolean;
    readonly block: PublishBlockPort | null;
}

interface PhotosListPort {
    readonly status: PhotosLoadStatusPort;
    readonly reconnecting: boolean;
    readonly failure: PhotosFailurePort | null;
    readonly filter: PhotoFilterPort;
    readonly search: PhotoSearchPort;
    readonly rows: readonly PhotoRowPort[];
    readonly loaded: number;
    readonly hasMore: boolean;
    readonly selection: readonly string[];
}

export type UploadPhasePort = 'refused' | 'queued' | 'uploading' | 'processing' | 'done' | 'failed' | 'interrupted' | 'cancelled';

export interface UploadItemPort {
    readonly key: number;
    readonly name: string;
    readonly photoId: string | null;
    readonly phase: UploadPhasePort;
    readonly percent: number;
    readonly error: PhotoMessageKey | null;
    readonly params: Readonly<Record<string, string>> | null;
    readonly duplicateOf: string | null;
}

export interface StickyPort {
    readonly author?: string | undefined;
    readonly sourceLabel?: string | undefined;
    readonly sourceUrl?: string | undefined;
    readonly license?: FirestoreLicense | undefined;
    readonly rightsHolder?: string | undefined;
}

export interface LocalizedPort {
    readonly ro: string;
    readonly en?: string | undefined;
}

/** The editor's draft: the editable fields of a photo. */
export interface PhotoValuePort extends StickyPort {
    /** Absent on a street photo; `aerial` on one taken from above (the owner 2026-11-16). */
    readonly kind?: PhotoKind | undefined;
    readonly title: LocalizedPort;
    readonly description?: LocalizedPort | undefined;
    readonly dateText?: LocalizedPort | undefined;
    readonly year?: number | undefined;
    readonly yearEnd?: number | undefined;
    readonly month?: number | undefined;
    readonly day?: number | undefined;
    readonly license: FirestoreLicense;
    readonly permissionNote?: string | undefined;
    readonly links?: readonly { readonly url: string; readonly label: string }[] | undefined;
    /** M13: absent while the photo waits for a place. */
    readonly location?: { readonly lat: number; readonly lng: number } | undefined;
    readonly bearing?: number | undefined;
    readonly fov?: number | undefined;
    /** An aerial photo's viewed area: four corners on the ground, a rectangle or a trapezoid (the owner 2026-11-22). */
    /** M17 §12: the places whose Media list the photo. */
    readonly placeIds?: readonly string[] | undefined;
    /** M17 §14: an interior photo's level. */
    readonly level?: number | undefined;
    readonly viewedArea?: readonly { readonly lat: number; readonly lng: number }[] | undefined;
    readonly published: boolean;
    readonly rightsReview?: boolean | undefined;
    readonly credit?: string | undefined;
    /** Who improved or colorized the photo (the owner 2026-11-09, A140). */
    readonly versionCredits?: VersionCreditsPort | undefined;
    /** The improved and colorized versions `photos.onUpload` made; Remove drops one from the draft. */
    readonly versions?: VersionsPort | undefined;
}

/** The versions of a photo besides its original image. */
export type PhotoVersionKindPort = 'improved' | 'colorized';

type VersionCreditsPort = Readonly<Partial<Record<PhotoVersionKindPort, string | undefined>>>;

type VersionsPort = Readonly<
    Partial<Record<PhotoVersionKindPort, { readonly image: { readonly web: string; readonly thumb: string } } | undefined>>
>;

type PhotoFieldPort = keyof PhotoValuePort;

/** A change of the draft; `undefined` clears an optional field. */
export type PhotoPatchPort = { readonly [K in PhotoFieldPort]?: PhotoValuePort[K] | undefined };

type SuggestionFieldPort = 'location' | 'year' | 'bearing' | 'title';

export interface SuggestionPort {
    readonly field: SuggestionFieldPort;
    readonly text: string;
    readonly outside: boolean;
}

export interface ReplacePort {
    readonly phase: 'uploading' | 'processing' | 'replaced' | 'same' | 'refused' | 'failed';
    readonly percent: number;
    readonly error: PhotoMessageKey | null;
    readonly params: Readonly<Record<string, string>> | null;
    readonly duplicateOf: string | null;
}

export interface PhotoEditorPort {
    /** M13: the admin's role in the city: an uploader publishes nothing, a moderator deletes nothing. */
    readonly role: CityRole | null;
    readonly id: string;
    readonly status: 'loading' | 'ready' | 'notFound' | 'gone' | 'error';
    readonly reconnecting: boolean;
    readonly failure: PhotosFailurePort | null;
    readonly value: PhotoValuePort | null;
    readonly dirty: readonly string[];
    readonly touched: boolean;
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: { readonly by: string; readonly at: string; readonly fields: readonly string[] } | null;
    readonly image: { readonly web: string; readonly thumb: string; readonly w: number; readonly h: number } | null;
    readonly processing: 'pending' | 'done' | 'failed';
    readonly processingError: ApiErrorCode | null;
    readonly duplicateOf: string | null;
    readonly block: PublishBlockPort | null;
    readonly checkPlace: boolean;
    readonly suggestions: readonly SuggestionPort[];
    readonly picking: boolean;
    readonly replace: ReplacePort | null;
    /** A140: each version's upload, as `replace` is the image's. */
    readonly versionUploads: Readonly<Record<PhotoVersionKindPort, ReplacePort | null>>;
}

export type BulkKindPort = 'publish' | 'unpublish' | 'confirmRights' | 'setFields' | 'delete';

export interface BulkReportPort {
    readonly kind: BulkKindPort;
    readonly done: number;
    readonly skipped: readonly { readonly id: string; readonly title: string; readonly reason: string }[];
}

export type MapStatusPort = 'none' | 'loading' | 'ready' | 'unavailable' | 'no-token' | 'no-webgl' | 'failed';

export interface PhotosViewState {
    readonly list: PhotosListPort;
    readonly uploads: readonly UploadItemPort[];
    readonly sticky: StickyPort;
    readonly editor: PhotoEditorPort | null;
    readonly map: MapStatusPort;
    readonly confirm: { readonly ids: readonly string[]; readonly title: string | null } | null;
    readonly report: BulkReportPort | null;
    readonly busy: boolean;
    /** M4 (CR-M4-4): the open photo's title suggestions and translation drafts. */
    readonly assist: AssistViewPort;
    /** M13: the admin's role in the city. */
    readonly role: CityRole | null;
    /** M17 §12: the city's places the editor's place picker offers; null until read. */
    readonly places: readonly PlacePickPort[] | null;
}

/** A chosen file, as the page hands it to the area (a `File`). */
export interface PhotoFilePort {
    readonly name: string;
    readonly size: number;
    readonly data: Blob;
}

type PhotoBulkActionPort =
    | { readonly kind: 'publish' }
    | { readonly kind: 'unpublish' }
    | { readonly kind: 'confirmRights' }
    | { readonly kind: 'setFields'; readonly fields: StickyPort };

export interface PhotosIntentsPort extends AssistActionsPort {
    setFilter(filter: PhotoFilterPort): void;
    search(search: PhotoSearchPort): void;
    more(): void;
    retry(): void;
    toggleSelected(photoId: string): void;
    selectAll(): void;
    clearSelection(): void;
    bulk(action: PhotoBulkActionPort): Promise<void>;
    upload(files: readonly PhotoFilePort[]): void;
    retryUpload(key: number): void;
    cancelUpload(key: number): void;
    dismissUpload(key: number): void;
    clearUploads(): void;
    confirmPlace(photoId: string): void;
    confirmRights(photoId: string): Promise<void>;
    edit(patch: PhotoPatchPort): void;
    applySuggestion(field: SuggestionFieldPort): void;
    save(): Promise<boolean>;
    discard(): void;
    keepMine(): void;
    takeTheirs(): void;
    /** Try again after the open photo's listener stopped. */
    retryPhoto(): void;
    setDirection(): Promise<void>;
    cancelDirection(): void;
    pointAtCentre(): void;
    /** M13 §5: gives a photo with no place a pin at the map's centre. */
    placeAtCentre(): void;
    replaceImage(file: PhotoFilePort): void;
    cancelReplace(): void;
    dismissReplace(): void;
    uploadVersion(kind: PhotoVersionKindPort, file: PhotoFilePort): void;
    cancelVersion(kind: PhotoVersionKindPort): void;
    dismissVersion(kind: PhotoVersionKindPort): void;
    requestDelete(ids?: readonly string[]): void;
    cancelConfirm(): void;
    confirmDelete(): Promise<boolean>;
    showReport(): void;
    closeReport(): void;
    attachMap(container: HTMLElement, open: (photoId: string) => void): void;
    detachMap(): void;
    /** The admin map box's zoom buttons: one step in (+1) or out (-1). */
    zoomBy(delta: number): void;
    focusPhoto(photoId: string): void;
}

/** The photos area as the page reads it (`AreaPort<PhotosViewState, PhotosIntentsPort>`, §2.3). */
export interface PhotosAreaPort {
    readonly state: PhotosViewState;
    subscribe(listener: (state: PhotosViewState) => void): () => void;
    readonly intents: PhotosIntentsPort;
    open(params: readonly string[]): void;
    close(): void;
}
