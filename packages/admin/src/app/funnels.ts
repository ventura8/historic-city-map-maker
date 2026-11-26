/**
 * The admin's wizard funnels and shown errors in analytics (the owner's request of 2026-11-13, beta.1; `docs/ARCHITECTURE.md`
 * → *Wizard funnels*, `docs/research/DECISIONS-for-review.md` §200):
 *
 * - a `FunnelHub` of `@hcm/shared` listens on the page for the `hcm-funnel` signals every wizard's page dispatches (the
 *   Setup Assistant, New city, the tile wizard, the georeferencer, the imports, Run on my computer) and hands its events to
 *   telemetry, which sends them only after the admin's consent (held in memory until the admin answers, forgotten after a
 *   refusal);
 * - every error notice the admin is shown (the snackbar's, a refusal's) is one `ui_error` event with its catalogue key or
 *   code and the page's route, never its words.
 *
 * Nothing here can throw into the app: the hub catches its own failures, and a failing measurement only logs.
 */
import type { Logger } from '@hcm/shared';
import { FunnelHub, type FunnelWindow } from '@hcm/shared/funnels';

import type { AdminState } from '../state/state.js';
import type { Measure } from './telemetry.js';

/** What the watch reads of the app's state: the notice shown and the page's route. */
type NoticeState = Pick<AdminState, 'notice' | 'route'>;

/** The app's store as the watch follows it. */
export interface NoticeSource {
    readonly state: NoticeState;
    subscribe(listener: (state: NoticeState) => void): () => void;
}

/** The words in a notice's key that tell of a failure (an error code, a refusal, a lost session), not of a success. */
const FAILURE_WORDS = ['failed', 'error', 'denied', 'blocked', 'expired', 'invalid', 'unavailable', 'refused', 'permission'];
const FAILURE_KEYS = ['popupClosed', 'notMember', 'orgPolicy', 'Stopped', 'Partial'];

/** True when a notice's key tells of a failure. */
export function isErrorNotice(key: string): boolean {
    const lower = key.toLowerCase();
    return (
        key.startsWith('apiError.') || FAILURE_WORDS.some((word) => lower.includes(word)) || FAILURE_KEYS.some((part) => key.includes(part))
    );
}

interface FunnelWatchDeps {
    readonly measure: Measure;
    /** The page's window (null: no funnels, as in a test without one). */
    readonly win: FunnelWindow | null;
    readonly now: () => number;
    readonly log: Logger;
}

/** One `ui_error` per error notice shown (a new notice id). */
function watchNotices(store: NoticeSource, measure: Measure): () => void {
    let last: number | null = store.state.notice?.id ?? null;
    return store.subscribe((state) => {
        const notice = state.notice;
        if (notice === null || notice.id === last) {
            return;
        }
        last = notice.id;
        if (isErrorNotice(notice.key)) {
            measure({ name: 'ui_error', params: { code: notice.key, route: state.route.id } });
        }
    });
}

/** Starts the funnels' hub and the notices' watch; the result stops both (and hands over what waits). */
export function watchFunnels(deps: FunnelWatchDeps, store: NoticeSource): () => void {
    const measure: Measure = (event) => {
        try {
            deps.measure(event);
        } catch (error) {
            deps.log.warn('analytics event not measured', { name: event.name, error: String(error) });
        }
    };
    const hub = new FunnelHub({
        send: (name, params) => {
            measure({ name, params });
        },
        now: deps.now,
        log: deps.log,
    });
    const stopHub =
        deps.win === null
            ? () => {
                  hub.flush();
              }
            : hub.listen(deps.win);
    const stopNotices = watchNotices(store, measure);
    return () => {
        stopNotices();
        stopHub();
    };
}
