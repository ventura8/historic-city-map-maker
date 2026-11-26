/**
 * What the tick's harvest tells Setup (CR-M3-47): a monthly harvest USGS refuses for the credentials marks the USGS card
 * `invalid` (`apiError.usgs.credentials`), one refused because the account lost its M2M access marks it `pending` again
 * (checked every `USGS_RECHECK_HOURS`), so the tick stops logging in with them until the admin fixes it in Setup's USGS
 * step, and the card says why. The admin's own search answers with the error instead (the page links to Setup).
 */
import {
    FIRESTORE_PATHS,
    USGS_RECHECK_HOURS,
    setupStatusDocSchema,
    setupStatusReadSchema,
    timestampFromDate,
    type ApiErrorCode,
    type SetupStatusDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

type UsgsArea = NonNullable<SetupStatusDoc['usgs']>;

const HOUR_MS = 3_600_000;

/** The card each refusal leaves (the rest of the record kept). */
const REFUSALS: Readonly<Partial<Record<ApiErrorCode, (area: UsgsArea, now: Date) => UsgsArea>>> = {
    'apiError.usgs.credentials': (area, now) => ({
        ...area,
        state: 'invalid',
        detail: 'apiError.usgs.credentials',
        checkedAt: timestampFromDate(now),
    }),
    'apiError.usgs.accessPending': (area, now) => ({
        ...area,
        state: 'pending',
        role: 'search',
        detail: 'apiError.usgs.accessPending',
        checkedAt: timestampFromDate(now),
        nextCheckAt: timestampFromDate(new Date(now.getTime() + USGS_RECHECK_HOURS * HOUR_MS)),
    }),
};

/** The card a refusal leaves, or undefined for a failure that says nothing about the account. */
function refusalOf(error: unknown): { readonly code: ApiErrorCode; readonly card: (area: UsgsArea, now: Date) => UsgsArea } | undefined {
    const card = error instanceof ApiError ? REFUSALS[error.code] : undefined;
    return card === undefined ? undefined : { code: (error as ApiError).code, card };
}

/** Marks `setup/status.usgs` after a refused harvest; any other failure leaves it alone. */
export async function noteUsgsRefusal(deps: Pick<Ports, 'documents' | 'log'>, error: unknown, now: Date): Promise<void> {
    const refusal = refusalOf(error);
    if (refusal === undefined) {
        return;
    }
    await deps.documents.transaction(async (transaction) => {
        const status = await transaction.get(FIRESTORE_PATHS.setupStatus, setupStatusReadSchema);
        if (status?.usgs !== undefined) {
            await transaction.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
                ...status,
                usgs: refusal.card(status.usgs, now),
                ...stampOf(IMAGERY_WRITER, now),
            });
        }
    });
    deps.log.warn('usgs refused the monthly harvest', { code: refusal.code });
}
