/**
 * What the Imagery page's templates share (`docs/research/M3-interfaces.md` §10.2): the language, the area's view and
 * intents, the page's addresses, whether the admin may write, and the page's questions (Reject, Dismiss, Pay, Cancel and
 * Resume processing ask first).
 */
import type { UiLocale } from '@hcm/shared';

import type { ArchiveHostPort } from '../archive/archive-port.js';
import type { WorkerHostPort } from '../worker/worker-port.js';
import type { ImageryIntentsPort, ImageryViewState } from './imagery-port.js';

/** The questions the page asks before an action that cannot be taken back or costs money. */
export type ImageryQuestion =
    'reject' | 'pay' | 'cancel' | 'resume' | 'drop' | 'approveWorse' | 'approveOutside' | 'rejectRecalibration' | 'deleteVersion';

export interface ImageryContext {
    readonly locale: UiLocale;
    readonly view: ImageryViewState;
    readonly intents: ImageryIntentsPort | null;
    /** `#/imagery/<params>`. */
    readonly href: (params: readonly string[]) => string;
    readonly go: (params: readonly string[]) => void;
    /** A revoked admin's page: nothing writes. */
    readonly readOnly: boolean;
    /** Batch 4: the signed-in admin owns the city (Approve the sheet-name placement is the owner's alone). */
    readonly owner?: boolean;
    /** Pause (2026-11-13): the signed-in admin's uid, so their own pause of a job reads "you" ('' when unknown). */
    readonly self?: string;
    readonly ask: (question: ImageryQuestion) => void;
    /** Renders the page again: a chunk it fetched on first need settled (`orders/lazy-card.ts`). */
    readonly refresh: () => void;
    /**
     * The keyboard goes to the open scene's or version's heading once the page has rendered: an action refused while its
     * own control may go with it (I ordered it on a frame scanned meanwhile: the card goes with the order).
     */
    readonly focusDetail: () => void;
    /** M12: brings the page's one map into view (a phone's approval card lies below it). */
    readonly showMap: () => void;
    /** M7: the admin app, which hands a version's `<hcm-run-place>` its feed (absent: no place shown). */
    readonly app?: (WorkerHostPort & ArchiveHostPort) | null;
}
