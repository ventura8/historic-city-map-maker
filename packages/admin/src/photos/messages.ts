/**
 * The message keys the photos area shows for a write that did not happen (`docs/research/M2c-interfaces.md` §2.2,
 * §1.6): one text per `WriteOutcome` reason, shown in the snackbar or on the item.
 */
import type { AdminContentKey, ApiErrorCode } from '@hcm/shared';

import type { WriteOutcome } from '../content/services.js';

/** Why a write did not happen. */
export type WriteFailure = Exclude<WriteOutcome, { ok: true }>['reason'];

const WRITE_ERRORS: Readonly<Record<WriteFailure, AdminContentKey | ApiErrorCode>> = {
    conflict: 'adminContent.photos.error.conflict',
    gone: 'adminContent.photos.error.gone',
    denied: 'apiError.notAdmin',
    offline: 'adminContent.photos.error.offline',
    invalid: 'adminContent.photos.error.invalid',
};

export function writeErrorKey(reason: WriteFailure): AdminContentKey | ApiErrorCode {
    return WRITE_ERRORS[reason];
}
