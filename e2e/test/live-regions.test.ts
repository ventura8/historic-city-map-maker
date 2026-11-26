import { afterEach, describe, expect, test } from 'vitest';

import { recordLiveRegions, takeLiveLog } from '../support/live-regions.js';
import { clearStage, h, stage } from './fixtures.js';

/** e2e/support/live-regions.ts: the recorder of live-region changes, shadow roots included. */

/** Lets the MutationObserver deliver what the test just changed. */
function delivered(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve);
    });
}

afterEach(() => {
    clearStage();
    takeLiveLog();
});

describe('recordLiveRegions', () => {
    test('happyPath_aRegionThatWasThereAnnouncesItsNewText', async () => {
        recordLiveRegions();
        const region = h('div', { role: 'status', 'aria-live': 'polite' });
        stage(region);
        await delivered();
        takeLiveLog();
        region.textContent = 'Linkul a fost copiat.';
        await delivered();
        expect(takeLiveLog()).toEqual([{ politeness: 'polite', role: 'status', text: 'Linkul a fost copiat.', fresh: false }]);
        expect(takeLiveLog()).toEqual([]);
    });

    test('badPath_aRegionInsertedWithItsTextIsFresh_andAnAlertIsAssertive', async () => {
        recordLiveRegions();
        stage(h('div', {}, h('p', { role: 'alert' }, 'Eroare'), h('p', { 'aria-live': 'off' }, 'Off')));
        await delivered();
        expect(takeLiveLog()).toEqual([
            { politeness: 'assertive', role: 'alert', text: 'Eroare', fresh: true },
            { politeness: 'off', role: '', text: 'Off', fresh: true },
        ]);
    });

    test('happyPath_regionsInsideShadowRootsAttachedLater', async () => {
        recordLiveRegions();
        const element = h('div');
        stage(element);
        const root = element.attachShadow({ mode: 'open' });
        const region = h('div', { role: 'log' });
        root.append(region);
        await delivered();
        takeLiveLog();
        region.append(h('span', {}, 'Mesaj'));
        await delivered();
        expect(takeLiveLog().map((entry) => [entry.role, entry.text, entry.fresh])).toEqual([['log', 'Mesaj', false]]);
    });

    test('happyPath_aSecondInstallKeepsTheFirst_andAReadWithoutARecorderIsEmpty', () => {
        const scope = window as unknown as { hcmLiveLog?: unknown };
        const before = scope.hcmLiveLog;
        recordLiveRegions();
        expect(scope.hcmLiveLog).toBe(before);
        delete scope.hcmLiveLog;
        expect(takeLiveLog()).toEqual([]);
    });
});
