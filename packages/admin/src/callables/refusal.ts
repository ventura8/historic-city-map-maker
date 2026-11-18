/**
 * A failed callable as a notice. A leaf module: the worker, archive and jobs areas need this without the Imagery
 * callables' response schemas (`imagery/api.ts`), which would otherwise land in `editor-shared`.
 */
import { CallableFailure } from '../firebase/ports.js';
import type { NoticeInput } from '../state/state.js';

/** A failed call as a notice (a failure that is no callable's, such as the network, is `apiError.unavailable`). */
export function refusalOf(error: unknown): NoticeInput {
    if (!(error instanceof CallableFailure)) {
        return { key: 'apiError.unavailable' };
    }
    const { code, params } = error.details;
    return params === undefined ? { key: code } : { key: code, params };
}
