// Cleanup item 6 (2026-11-14): one computer's disk in `<hcm-worker-household>` (`household-disk.ts`): what the worker uses and the
// free space of its disk, the plain warning when it is below the worker's floor (what happened, why, the fix), Free space now and
// what it freed; nothing for a worker that never said its disk, or for a computer being removed.
import { axeViolations } from '@hcm/test-support/axe';
import { translateAdminWorkerHousehold, type AdminWorkerHouseholdKey } from '@hcm/shared/admin-worker-household';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { formatWhen } from '../../../src/admin/editing/states.js';
import { defineHcmButton } from '../../../src/components/button.js';
import { defineWorkerHousehold } from '../../../src/admin/worker/hcm-worker-household.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { computer, FakeHousehold } from './fake-household.js';

defineWorkerHousehold();
defineHcmButton();

const GB = 1024 ** 3;
const FREED_AT = '2026-11-14T08:00:00.000Z';

function t(key: AdminWorkerHouseholdKey, params?: Readonly<Record<string, string>>, locale: 'ro' | 'en' = 'en'): string {
    return translateAdminWorkerHousehold(locale, key, params);
}

async function list(household: FakeHousehold, locale: 'ro' | 'en' = 'en'): Promise<LitElement> {
    const element = await fixture<LitElement>(
        html`<hcm-worker-household .household=${household} locale=${locale} city="bucharest" .level=${3}></hcm-worker-household>`,
    );
    await updated(element);
    return element;
}

function freeSpace(element: Element, locale: 'ro' | 'en' = 'en'): HTMLButtonElement {
    const found = deepAll(element, 'hcm-button').find(
        (candidate) => candidate.textContent.trim() === t('adminWorkerHousehold.freeSpace', {}, locale),
    );
    if (found === undefined) {
        throw new Error('no Free space now');
    }
    return deep(found, 'button') as HTMLButtonElement;
}

function oneComputer(changes: Parameters<typeof computer>[0]): FakeHousehold {
    const household = new FakeHousehold();
    household.set({ computers: [computer(changes)] });
    return household;
}

describe('<hcm-worker-household>: the disk', () => {
    afterEach(cleanup);

    it('happyPath_theDiskLineAndFreeSpaceNowAskTheComputer @S-A62-HAPPY-FREE-SPACE', async () => {
        const household = oneComputer({ disk: { workBytes: 12.3 * GB, freeBytes: 41 * GB, floorBytes: 10 * GB } });
        const element = await list(household);

        expect(deep(element, '[data-disk]').textContent).toBe(t('adminWorkerHousehold.disk', { used: '12.3', free: '41.0' }));
        expect(deepAll(element, '[data-low-disk]')).toHaveLength(0);
        freeSpace(element).click();
        expect(household.calls).toEqual(['freeSpace w-0123456789abcdef']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_whileAskedItWaits_thenSaysWhatItFreed @S-A62-HAPPY-FREE-SPACE', async () => {
        const household = oneComputer({ freeing: true });
        const element = await list(household, 'ro');

        expect(deep(element, '[data-freed]').textContent.trim()).toBe(t('adminWorkerHousehold.freeing', {}, 'ro'));
        expect(freeSpace(element, 'ro').disabled).toBe(true);

        household.set({ computers: [computer({ freed: { bytes: 3.2 * GB, at: FREED_AT } })] });
        await updated(element);
        const when = formatWhen('ro', FREED_AT);
        expect(deep(element, '[data-freed]').textContent.trim()).toBe(t('adminWorkerHousehold.freed', { size: '3,2', when }, 'ro'));
        expect(freeSpace(element, 'ro').disabled).toBe(false);

        household.set({ computers: [computer({ freed: { bytes: 0, at: FREED_AT } })] });
        await updated(element);
        expect(deep(element, '[data-freed]').textContent.trim()).toBe(t('adminWorkerHousehold.freedNothing', { when }, 'ro'));
    });

    it('badPath_aDiskBelowItsFloorSaysWhatHappenedWhyAndTheFix @S-A62-BAD-LOW-DISK', async () => {
        const household = oneComputer({ disk: { workBytes: 80 * GB, freeBytes: 4 * GB, floorBytes: 10 * GB } });
        const element = await list(household);

        const warning = deep(element, '[data-low-disk]');
        expect(warning.getAttribute('role')).toBe('alert');
        expect(warning.textContent).toContain(t('adminWorkerHousehold.lowDisk', { free: '4.0' }));
        expect(warning.textContent).toContain(t('adminWorkerHousehold.lowDisk2', { floor: '10.0' }));
        expect(warning.textContent).toContain(t('adminWorkerHousehold.lowDisk3'));
        expect(freeSpace(element).disabled).toBe(false);
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        ['a worker that never said its disk', { disk: null }],
        ['a computer being removed', { removal: { step: 'asked' as const, docker: false, keep: false } }],
        ['a disconnected computer', { revoked: true }],
    ])('badPath_%sHasNoDiskLineNorButton @S-A62-BAD-FREE-SPACE', async (_name, changes) => {
        const element = await list(oneComputer(changes));

        expect(deepAll(element, '[data-disk]')).toHaveLength(0);
        expect(deepText(element)).not.toContain(t('adminWorkerHousehold.freeSpace'));
    });

    it('badPath_anotherActionUnderWayDisablesFreeSpaceNow', async () => {
        const household = oneComputer({});
        household.set({ acting: 'w-fedcba9876543210' });
        const element = await list(household);

        expect(freeSpace(element).disabled).toBe(true);
    });
});
