import { describe, expect, it, vi } from 'vitest';

import { createLogger, type GaParams } from '../../src/index.js';
import { FUNNEL_EVENT, FUNNEL_FLUSH_MS, FunnelHub, type FunnelHubDeps } from '../../src/telemetry/funnels.js';

type Sent = readonly [string, GaParams];

function hub(overrides: Partial<FunnelHubDeps> = {}): { hub: FunnelHub; sent: Sent[]; clock: { now: number }; warnings: string[] } {
    const sent: Sent[] = [];
    const clock = { now: 1000 };
    const warnings: string[] = [];
    const log = createLogger('funnel-test', {
        sink: (entry) => {
            warnings.push(entry.message);
        },
    });
    const created = new FunnelHub({
        send: (name, params) => {
            sent.push([name, params]);
        },
        now: () => clock.now,
        log,
        ...overrides,
    });
    return { hub: created, sent, clock, warnings };
}

describe('FunnelHub', () => {
    it('happyPath_theFunnelEventsLeaveInOrderWithAttemptsAndTimes', () => {
        // @S-A150-HAPPY-FUNNEL-ORDER: the funnel's events, in the order the owner walks the wizard.
        const { hub: funnel, sent, clock } = hub();
        funnel.handle({ kind: 'view', wizard: 'setup', step: 'billing', back: false });
        clock.now = 4000;
        funnel.handle({ kind: 'help', wizard: 'setup', step: 'billing' });
        funnel.handle({ kind: 'error', wizard: 'setup', step: 'billing', code: 'apiError.cloud.billingClosed' });
        clock.now = 9000;
        funnel.handle({ kind: 'complete', wizard: 'setup', step: 'billing' });
        funnel.handle({ kind: 'view', wizard: 'setup', step: 'provision', back: false });
        funnel.handle({ kind: 'view', wizard: 'setup', step: 'billing', back: true });
        funnel.handle({ kind: 'action', wizard: 'setup', step: 'billing', action: 'points_added' });
        clock.now = 12_000;
        funnel.handle({ kind: 'finish', wizard: 'setup' });
        expect(sent).toEqual([]);
        funnel.flush();
        expect(sent).toEqual([
            ['wizard_start', { wizard_id: 'setup' }],
            ['step_view', { wizard_id: 'setup', step_id: 'billing', attempt: 1 }],
            ['step_help_opened', { wizard_id: 'setup', step_id: 'billing' }],
            ['step_error', { wizard_id: 'setup', step_id: 'billing', error_code: 'apiError.cloud.billingClosed', attempt: 1 }],
            ['step_complete', { wizard_id: 'setup', step_id: 'billing', attempt: 1, duration_ms: 8000 }],
            ['step_view', { wizard_id: 'setup', step_id: 'provision', attempt: 1 }],
            ['step_back', { wizard_id: 'setup', step_id: 'provision', attempt: 1 }],
            ['step_view', { wizard_id: 'setup', step_id: 'billing', attempt: 2 }],
            ['step_action', { wizard_id: 'setup', step_id: 'billing', action: 'points_added' }],
            ['wizard_complete', { wizard_id: 'setup', duration_ms: 11_000 }],
        ]);
    });

    it('happyPath_eventsLeaveTogetherAfterTheBatchWait', () => {
        vi.useFakeTimers();
        try {
            const { hub: funnel, sent } = hub();
            funnel.handle({ kind: 'view', wizard: 'new_city', step: 'names', back: false });
            funnel.handle({ kind: 'complete', wizard: 'new_city', step: 'names' });
            expect(sent).toHaveLength(0);
            vi.advanceTimersByTime(FUNNEL_FLUSH_MS);
            expect(sent.map(([name]) => name)).toEqual(['wizard_start', 'step_view', 'step_complete']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('badPath_aWizardLeftUnfinishedIsAbandonedOnceWithItsLastStep', () => {
        const { hub: funnel, sent, clock } = hub();
        funnel.handle({ kind: 'view', wizard: 'upload', step: 'year', back: false });
        funnel.handle({ kind: 'view', wizard: 'worker', step: 'choose', back: false });
        funnel.handle({ kind: 'finish', wizard: 'worker' });
        clock.now = 61_000;
        funnel.abandon();
        funnel.abandon();
        expect(sent.filter(([name]) => name === 'wizard_abandon')).toEqual([
            ['wizard_abandon', { wizard_id: 'upload', step_id: 'year', duration_ms: 60_000 }],
        ]);
        // Back on the page and on through the wizard: it may be abandoned again later.
        funnel.handle({ kind: 'complete', wizard: 'upload', step: 'year' });
        funnel.abandon();
        expect(sent.filter(([name]) => name === 'wizard_abandon')).toHaveLength(2);
    });

    it('badPath_wordsAndOddIdsLeaveAsUnknownNeverAsText', () => {
        // @S-A150-BAD-STEP-ERROR-CODE-NOT-TEXT: the hub never forwards words, a file name or an address.
        const { hub: funnel, sent } = hub();
        funnel.handle({ kind: 'error', wizard: 'upload', step: 'scan 1966.tif', code: 'The file is too large' });
        funnel.handle({ kind: 'action', wizard: 'upload', step: 'choose', action: 'owner@example.org' });
        funnel.flush();
        expect(sent).toEqual([
            ['wizard_start', { wizard_id: 'upload' }],
            ['step_error', { wizard_id: 'upload', step_id: 'unknown', error_code: 'unknown', attempt: 1 }],
            ['step_action', { wizard_id: 'upload', step_id: 'choose', action: 'unknown' }],
        ]);
    });

    it('badPath_aFinishWithoutAStartOrTwiceSendsOneEnd', () => {
        const { hub: funnel, sent } = hub();
        funnel.handle({ kind: 'finish', wizard: 'tiles' });
        funnel.handle({ kind: 'view', wizard: 'tiles', step: 'layout', back: false });
        funnel.handle({ kind: 'finish', wizard: 'tiles' });
        funnel.handle({ kind: 'finish', wizard: 'tiles' });
        // A new run once the last one finished.
        funnel.handle({ kind: 'complete', wizard: 'tiles', step: 'layout' });
        funnel.flush();
        expect(sent.map(([name]) => name)).toEqual(['wizard_start', 'step_view', 'wizard_complete', 'wizard_start', 'step_complete']);
    });

    it('badPath_aFailingSenderNeverThrowsAndLogsOnce', () => {
        const { hub: funnel, warnings } = hub({
            send: () => {
                throw new Error('gtag gone');
            },
        });
        funnel.handle({ kind: 'view', wizard: 'setup', step: 'billing', back: false });
        expect(() => {
            funnel.flush();
        }).not.toThrow();
        expect(warnings).toEqual(['funnel event not sent']);
    });

    it('badPath_aBrokenSignalIsDroppedAndLogged', () => {
        const { hub: funnel, warnings } = hub({
            now: () => {
                throw new Error('no clock');
            },
        });
        expect(() => {
            funnel.handle({ kind: 'view', wizard: 'setup', step: 'billing', back: false });
        }).not.toThrow();
        expect(warnings).toEqual(['funnel signal dropped']);
    });

    it('happyPath_itListensForSignalsAndAbandonsWhenThePageHides', () => {
        const { hub: funnel, sent } = hub();
        const win = Object.assign(new EventTarget(), { document: { visibilityState: 'visible' } });
        const stop = funnel.listen(win);
        win.dispatchEvent(new CustomEvent(FUNNEL_EVENT, { detail: { kind: 'view', wizard: 'georef', step: 'points', back: false } }));
        win.dispatchEvent(new Event('visibilitychange'));
        expect(sent).toEqual([]);
        win.document.visibilityState = 'hidden';
        win.dispatchEvent(new Event('visibilitychange'));
        expect(sent.map(([name]) => name)).toEqual(['wizard_start', 'step_view', 'wizard_abandon']);
        funnel.handle({ kind: 'view', wizard: 'georef', step: 'save', back: false });
        win.dispatchEvent(new Event('pagehide'));
        expect(sent.at(-1)?.[0]).toBe('wizard_abandon');
        stop();
        stop();
        win.dispatchEvent(new CustomEvent(FUNNEL_EVENT, { detail: { kind: 'finish', wizard: 'georef' } }));
        expect(sent.at(-1)?.[0]).toBe('wizard_abandon');
    });
});
