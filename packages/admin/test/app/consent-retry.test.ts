// M18 item 2 (docs/research/M18-improvements.md): a blocked Google window is said plainly, with one Try again whose own
// click asks Google again; a granted retry says so, a second block offers Try again once more.
import { describe, expect, it, vi } from 'vitest';

import { consentWithRetry } from '../../src/app/consent-retry.js';
import type { GoogleOutcome } from '../../src/auth/google-service.js';
import type { NoticeInput } from '../../src/state/state.js';

const BLOCKED: GoogleOutcome = { granted: false, failure: 'popupBlocked', notice: { key: 'adminShell.oauth.popupBlocked' } };
const CLOSED: GoogleOutcome = { granted: false, failure: 'popupClosed', notice: { key: 'adminShell.oauth.popupClosed' } };
const GRANTED: GoogleOutcome = { granted: true, access: { token: 't', scope: 'cloudPlatform', expiresAt: 1 } as never };

function world(...answers: GoogleOutcome[]) {
    const request = vi.fn(() => Promise.resolve(answers.shift() ?? GRANTED));
    const notices: NoticeInput[] = [];
    const ask = consentWithRetry(request, (notice) => {
        notices.push(notice);
    });
    return { request, notices, ask };
}

describe('consentWithRetry', () => {
    it('happyPath_aBlockedWindowOffersTryAgain_whoseClickAsksGoogleAtOnceAndSaysItWasGranted', async () => {
        const w = world(BLOCKED, GRANTED);
        expect(await w.ask('cloudPlatform')).toBe(BLOCKED);
        expect(w.notices[0]).toMatchObject({ key: 'adminShell.oauth.popupBlocked', action: { key: 'adminContent.common.retry' } });

        w.notices[0]?.action?.run();
        // Inside the click: Google is asked before anything is awaited, as the browser requires for its window.
        expect(w.request).toHaveBeenCalledTimes(2);
        expect(w.request).toHaveBeenLastCalledWith('cloudPlatform');
        await vi.waitFor(() => {
            expect(w.notices.at(-1)).toEqual({ key: 'adminShell.oauth.retryGranted' });
        });
    });

    it('badPath_aRetryBlockedAgainOffersTryAgainOnceMore', async () => {
        const w = world(BLOCKED, BLOCKED);
        await w.ask(null);
        w.notices[0]?.action?.run();
        await vi.waitFor(() => {
            expect(w.notices).toHaveLength(2);
        });
        expect(w.notices[1]?.action?.key).toBe('adminContent.common.retry');
    });

    it('badPath_anotherRefusalIsSaidWithoutTryAgain_andAFirstGrantSaysNothing', async () => {
        const w = world(CLOSED, GRANTED);
        await w.ask(null);
        expect(w.notices).toEqual([{ key: 'adminShell.oauth.popupClosed' }]);
        expect(await w.ask(null)).toBe(GRANTED);
        expect(w.notices).toHaveLength(1);
    });
});
