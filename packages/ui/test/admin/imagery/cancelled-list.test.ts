/**
 * Work's folded "Cancelled versions" (t130, S-A190-*) and its rows' Remove (t131, S-A191-*): a version its own job stopped
 * is listed apart, closed at first, never among the live ones; Remove warns that it goes for good, then deletes it by id.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { click, defineImagery, imageryPage, imageryState, ready, versionItem } from './fixtures.js';

const SNAPPED = versionItem({ id: 'job-snap', state: 'cancelled', needsYou: false });

function work(cancelled = ready([SNAPPED])) {
    return imageryState({ tab: 'work', versions: ready([versionItem()]), cancelled });
}

describe('<hcm-imagery-page>: Cancelled versions', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aVersionItsJobCancelledIsFoldedApartFromTheLiveOnes @S-A190-HAPPY', async () => {
        const { element } = await imageryPage(work());

        const group = deep(element, '[data-cancelled-versions]') as HTMLDetailsElement;
        expect(group.open).toBe(false);
        expect(deep(element, '#imagery-cancelled').textContent).toBe('Cancelled versions (1)');
        expect(deepText(element)).toContain('too few matching points');
        expect(deep(element, '[data-version="job-snap"]').closest('details')).toBe(group);
        const live = deepAll(element, '[data-version]').filter((row) => row.closest('details') === null);
        expect(live.map((row) => row.dataset['version'])).not.toContain('job-snap');
        group.open = true;
        await updated(element);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_onlyCancelledVersionsStillShowTheGroupNotTheEmptyState @S-A190-HAPPY', async () => {
        const { element } = await imageryPage(imageryState({ tab: 'work', versions: ready([]), cancelled: ready([SNAPPED]) }));

        expect(deepAll(element, '[data-cancelled-versions]')).toHaveLength(1);
        expect(deepText(element)).not.toContain('Nothing in progress');
    });

    it('badPath_noCancelledVersionShowsNoGroup @S-A190-BAD-NONE', async () => {
        const { element } = await imageryPage(work(ready([])));

        expect(deepAll(element, '[data-cancelled-versions]')).toHaveLength(0);
        expect(deepAll(element, '#imagery-cancelled')).toHaveLength(0);
    });

    it('happyPath_removeWarnsThenDeletesTheVersionByItsId @S-A191-HAPPY', async () => {
        const { element, area } = await imageryPage(work(), {}, { removeVersion: Promise.resolve(true) });

        const remove = deep(element, '[data-remove="job-snap"]') as HTMLDetailsElement;
        expect(remove.querySelector('summary')?.textContent.trim()).toBe('Remove');
        expect(remove.textContent).toContain('no undo');
        expect(area.named('removeVersion')).toEqual([]);
        click(deep(element, '[data-remove-confirm]'));
        await updated(element);

        expect(area.named('removeVersion')).toEqual(['removeVersion "job-snap"']);
    });

    it('badPath_aRevokedAdminHasNoRemove @S-A191-BAD-READ-ONLY', async () => {
        const { element } = await imageryPage(work(), { state: { revoked: true } });

        expect(deepAll(element, '[data-cancelled-versions]')).toHaveLength(1);
        expect(deepAll(element, '[data-remove]')).toHaveLength(0);
    });
});
