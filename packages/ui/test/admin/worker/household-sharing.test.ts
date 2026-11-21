// M20 §22 (2026-11-14): what one computer shares in `<hcm-worker-household>` (`household-sharing.ts`): "Sharing scanned maps with
// N computers" and how far (words and a progress bar), the copy getting ready, today's limit said plainly (what happened, why, what
// goes on meanwhile), in both languages and with no accessibility fault; nothing when it shares nothing.
import { axeViolations } from '@hcm/test-support/axe';
import { translateAdminWorkerHousehold, type AdminWorkerHouseholdKey } from '@hcm/shared/admin-worker-household';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { defineHcmButton } from '../../../src/components/button.js';
import { defineWorkerHousehold } from '../../../src/admin/worker/hcm-worker-household.js';
import type { ComputerViewPort } from '../../../src/admin/worker/worker-port.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepAll, updated } from '../shell/fake-app.js';
import { computer, FakeHousehold } from './fake-household.js';

defineWorkerHousehold();
defineHcmButton();

const MB = 1024 ** 2;

function t(key: AdminWorkerHouseholdKey, params?: Readonly<Record<string, string>>, locale: 'ro' | 'en' = 'en'): string {
    return translateAdminWorkerHousehold(locale, key, params);
}

async function list(sharing: ComputerViewPort['sharing'], locale: 'ro' | 'en' = 'en'): Promise<LitElement> {
    const household = new FakeHousehold();
    household.set({ computers: [computer({ sharing })] });
    const element = await fixture<LitElement>(
        html`<hcm-worker-household .household=${household} locale=${locale} city="bucharest" .level=${3}></hcm-worker-household>`,
    );
    await updated(element);
    return element;
}

function said(element: Element): string {
    return deep(element, '[data-sharing]').textContent.replace(/\s+/g, ' ').trim();
}

describe('<hcm-worker-household>: what a computer shares', () => {
    afterEach(cleanup);

    it('happyPath_aCopyUnderWayShowsForHowManyComputersAndHowFar @S-A143-HAPPY-SHARING', async () => {
        const element = await list({ state: 'sending', computers: 2, sentBytes: 120 * MB, totalBytes: 677 * MB });

        expect(said(element)).toBe(
            `${t('adminWorkerHousehold.sharing.other', { count: '2' })} ${t('adminWorkerHousehold.sharingProgress', { sent: '120', total: '677' })}`,
        );
        const bar = deep(element, 'progress') as HTMLProgressElement;
        expect([bar.value, bar.max]).toEqual([120 * MB, 677 * MB]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_oneComputerAndACopyGettingReadyInRomanian @S-A143-HAPPY-SHARING', async () => {
        const element = await list({ state: 'sending', computers: 1, sentBytes: 0, totalBytes: 0 }, 'ro');

        expect(said(element)).toBe(
            `${t('adminWorkerHousehold.sharing.one', { count: '1' }, 'ro')} ${t('adminWorkerHousehold.sharingStarts', {}, 'ro')}`,
        );
        expect(deepAll(element, 'progress')).toHaveLength(0);
    });

    it('badPath_todaysLimitSaysWhyAndWhatGoesOnMeanwhile @S-A143-BAD-SHARING-DAY-LIMIT', async () => {
        const element = await list({ state: 'dayLimit', computers: 2, sentBytes: 0, totalBytes: 0 });

        expect(said(element)).toBe(
            `${t('adminWorkerHousehold.sharingDayLimit', { limit: '20' })} ${t('adminWorkerHousehold.sharingDayLimit2')} ${t('adminWorkerHousehold.sharingDayLimit3')}`,
        );
        expect(deep(element, '[data-sharing]').getAttribute('role')).toBe('status');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aComputerThatSharesNothingSaysNothing', async () => {
        const element = await list(null);

        expect(deepAll(element, '[data-sharing]')).toHaveLength(0);
    });
});
