/**
 * The photos area's state (`docs/research/M2c-interfaces.md` §2.1, §6): one immutable object the page renders,
 * replaced on every change. It never enters the shell's `AdminState`: the photos page subscribes to its area alone.
 * `@hcm/ui/admin`'s `PhotosViewState` (`packages/ui/src/admin/photos/photos-port.ts`) mirrors it structurally.
 */
import type { ApiErrorCode, CityRole, PhotoDoc, ValidationIssue } from '@hcm/shared';

import { NO_ASSIST, type AssistState } from '../assist/assist.js';
import type { LoadStatus } from '../content/list.js';
import type { StoreFailure } from '../content/services.js';
import type { Suggestion } from './autofill.js';
import type { BulkReport } from './bulk.js';
import type { DraftConflict, PhotoEditable, PhotoValue } from './draft.js';
import type { MapStatus } from './map.js';
import { NO_SEARCH, type PhotoFilter, type PhotoRow, type PhotoSearch, type PublishBlock } from './model.js';
import type { PhotoVersionKind, ReplaceState } from './replace.js';
import type { StickyFields } from './session.js';
import type { UploadItem } from './upload-queue.js';

export interface PhotosListState {
    /** `error`: the listener stopped (Try again). */
    readonly status: LoadStatus;
    /** The listener lost the server and comes back by itself ("Reconnecting…"); the rows stay. */
    readonly reconnecting: boolean;
    readonly failure: StoreFailure | null;
    readonly filter: PhotoFilter;
    readonly search: PhotoSearch;
    /** The loaded photos the search keeps, newest change first. */
    readonly rows: readonly PhotoRow[];
    /** Photos loaded before the search (the empty state needs to know there are none at all). */
    readonly loaded: number;
    readonly hasMore: boolean;
    /** The bulk selection, in the order chosen. */
    readonly selection: readonly string[];
}

export interface PhotoEditorState {
    /** M13: the admin's role in the city: an uploader publishes nothing, a moderator deletes nothing. */
    readonly role: CityRole | null;
    readonly id: string;
    /** `notFound`: no such photo; `gone`: deleted while open (the draft stays on screen, Save is off); `error`: the read stopped. */
    readonly status: 'loading' | 'ready' | 'notFound' | 'gone' | 'error';
    /** The photo's listener lost the server ("Reconnecting…"); the draft stays. */
    readonly reconnecting: boolean;
    readonly failure: StoreFailure | null;
    readonly value: PhotoValue | null;
    readonly dirty: readonly PhotoEditable[];
    readonly touched: boolean;
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: DraftConflict | null;
    readonly image: NonNullable<PhotoDoc['image']> | null;
    readonly processing: PhotoDoc['processing'];
    readonly processingError: ApiErrorCode | null;
    readonly duplicateOf: string | null;
    /** Why Published cannot be switched on now (for the draft's licence). */
    readonly block: PublishBlock | null;
    readonly checkPlace: boolean;
    /** EXIF suggestions not applied yet, each with Apply. */
    readonly suggestions: readonly Suggestion[];
    /** Set direction: the next click on the map is what the camera looked at. */
    readonly picking: boolean;
    readonly replace: ReplaceState | null;
    /** The improved and colorized versions' uploads (A140), as `replace` is the image's. */
    readonly versionUploads: Readonly<Record<PhotoVersionKind, ReplaceState | null>>;
}

/** The confirmation before a delete (§9.5): the photos and, for one, its title. */
interface PhotosConfirm {
    readonly ids: readonly string[];
    readonly title: string | null;
}

export interface PhotosState {
    readonly list: PhotosListState;
    readonly uploads: readonly UploadItem[];
    /** What a new photo gets (shown above the drop zone). */
    readonly sticky: StickyFields;
    readonly editor: PhotoEditorState | null;
    readonly map: MapStatus;
    readonly confirm: PhotosConfirm | null;
    /** The last bulk action's outcome, open after "See why". */
    readonly report: BulkReport | null;
    /** A bulk action or a delete is being written. */
    readonly busy: boolean;
    /** M4 (CR-M4-4): the open photo's title suggestions and translation drafts. */
    readonly assist: AssistState;
    /** M13: the admin's role in the city. */
    readonly role: CityRole | null;
}

export const INITIAL_LIST: PhotosListState = {
    status: 'loading',
    reconnecting: false,
    failure: null,
    filter: 'all',
    search: NO_SEARCH,
    rows: [],
    loaded: 0,
    hasMore: false,
    selection: [],
};

export function initialPhotosState(sticky: StickyFields, role: CityRole | null = null): PhotosState {
    return {
        list: INITIAL_LIST,
        uploads: [],
        sticky,
        editor: null,
        map: 'none',
        confirm: null,
        report: null,
        busy: false,
        assist: NO_ASSIST,
        role,
    };
}
