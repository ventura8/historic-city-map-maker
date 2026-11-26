import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { cleanup, deep, deepAll, deepText } from '../shell/fake-app.js';
import type { ImageryIntentsPort, ImageryViewState } from '../../../src/admin/imagery/imagery-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { button, click, defineImagery, imageryPage, imageryState, versionItem, versionPage, versionView } from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };
const SETTINGS = { autoPublish: true, rmseThresholdM: 15, targetYears: [1966], publishThroughMapbox: false };
const TILES = { path: 'rasters/x/tiles.pmtiles', bytes: 175_000_000 };

function own(view: Partial<ImageryViewState> = {}, version = versionView()): ImageryViewState {
    const output = version.output === null ? null : { ...version.output, tiles: TILES, coveragePct: 78.4 };
    return imageryState({
        detail: VERSION,
        settings: SETTINGS,
        version: versionPage({}, { ...version, output }),
        image: { status: 'ready' },
        ...view,
    });
}

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

describe('<hcm-imagery-page>: what the owner approves', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_itsCostInTheOwnersWordsNoComputeUnitsNoChoices @S-A73-HAPPY-OWN-COST', async () => {
        const { element } = await imageryPage(own());

        const cost = deep(element, '[data-own-cost]').textContent;
        expect(cost).toContain('Publishing moves its 175 MB of tiles into your public bucket.');
        expect(cost).toContain('Mapbox charges nothing for this layer.');
        expect(cost).toContain('about 0.4 cents a month');
        expect(cost).toContain("Visitors' traffic counts toward Google's free allowance, then Google bills it.");
        expect(cost).toContain('the alarm only pauses processing');
        expect(deepAll(element, '[data-estimate]')).toHaveLength(0);
        expect(deepText(element)).not.toContain('compute units');
    });

    it('badPath_anOldGuardDoesNotAskAnythingOfACityOnItsOwnBucket @S-A73-BAD-OLD-GUARD', async () => {
        const guard = { verdict: 'over' as const, available: 0, overageUsd: 4, choice: null, deferUntil: null };
        const { element } = await imageryPage(own({}, versionView({ state: 'approved', guard })));

        expect(deepAll(element, '[data-state="over-budget"]')).toHaveLength(0);
        expect(deepAll(element, '#approval-title')).toHaveLength(0);
    });

    it('badPath_aCityOnMapboxStillSeesItsComputeUnits @S-A73-BAD-CITY-ON-MAPBOX', async () => {
        const { element } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, versionView()) }));

        expect(deep(element, '[data-estimate]').textContent).toContain('Mapbox compute units');
        expect(deepAll(element, '[data-own-cost]')).toHaveLength(0);
    });

    it('badPath_aMapboxCardWithNoEstimateOrFileSaysZero', async () => {
        const unknown = { estimate: null, output: null };
        const tooLarge = { verdict: 'too-large' as const, available: 3, overageUsd: null, choice: null, deferUntil: null };
        const cityOver = { ...tooLarge, verdict: 'city-over' as const };
        const first = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, versionView(unknown)) }));
        const large = deepText(first.element);
        cleanup();
        const second = await imageryPage(
            imageryState({ detail: VERSION, version: versionPage({}, versionView({ ...unknown, state: 'approved', guard: tooLarge })) }),
        );
        const refused = deepText(second.element);
        cleanup();
        const third = await imageryPage(
            imageryState({ detail: VERSION, version: versionPage({}, versionView({ ...unknown, state: 'approved', guard: cityOver })) }),
        );

        expect(large).toContain('about 0 Mapbox compute units');
        expect(refused).toContain('Mapbox refused the 0 MB file');
        expect(deepAll(third.element, '[data-state="city-over"]')).toHaveLength(1);
    });

    it('happyPath_aVersionWithNoCogPublishesOwnWhateverTheCityChose @S-A73-BAD-CITY-ON-MAPBOX', async () => {
        const version = versionView();
        const output = version.output === null ? null : { ...version.output, cogBytes: 0, tiles: TILES };
        const { element } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, { ...version, output }) }));

        expect(deepAll(element, '[data-own-cost]')).toHaveLength(1);
    });

    it('badPath_noTilesYetNamesNoSize', async () => {
        const version = versionView();
        const output = version.output === null ? null : { ...version.output, tiles: null };
        const { element } = await imageryPage(
            imageryState({
                detail: VERSION,
                settings: SETTINGS,
                image: { status: 'small' },
                version: versionPage({}, { ...version, output }),
            }),
        );

        expect(deepAll(element, '[data-own-cost]')).toHaveLength(0);
        expect(deep(element, '[data-image="small"]').textContent).toContain('a small version shows until then');
    });

    it('happyPath_theShareOfTheCityActualPixelsAndSeeTheImage @S-A74-HAPPY-COVERAGE', async () => {
        const { element, area } = await imageryPage(own());
        const map = deep(element, 'hcm-admin-map');
        const scroll = vi.spyOn(map, 'scrollIntoView');

        expect(deep(element, '[data-coverage]').textContent).toContain('78.4 % of the city; the shaded part is what it misses.');
        click(button(element, 'See the image'));

        expect(scroll).toHaveBeenCalledOnce();
        expect(calls(area)).toEqual([]);
    });

    it('happyPath_actualPixelsBringsTheMapIntoViewAsItZooms @S-A74-HAPPY-ACTUAL-PIXELS', async () => {
        const { element, area } = await imageryPage(own());
        const map = deep(element, 'hcm-admin-map');
        const scroll = vi.spyOn(map, 'scrollIntoView');

        click(button(element, 'Actual pixels'));

        expect(calls(area)).toEqual(['actualPixels']);
        expect(scroll).toHaveBeenCalledOnce();
    });

    it('badPath_aCoverageNotMeasuredSaysNothingAndNoActualPixelsWhileLoading', async () => {
        const version = versionView();
        const { element } = await imageryPage(
            imageryState({ detail: VERSION, settings: SETTINGS, image: { status: 'loading' }, version: versionPage({}, version) }),
        );

        expect(deepAll(element, '[data-coverage]')).toHaveLength(0);
        expect(deep(element, '[data-image="loading"]').textContent).toContain('full detail');
        expect(deepText(element)).not.toContain('Actual pixels');
    });

    it('badPath_afailureSaysWhyWithTryAgain @S-A74-BAD-TILE-FAILS', async () => {
        const { element, area } = await imageryPage(
            own({ image: { status: 'failed', notice: { key: 'adminContent.imagery.view.tilesFailed' } } }),
        );

        expect(deep(element, '[data-image="failed"]').textContent).toContain('could not be read');
        click(button(element, 'Try again'));

        expect(calls(area)).toEqual(['retryImage']);
    });

    it('happyPath_noAccessibilityViolations', async () => {
        const { element } = await imageryPage(own());

        await expect(axeViolations(element)).resolves.toEqual([]);
    });
});

