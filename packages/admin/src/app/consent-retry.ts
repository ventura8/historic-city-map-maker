/**
 * M18 item 2 (`docs/research/M18-improvements.md`): when the browser blocks Google's window, the snackbar says so in plain
 * words and offers one **Try again**. Its click is a real click, so the browser lets the window open from it: the retry asks
 * Google from inside the click handler, with nothing awaited before. A retry that is blocked again offers the same; one that
 * is granted keeps the token and says so, and the step's own button then goes on without another window.
 */
import type { GoogleScope } from '../google/scopes.js';
import type { NoticeInput } from '../state/state.js';
import type { GoogleOutcome } from '../auth/google-service.js';

/** Asks Google for `scope` and shows a refusal (the shell's `google.request` without the notice). */
export type ConsentAsk = (scope: GoogleScope | null) => Promise<GoogleOutcome>;

/** What the snackbar shows of a refusal: a blocked window gets its Try again, which asks once more from its own click. */
function refusalNotice(outcome: GoogleOutcome, scope: GoogleScope | null, ask: ConsentAsk): NoticeInput | null {
    if (outcome.granted) {
        return null;
    }
    if (outcome.failure !== 'popupBlocked') {
        return outcome.notice;
    }
    return {
        ...outcome.notice,
        action: {
            key: 'adminContent.common.retry',
            run: () => {
                void ask(scope);
            },
        },
    };
}

/** The shell's consent with the notices: a refusal in the snackbar (with Try again when blocked), a granted retry said. */
export function consentWithRetry(request: ConsentAsk, notify: (notice: NoticeInput) => void): ConsentAsk {
    const ask = async (scope: GoogleScope | null, retried: boolean): Promise<GoogleOutcome> => {
        const outcome = await request(scope);
        const notice = refusalNotice(outcome, scope, (again) => ask(again, true));
        if (notice !== null) {
            notify(notice);
        } else if (retried) {
            notify({ key: 'adminShell.oauth.retryGranted' });
        }
        return outcome;
    };
    return (scope) => ask(scope, false);
}
