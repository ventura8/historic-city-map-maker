/**
 * Calibrate again on a version's page and Snap my points in the georeferencer (`packages/ui/src/admin/imagery/recalibrate/`,
 * `docs/research/M16-recalibrate.md` §4, §7): what is offered, the two fits on the same checks, the map between the new version and the
 * current one, and Approve of a fit not shown better asked first.
 */
import type { BBox } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryIntentsPort, ImageryViewState, VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import { RECALIBRATE_CHUNK } from '../../../src/admin/imagery/recalibrate/lazy-recalibrate.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import {
    button,
    click,
    defineImagery,
    georefPage,
    georefState,
    georefVersion,
    imageryPage,
    imageryState,
    versionPage,
    versionView,
} from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };
const BETTER: VersionViewPort['recalibration'] = { route: 'auto', before: { rmseM: 17.6, checks: 21 }, after: { rmseM: 14.1, checks: 21 } };
const WORSE: VersionViewPort['recalibration'] = { route: 'manual', before: { rmseM: 12, checks: 5 }, after: { rmseM: 12.4, checks: 5 } };

const BUCHAREST: ImageryViewState['city'] = [
    [25.93, 44.33],
    [26.25, 44.55],
];
/** Where the 1974 archive maps' pairs put them: about 18 km north-west of the city (`docs/LESSONS.md`). */
const OUTSIDE: BBox = [
    [25.89, 44.58],
    [25.95, 44.6],
];

const EMBEDDED: VersionViewPort['georef'] = {
    ...{ method: 'embedded', transform: 'affine', pairs: 0, fitRmseM: null },
    ...{ checkpointRmseM: null, checkpointCount: null, checkpointKind: null },
};

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

async function shown(version: VersionViewPort, current: VersionViewPort | null = null, city: ImageryViewState['city'] = null) {
    const state = imageryState({ detail: VERSION, version: versionPage({ current }, version), city });
    const mounted = await imageryPage(state, { params: ['version', 'job-1966'] }, { recalibrate: Promise.resolve('rg-new') });
    await updated(mounted.element);
    return mounted;
}