describe('<hcm-imagery-page>: why only a small picture', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('badPath_aSmallPictureSaysWhetherItsDetailIsComingNeverComingOrGone @S-A74-BAD-NEVER-COMING', async () => {
        const version = versionView();
        const output = version.output === null ? null : { ...version.output, tiles: null };
        const noteOf = async (state: string, throughMapbox: boolean): Promise<string> => {
            cleanup();
            const settings = { ...SETTINGS, publishThroughMapbox: throughMapbox };
            const page = versionPage({}, { ...version, state: state as never, output });
            const { element } = await imageryPage(imageryState({ detail: VERSION, settings, image: { status: 'small' }, version: page }));
            return deep(element, '[data-image="small"]').textContent;
        };

        expect(await noteOf('awaiting_approval', false)).toBe('The full-resolution image is on its way; a small version shows until then.');
        expect(await noteOf('published', false)).toContain('No full detail will be made');
        expect(await noteOf('superseded', false)).toContain('No full detail will be made');
        expect(await noteOf('approved', true)).toContain('No full detail will be made');
        expect(await noteOf('rejected', false)).toContain('went when it was deleted');
    });

    it('badPath_tilesGoneForGoodSayWhyWithNoTryAgain @S-A74-BAD-REFUSED', async () => {
        const { element } = await imageryPage(own({ image: { status: 'failed', notice: { key: 'apiError.imagery.tilesGone' } } }));

        expect(deep(element, '[data-image="failed"]').textContent).toContain('not made again');
        expect(deepText(element)).not.toContain('Try again');
    });
});

describe("<hcm-imagery-page>: Work's small pictures", () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aWaitingRowShowsItsPicture @S-A75-HAPPY-THUMBS', async () => {
        const url = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
        const { element } = await imageryPage(
            imageryState({
                tab: 'work',
                versions: { status: 'ready', items: [versionItem()], reconnecting: false, hasMore: false, failure: null } as never,
                thumbs: { 'job-1966': url },
            }),
        );

        expect(deep(element, 'li[data-version="job-1966"] img.thumb').getAttribute('src')).toBe(url);
    });

    it('badPath_aRowWithNoPictureKeepsItsTextAndAnIcon @S-A75-BAD-NO-THUMB', async () => {
        const { element } = await imageryPage(imageryState({ tab: 'work' }));

        expect(deep(element, 'li[data-version="job-1966"] .thumb hcm-icon').getAttribute('name')).toBe('satellite_alt');
        expect(deep(element, 'li[data-version="job-1966"] .row-title').textContent).toContain('1966');
    });
});
