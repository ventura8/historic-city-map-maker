// `trackAreaFunnels` (packages/ui/src/admin/editing/area-funnel.ts): forwards each non-null funnel snapshot to the
// target when a view is present, and does nothing while the view is null.
import { FUNNEL_EVENT, type FunnelSignal, type FunnelSnapshot } from '@hcm/shared/funnels';
import { describe, expect, it } from 'vitest';

import { trackAreaFunnels } from '../../../src/admin/editing/area-funnel.js';
import { recordEvents } from '../../helpers.js';

function snapshot(step: string): FunnelSnapshot {
    return { wizard: 'start', order: [step], step, done: [], errors: {}, complete: false };
}

describe('trackAreaFunnels', () => {
    it('happyPath_tracksEveryNonNullSnapshotOnTheTarget', () => {
        const target = new EventTarget();
        const signals = recordEvents<FunnelSignal>(target, FUNNEL_EVENT);

        trackAreaFunnels(target, { step: 'intro' }, (view) => [snapshot(view.step), null]);

        expect(signals.some((signal) => signal.wizard === 'start' && signal.kind === 'view' && signal.step === 'intro')).toBe(true);
    });

    it('badPath_doesNothingWhenTheViewIsNull', () => {
        const target = new EventTarget();
        const signals = recordEvents<FunnelSignal>(target, FUNNEL_EVENT);
        let called = 0;

        trackAreaFunnels(target, null, () => {
            called += 1;
            return [snapshot('intro')];
        });

        expect(called).toBe(0);
        expect(signals).toEqual([]);
    });
});
