import { createLogger } from '@hcm/shared';
import { FUNNEL_EVENT } from '@hcm/shared/funnels';
import { describe, expect, it } from 'vitest';

import { isErrorNotice, watchFunnels, type NoticeSource } from '../../src/app/funnels.js';
import type { AdminFieldEvent } from '../../src/app/telemetry.js';

type NoticeState = NoticeSource['state'];

/** A store of the two fields the watch reads. */
function source(): NoticeSource & { set(state: Partial<NoticeState>): void } {
    let state: NoticeState = { notice: null, route: { id: 'setup', params: [] } };
    const listeners = new Set<(state: NoticeState) => void>();
    return {
        get state() {
            return state;
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        set: (changes) => {
            state = { ...state, ...changes };
            for (const listener of listeners) {
                listener(state);
            }
        },
    };
}

const log = createLogger('funnels-test', { sink: () => undefined });

function win(): EventTarget & { document: { visibilityState: string } } {
    return Object.assign(new EventTarget(), { document: { visibilityState: 'visible' } });
}

describe('watchFunnels', () => {
    it('happyPath_aWizardsSignalsReachTelemetryAsFunnelEvents', () => {
        const sent: AdminFieldEvent[] = [];
        const page = win();
        const stop = watchFunnels({ measure: (event) => sent.push(event), win: page, now: () => 0, log }, source());
        page.dispatchEvent(new CustomEvent(FUNNEL_EVENT, { detail: { kind: 'view', wizard: 'new_city', step: 'names', back: false } }));
        stop();
        expect(sent).toEqual([
            { name: 'wizard_start', params: { wizard_id: 'new_city' } },
            { name: 'step_view', params: { wizard_id: 'new_city', step_id: 'names', attempt: 1 } },
        ]);
    });

    it('badPath_anErrorNoticeIsOneUiErrorByItsKeyAndASuccessIsNone', () => {
        // @S-A150-BAD-STEP-ERROR-CODE-NOT-TEXT: the snackbar's error leaves as its key and route, never its words.
        const sent: AdminFieldEvent[] = [];
        const store = source();
        const stop = watchFunnels({ measure: (event) => sent.push(event), win: null, now: () => 0, log }, store);
        store.set({ notice: { id: 1, key: 'apiError.imagery.noSpread' }, route: { id: 'imagery', params: [] } });
        store.set({ route: { id: 'imagery', params: ['x'] } });
        store.set({ notice: { id: 2, key: 'adminContent.photos.saved' } });
        store.set({ notice: null });
        stop();
        store.set({ notice: { id: 3, key: 'apiError.internal' } });
        expect(sent).toEqual([{ name: 'ui_error', params: { code: 'apiError.imagery.noSpread', route: 'imagery' } }]);
    });

    it('badPath_aFailingTelemetryOnlyLogs', () => {
        const store = source();
        const warnings: string[] = [];
        const stop = watchFunnels(
            {
                measure: () => {
                    throw new Error('gone');
                },
                win: null,
                now: () => 0,
                log: createLogger('funnels-test', { sink: (record) => warnings.push(record.message) }),
            },
            store,
        );
        expect(() => {
            store.set({ notice: { id: 1, key: 'adminShell.session.expired' } });
        }).not.toThrow();
        stop();
        expect(warnings).toEqual(['analytics event not measured']);
    });
});

describe('isErrorNotice', () => {
    it('happyPath_failuresAreErrorsAndSuccessesAreNot', () => {
        expect(['apiError.conflict', 'adminContent.pois.exportFailed', 'adminShell.oauth.popupClosed'].map(isErrorNotice)).toEqual([
            true,
            true,
            true,
        ]);
        expect(['adminContent.pois.saved', 'adminSetup.import.open'].map(isErrorNotice)).toEqual([false, false]);
    });
});