describe('<hcm-imagery-page>: calibrate again', () => {
    beforeAll(async () => {
        await defineImagery();
        await RECALIBRATE_CHUNK.load();
    });
    afterEach(cleanup);

    it('happyPath_aWaitingVersionOffersRefineAndRoughPointsAndRefineOpensTheNewVersion @S-A89-HAPPY-REFINE', async () => {
        const { element, area, app } = await shown(versionView());
        const block = deep(element, 'section.recalibrate');

        expect(block.textContent).toContain('beside this one');
        expect(deep(block, 'a').getAttribute('href')).toBe('#/georef/job-1966');
        click(button(element, 'Refine automatically'));
        await updated(element);

        expect(calls(area)).toEqual(['recalibrate']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":["version","rg-new"]}']);
        expect(await axeViolations(block)).toEqual([]);
    });

    it.each([
        ['a join', versionView({ origin: 'join', hasScan: false, georef: null })],
        ['an upload on its own georeference', versionView({ georef: EMBEDDED })],
        ['a failed version', versionView({ state: 'failed' })],
    ])('badPath_%sIsNotOfferedIt @S-A89-BAD-JOIN', async (_case, version) => {
        const { element } = await shown(version);

        expect(deepAll(element, 'section.recalibrate')).toEqual([]);
    });

    it('happyPath_aRecalibrationShowsBothFitsOnTheSameChecksAndSwapsTheMap @S-A89-HAPPY-APPROVE-BETTER', async () => {
        const current = versionView({ id: 'job-current', state: 'published' });
        const { element, area } = await shown(versionView({ recalibration: BETTER, basedOn: 'job-current' }), current);

        expect(deep(element, '[data-verdict="better"]').textContent).toContain(
            'Current fit 17.6 m, new fit 14.1 m, on the same 21 checks.',
        );
        click(button(element, 'Show the current one'));
        click(button(element, 'Approve and publish'));

        expect(calls(area)).toEqual(['toggleCurrent', 'approve']);
    });

    it.each([
        ['worse', WORSE, 'Not better than the current one'],
        ['unmeasured', { route: 'manual' }, 'Not measured on the same checks'],
    ] as const)(
        'badPath_aFitThatIs_%s_isApprovedOnlyByTheOwnersChoice @S-A89-BAD-WORSE-NEEDS-CHOICE',
        async (verdict, recalibration, words) => {
            const { element, area } = await shown(versionView({ recalibration, basedOn: 'job-current' }));

            expect(deep(element, `[data-verdict="${verdict}"]`).textContent).toBeDefined();
            expect(deepText(element)).toContain(words);
            click(button(element, 'Approve and publish'));
            await updated(element);
            click(deep(deep(element, 'hcm-confirm-dialog'), '.confirm'));
            await updated(element);

            expect(calls(area)).toEqual(['approve true']);
        },
    );

    it('happyPath_aVersionInsideTheCityIsApprovedWithOneClick @S-A44-HAPPY-CITY-GUARD', async () => {
        const { element, area } = await shown(versionView(), null, BUCHAREST);

        expect(deepAll(element, '[data-city="outside"]')).toEqual([]);
        click(button(element, 'Approve and publish'));

        expect(calls(area)).toEqual(['approve']);
    });

    it('badPath_aVersionLandingOutsideTheCitySaysSoAndIsApprovedOnlyAfterTheQuestion @S-A44-BAD-OUTSIDE-CITY', async () => {
        const off = versionView();
        const output = off.output === null ? null : { ...off.output, bounds: OUTSIDE };
        const { element, area } = await shown({ ...off, output }, null, BUCHAREST);

        expect(deep(element, '[data-city="outside"]').textContent).toContain('lies mostly outside the city');
        click(button(element, 'Approve and publish'));
        await updated(element);
        expect(calls(area)).toEqual([]);
        expect(deepText(deep(element, 'hcm-confirm-dialog'))).toContain('Approve an image that lies outside the city?');
        click(deep(deep(element, 'hcm-confirm-dialog'), '.confirm'));
        await updated(element);

        expect(calls(area)).toEqual(['approve']);
        expect(await axeViolations(deep(element, 'section[aria-labelledby="approval-title"]'))).toEqual([]);
    });

    it('badPath_aRefusedRefineStaysOnThePageAndTheMapShowsTheCurrentOneUntilSwappedBack @S-A89-BAD-BUSY', async () => {
        const current = versionView({ id: 'job-current', state: 'published' });
        const page = versionPage({ current, showing: 'current' }, versionView({ recalibration: BETTER, basedOn: 'job-current' }));
        const mounted = await imageryPage(
            imageryState({ detail: VERSION, version: page }),
            { params: ['version', 'job-1966'] },
            {
                recalibrate: Promise.resolve(null),
            },
        );
        await updated(mounted.element);

        click(button(mounted.element, 'Show the new one'));
        click(button(mounted.element, 'Refine automatically'));
        await updated(mounted.element);

        expect(calls(mounted.area)).toEqual(['toggleCurrent', 'recalibrate']);
        expect(mounted.app.named('navigate')).toEqual([]);
    });

    /** Delete on a recalibration, then the dialog's words and the call. */
    async function deleted(current: VersionViewPort) {
        const { element, area } = await shown(versionView({ recalibration: BETTER, basedOn: 'job-current' }), current);
        click(button(element, 'Delete'));
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string; body: string; confirmLabel: string };
        const words = [dialog.headline, dialog.body, dialog.confirmLabel];
        click(deep(dialog, '.confirm'));
        await updated(element);
        return { words, calls: calls(area) };
    }

    // The merge of M16 with M18 item 5: the one Delete, and a question that says what goes and what stays.
    it('happyPath_deleteOnARecalibrationOfAPublishedVersionAsksAboutTheNewFitOnly @S-A89-HAPPY-DELETE-NEW-FIT', async () => {
        const { words, calls: made } = await deleted(versionView({ id: 'job-current', state: 'published' }));

        expect(words).toEqual(['Delete this new fit?', 'Only the new fit goes; the published version stays on the map.', 'Delete']);
        expect(made).toEqual(['reject']);
    });

    it('badPath_aRecalibrationOfAWaitingVersionIsDeletedAsAnyImageItsBaseWasReplaced @S-A89-BAD-DELETE-WAITING-BASE', async () => {
        const { words, calls: made } = await deleted(versionView({ id: 'job-current', state: 'cancelled' }));

        expect(words[0]).toBe('Delete this image?');
        expect(words[2]).toBe('Delete');
        expect(made).toEqual(['reject']);
    });

    it('happyPath_theRoughPointsRouteSaysWhatItFoundAroundThem @S-A89-HAPPY-POINTS', async () => {
        const recalibration = { ...BETTER, route: 'points' as const, proposed: 14 };
        const { element } = await shown(versionView({ recalibration, basedOn: 'job-current' }));

        expect(deepText(element)).toContain('14 pairs found around your points');
        expect(deepAll(element, '[data-showing]')).toEqual([]);
    });
});

describe('<hcm-georef-page>: Snap my points', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aPublishedVersionWithNewPointsSnapsThem @S-A89-HAPPY-POINTS', async () => {
        const { element, area } = await georefPage(georefState({ dirty: true, version: georefVersion({ state: 'published' }) }));

        click(button(element, 'Snap my points'));

        expect(area.named('snap')).toEqual(['snap']);
    });

    it('badPath_aVersionWaitingForPointsSavesThemInstead @S-A89-BAD-POINTS-REFUSED', async () => {
        const { element } = await georefPage(georefState({ dirty: true }));

        expect(deepAll(element, 'hcm-button').some((found) => found.textContent.trim() === 'Snap my points')).toBe(false);
    });
});
