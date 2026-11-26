/**
 * M8 (`docs/research/M8-join-interfaces.md` §6; behaviours A65, A66): Find's whole-city dates, the offer to join a frame, a
 * join's frames and its report on the approval card, a frame a live join holds, and the chunk these come in. Every
 * string is the admin's own, in English here (the fixtures' locale).
 */
import type { DatePlanRow, JoinPart, JoinReport } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryContext } from '../../../src/admin/imagery/context.js';
import type { ImageryIntentsPort, ImageryViewState, VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import { JOIN_CARD_CHUNK, lazyJoin, type JoinCardChunk } from '../../../src/admin/imagery/join/lazy-card.js';
import { frameName, liveJoin, liveJoinOver, versionMark } from '../../../src/admin/imagery/join/live-join.js';
import { chunkLoader } from '../../../src/admin/imagery/orders/lazy-card.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import {
    button,
    click,
    defineImagery,
    imageryPage,
    imageryState,
    nth,
    jobView,
    ready,
    scene,
    versionItem,
    versionPage,
    versionView,
} from './fixtures.js';

const F039 = 'D3C1202-200149F039';
const F040 = 'D3C1202-200149F040';
const A039 = 'D3C1202-200149A039';

const ROW: DatePlanRow = {
    date: '1972-08-08',
    sensor: 'KH-9-pan',
    frames: [
        { entityId: F039, free: true, versionId: 'job-f039', state: 'awaiting_approval' },
        { entityId: F040, free: true },
    ],
    paidFrames: [],
    coveragePct: 96,
    framesToDownload: 1,
    winter: false,
};

const part = (entityId: string, versionId: string): JoinPart => ({
    versionId,
    layerId: `layer-${versionId}`,
    entityId,
    dataset: 'declassiii',
    sensor: 'KH-9-pan',
    acquisitionDate: '1972-08-08',
});

const REPORT: JoinReport = {
    seams: [
        { a: F039, b: F040, measured: true, applied: true, samples: 24, heldOut: 4, beforeRmseM: 61.2, afterRmseM: 8.4, maxShiftM: 40 },
    ],
    omitted: [],
    coveragePct: 93,
    checkpointRmseM: 51.6,
    checkpointCount: 5,
    maxShiftM: 42.5,
};

const JOIN_VIEW = {
    origin: 'join' as const,
    id: 'job-join',
    date: '1972-08-08',
    sensor: 'KH-9-pan' as const,
    georef: null,
    hasScan: false,
    entityId: null,
    parts: [part(F039, 'job-f039'), part(F040, 'job-f040')],
    join: REPORT,
};

function joinPage(
    version = versionView(JOIN_VIEW),
    job = jobView({ type: 'layer-join' }),
    overrides: Partial<ImageryViewState> = {},
): ImageryViewState {
    return imageryState({
        detail: { kind: 'version', id: 'job-join' },
        version: versionPage({ id: 'job-join' }, version, job),
        ...overrides,
    });
}

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

beforeAll(defineImagery);
afterEach(cleanup);

describe("Find's whole-city dates", () => {
    it('happyPath_aRowSaysItsFiguresAndOneClickJoinsAndOpensTheJoin', async () => {
        const { element, area, app } = await imageryPage(
            imageryState({
                dates: [ROW],
                settings: { autoPublish: true, rmseThresholdM: 15, targetYears: [1972], publishThroughMapbox: true },
            }),
        );
        const row = deep(element, '[data-join-dates] [data-date="1972-08-08"]');

        expect(deep(element, '[data-join-dates] h3').textContent).toBe('Whole-city dates');
        expect(row.textContent).toContain('2 frames, about 96 % of the city');
        expect(row.textContent).toContain('1 to download');
        expect(row.textContent).not.toContain('Winter');
        expect(row.textContent).not.toContain('Add 1972');
        expect(row.textContent).toContain('KH-9');
        click(button(row, 'Join frames'));
        await updated(element);
        await updated(element);

        expect(calls(area)).toEqual([`joinFrames ${JSON.stringify([F039, F040])}`]);
        expect(app.named('navigate').at(-1)).toContain('job-join');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aWinterDateAndAnUntargetedYearSaySoAndAddSavesTheYear', async () => {
        const winter = { ...ROW, date: '1972-02-02', winter: true };
        const { element, area } = await imageryPage(imageryState({ dates: [winter] }));
        const row = deep(element, '[data-date="1972-02-02"]');

        expect(deep(row, '[data-state="join-winter"]').textContent).toBe('Winter: may need points');
        click(button(row, 'Add 1972 to target years'));

        expect(calls(area)).toEqual(['addTargetYear 1972']);
    });

    it('happyPath_aDateWithAPublishedFrameSaysAJoinReplacesItsLayer_noneSaysNothing @S-A65-HAPPY-PUBLISHED-FRAMES', async () => {
        const published = {
            ...ROW,
            frames: [
                { entityId: F039, free: true, state: 'published' as const },
                { entityId: F040, free: true },
            ],
        };
        const { element } = await imageryPage(imageryState({ dates: [published, { ...ROW, date: '1972-02-02' }] }));
        const without = await imageryPage(imageryState({ dates: [ROW] }));
        expect(deepAll(without.element, '[data-join-replaces]')).toEqual([]);

        expect(deep(element, '[data-join-replaces]').textContent).toContain('not deleted');
    });

    it('badPath_noPlanIsNoSectionAndNoFetch', async () => {
        const { element } = await imageryPage(imageryState());

        expect(deepAll(element, '[data-join-dates]')).toEqual([]);
        expect(deepText(element)).not.toContain('Whole-city dates');
    });

    it('badPath_aRowWithOneFrameToGetNamesTheOrderInsteadOfJoining', async () => {
        const paid = { ...ROW, frames: [{ entityId: F039, free: true }], paidFrames: ['DS2', 'DS3'], framesToDownload: 0 };
        const { element } = await imageryPage(imageryState({ dates: [paid] }));
        const row = deep(element, '[data-date="1972-08-08"]');

        // The figure is the frame that can be had: the two to order would add to it.
        expect(row.textContent).toContain('1 frame, about 96 %');
        expect(deep(row, '[data-state="join-paid"]').textContent).toBe('2 more would need ordering');
        expect(deepAll(row, 'hcm-button').map((target) => target.textContent.trim())).toEqual(['Add 1972 to target years']);
    });

    it('badPath_aFullListOfYearsOffersNoMoreAndARefusedJoinStaysOnItsRow', async () => {
        const years = Array.from({ length: 20 }, (_year, index) => 1950 + index);
        const refused = {
            dates: [ROW],
            settings: { autoPublish: true, rmseThresholdM: 15, targetYears: years, publishThroughMapbox: true },
            joinRefusal: { id: F039, notice: { key: 'apiError.imagery.joinMixedFrames' as const } },
        };
        const { element, app } = await imageryPage(imageryState(refused), {}, { joinFrames: Promise.resolve(null) });
        const row = deep(element, '[data-date="1972-08-08"]');

        expect(deep(row, '[data-state="join-refused"]').textContent).toContain('Only frames of one date and one camera can be joined.');
        expect(row.textContent).not.toContain('Add 1972');
        click(button(row, 'Join frames'));
        await updated(element);

        expect(app.named('navigate')).toEqual([]);
    });

    it('badPath_whileOneJoinRunsAndOnARevokedPageNothingJoins', async () => {
        const { element, area } = await imageryPage(imageryState({ dates: [ROW], joining: F039, addingYear: 1972 }));
        const row = deep(element, '[data-date="1972-08-08"]');
        const buttons = deepAll(row, 'hcm-button') as (HTMLElement & { disabled: boolean })[];

        expect(buttons.map((target) => target.disabled)).toEqual([true, true]);
        area.set({ joining: null, addingYear: null, search: { ...imageryState().search, phase: 'searching' } });
        await updated(element);
        expect((button(row, 'Add 1972 to target years') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('happyPath_aDateWhoseFramesALiveJoinHoldsLeadsToIt', async () => {
        const items = [
            versionItem({ id: 'job-f039', partOf: 'job-join' }),
            versionItem({ id: 'job-f040', partOf: 'job-join' }),
            versionItem({ id: 'job-join', origin: 'join', state: 'processing', needsYou: false, entityIds: [F039, F040] }),
        ];
        const held = { ...ROW, frames: [ROW.frames[0], { entityId: F040, free: true, versionId: 'job-f040' }] } as DatePlanRow;
        const { element } = await imageryPage(imageryState({ dates: [held], versions: ready(items) }));
        const row = deep(element, '[data-date="1972-08-08"]');

        expect(deep(row, '[data-state="join-holds"] a').getAttribute('href')).toBe('#/imagery/version/job-join');
        expect(deepAll(row, 'hcm-button').map((target) => target.textContent.trim())).not.toContain('Join frames');
    });

    it('badPath_aFailedJoinFreesItsFramesAndAJoinedDateHasNoButton', async () => {
        const items = [
            versionItem({ id: 'job-f039', partOf: 'job-join' }),
            versionItem({ id: 'job-f040', partOf: 'job-join' }),
            versionItem({ id: 'job-join', origin: 'join', state: 'failed', entityIds: [F039, F040] }),
        ];
        const failed = { ...ROW, frames: [ROW.frames[0], { entityId: F040, free: true, versionId: 'job-f040' }] } as DatePlanRow;
        const joined = {
            ...ROW,
            date: '1976-02-20',
            frames: [
                { entityId: F039, free: true, state: 'joined' as const },
                { entityId: F040, free: true, state: 'joined' as const },
            ],
        };
        const { element } = await imageryPage(imageryState({ dates: [failed, joined], versions: ready(items) }));

        button(deep(element, '[data-date="1972-08-08"]'), 'Join frames');
        expect(deepAll(deep(element, '[data-date="1976-02-20"]'), 'hcm-button').map((target) => target.textContent.trim())).not.toContain(
            'Join frames',
        );
    });
});

describe('a date row, more', () => {
    it('badPath_oneFrameToOrderIsSaidInTheSingular', async () => {
        const paid = {
            ...ROW,
            frames: [
                { entityId: F039, free: true },
                { entityId: F040, free: true },
            ],
            paidFrames: ['DS2'],
        };
        const { element } = await imageryPage(imageryState({ dates: [paid] }));
        const row = deep(element, '[data-date="1972-08-08"]');

        expect(row.textContent).toContain('2 frames, about 96 %');
        expect(deep(row, '[data-state="join-paid"]').textContent).toBe('1 more would need ordering');
    });

    it('happyPath_aFramePublishedOutOfTheListOrNotImportedStillLeadsToTheLiveJoin_noClickRejectsIt', async () => {
        // F039 is published, so not in the unfinished list; F040 has no version on the plan's row yet.
        const items = [versionItem({ id: 'job-join', origin: 'join', state: 'awaiting_approval', entityIds: [F039, F040] })];
        const { element } = await imageryPage(imageryState({ dates: [ROW], versions: ready(items) }));
        const row = deep(element, '[data-date="1972-08-08"]');

        expect(deep(row, '[data-state="join-holds"] a').getAttribute('href')).toBe('#/imagery/version/job-join');
        expect(deepAll(row, 'hcm-button').map((target) => target.textContent.trim())).not.toContain('Join frames');
    });
});

describe('the offer to join a frame', () => {
    const frame = { id: F039, coverage: 0.51 };
    const measuredOutput = (): NonNullable<VersionViewPort['output']> => {
        const output = versionView().output;
        if (output === null) {
            throw new Error('the fixture has an output');
        }
        return output;
    };
    const named = { loading: false, scene: scene(frame), failure: null };

    it('happyPath_whatTheRenderMeasuredBeatsTheScenesEstimate_withNoSceneRead', async () => {
        const measured = versionView({ entityId: F039, output: { ...measuredOutput(), coveragePct: 62 } });
        const { element } = await imageryPage(
            imageryState({
                dates: [ROW],
                detail: { kind: 'version', id: 'job-1966' },
                named: { loading: false, scene: null, failure: null },
                version: versionPage({}, measured),
            }),
        );
        await updated(element);

        expect(deep(element, '[data-join-offer]').textContent).toContain('62 %');
    });

    it('badPath_aFrameThatMeasuredTheWholeCityIsOfferedNothing_whateverTheEstimate', async () => {
        const whole = versionView({ entityId: F039, output: { ...measuredOutput(), coveragePct: 96 } });
        const { element } = await imageryPage(
            imageryState({ dates: [ROW], detail: { kind: 'version', id: 'job-1966' }, named, version: versionPage({}, whole) }),
        );
        await updated(element);

        expect(deepAll(element, '[data-join-offer]')).toEqual([]);
    });

    it('happyPath_theFramePageOffersItsDatesOthersInShortNames', async () => {
        const three = { ...ROW, frames: [...ROW.frames, { entityId: A039, free: true }] };
        const { element, area, app } = await imageryPage(
            imageryState({
                dates: [three],
                detail: { kind: 'version', id: 'job-1966' },
                named,
                version: versionPage({}, versionView({ entityId: F039 })),
            }),
        );
        const offer = deep(element, '[data-join-offer]');

        expect(offer.textContent).toContain('This frame covers about 51 % of the city. With F040, A039: about 96 %.');
        click(button(offer, 'Join frames'));
        await updated(element);
        await updated(element);

        expect(calls(area)).toEqual([`joinFrames ${JSON.stringify([F039, F040, A039])}`]);
        expect(app.named('navigate').at(-1)).toContain('job-join');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theScenePageOffersItBesideImport', async () => {
        const item = scene(frame);
        const { element } = await imageryPage(imageryState({ dates: [ROW], detail: { kind: 'scene', id: F039 }, scenes: ready([item]) }));

        expect(deep(element, '.pane[data-scene] [data-join-offer]').textContent).toContain('With F040: about 96 %.');
    });

    it('badPath_noOfferForAFrameThatCoversTheCityOrWhoseDateHasNoOtherFrame', async () => {
        const whole = scene({ id: F039, coverage: 0.94 });
        const { element, area } = await imageryPage(
            imageryState({ dates: [ROW], detail: { kind: 'scene', id: F039 }, scenes: ready([whole]) }),
        );
        expect(deepAll(element, '[data-join-offer]')).toEqual([]);

        const alone = { ...ROW, frames: [ROW.frames[0]] } as DatePlanRow;
        area.set({ dates: [alone], scenes: ready([scene(frame)]) });
        await updated(element);
        expect(deepAll(element, '[data-join-offer]')).toEqual([]);
    });

    it('badPath_noOfferOnAVersionNotAwaitingApprovalAnotherScenesPageOrWhileAJoinHoldsTheFrame', async () => {
        const page = (version: ReturnType<typeof versionView>): Partial<ImageryViewState> => ({ version: versionPage({}, version) });
        const { element, area } = await imageryPage(
            imageryState({
                dates: [ROW],
                detail: { kind: 'version', id: 'job-1966' },
                named,
                ...page(versionView({ entityId: F039, state: 'processing' })),
            }),
        );
        expect(deepAll(element, '[data-join-offer]')).toEqual([]);

        area.set(page(versionView({ entityId: 'DS9' })));
        await updated(element);
        expect(deepAll(element, '[data-join-offer]')).toEqual([]);

        area.set({ named: { loading: false, scene: null, failure: null }, ...page(versionView({ entityId: F039 })) });
        await updated(element);
        expect(deepAll(element, '[data-join-offer]')).toEqual([]);

        const held = versionView({ entityId: F039, partOf: 'job-join' });
        const live = versionItem({ id: 'job-join', origin: 'join', state: 'processing', entityIds: [F039, F040] });
        area.set({ named, versions: ready([live]), ...page(held) });
        await updated(element);
        expect(deepAll(element, '[data-join-offer]')).toEqual([]);
        expect(deep(element, '[data-state="join-holds"] a').getAttribute('href')).toBe('#/imagery/version/job-join');
    });

    it('badPath_aSceneAJoinHoldsHasNoOffer', async () => {
        const item = scene({ ...frame, layerId: 'layer-f039' });
        const versions = ready([
            versionItem({ id: 'job-f039', layerId: 'layer-f039', partOf: 'job-join' }),
            versionItem({ id: 'job-join', origin: 'join', state: 'processing', entityIds: [F039, F040] }),
        ]);
        const { element } = await imageryPage(
            imageryState({ dates: [ROW], detail: { kind: 'scene', id: F039 }, scenes: ready([item]), versions }),
        );

        expect(deepAll(element, '[data-join-offer]')).toEqual([]);
    });

    it('badPath_aPublishedFramesSceneWhoseJoinIsOnItsLayerHasNoOffer', async () => {
        // The join is the layer's only open version; its own `partOf` says nothing.
        const item = scene({ ...frame, layerId: 'layer-f039' });
        const versions = ready([
            versionItem({ id: 'job-join', layerId: 'layer-f039', origin: 'join', state: 'awaiting_approval', entityIds: [F039, F040] }),
        ]);
        const { element } = await imageryPage(
            imageryState({ dates: [ROW], detail: { kind: 'scene', id: F039 }, scenes: ready([item]), versions }),
        );

        expect(deepAll(element, '[data-join-offer]')).toEqual([]);
    });
});

describe("a join's page", () => {
    it('happyPath_itsFramesWithTheirStateAndLinkAndAFrameThatNeedsPointsGoesToTheGeoreferencer', async () => {
        const versions = ready([versionItem({ id: 'job-f039', state: 'needs_gcps', partOf: 'job-join' })]);
        const dates = [
            { ...ROW, frames: [ROW.frames[0], { entityId: F040, free: true, versionId: 'job-f040', state: 'published' as const }] },
        ] as DatePlanRow[];
        const job = jobView({ type: 'layer-join', waitReason: 'parts', status: 'queued' });
        const { element } = await imageryPage(
            joinPage(versionView({ ...JOIN_VIEW, state: 'processing', join: null, output: null }), job, { versions, dates }),
        );

        const rows = deepAll(element, '[data-join-parts] li');
        expect(rows.map((row) => deep(row, '.row-title').textContent)).toEqual(['F039', 'F040']);
        expect(rows.map((row) => deep(row, '.row-detail').textContent)).toEqual(['Needs points', 'Published']);
        expect(deep(nth(element, '[data-join-parts] li', 0), 'a').getAttribute('href')).toBe('#/georef/job-f039');
        expect(deep(nth(element, '[data-join-parts] li', 1), 'a').getAttribute('href')).toBe('#/imagery/version/job-f040');
        // It says it waits once, above the frames.
        expect(deep(element, '[data-state="join-waiting"]').textContent).toBe('Waiting for its frames');
        expect(deepAll(element, '[data-wait]')).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anEndedFrameHasNoStateAndTwoFramesTooFarApartGoToTheGeoreferencer', async () => {
        const job = jobView({
            type: 'layer-join',
            status: 'failed',
            finished: true,
            waitReason: null,
            error: { notice: { key: 'apiError.imagery.joinSeamTooFar', params: { a: 'F039', b: 'F040' } }, message: '' },
        });
        const { element } = await imageryPage(
            joinPage(versionView({ ...JOIN_VIEW, state: 'failed', join: null }), job, { versions: ready([]) }),
        );
        const rows = deepAll(element, '[data-join-parts] li');

        expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['', '']);
        expect(deepAll(nth(element, '[data-join-parts] li', 0), '.row-detail')).toEqual([]);
        expect(deep(nth(element, '[data-join-parts] li', 0), 'a').getAttribute('href')).toBe('#/georef/job-f039');
        expect(deepAll(element, '[data-state="join-waiting"]')).toEqual([]);
        expect(deep(element, '[data-state="failed"]').textContent).toContain('too far apart');
    });

    it('happyPath_oncePublishedItsFramesReadJoined_andAJoinedFrameLeadsBackToIt', async () => {
        const published = versionView({ ...JOIN_VIEW, state: 'published', join: REPORT });
        const { element, area } = await imageryPage(
            joinPage(published, jobView({ type: 'layer-join', status: 'succeeded', finished: true }), { versions: ready([]) }),
        );
        const rows = deepAll(element, '[data-join-parts] li');

        expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['joined', 'joined']);
        expect(nth(element, '[data-join-parts] li', 0).textContent).toContain('Joined');

        const frame = versionView({ state: 'joined', entityId: F039, partOf: 'job-join' });
        area.set({ versions: ready([]), version: versionPage({ id: 'job-f039' }, frame) });
        await updated(element);
        expect(deep(element, '[data-state="join-holds"] a').getAttribute('href')).toBe('#/imagery/version/job-join');
    });

    it('happyPath_aJoinShortOfItsEstimateOffersTheFrameThePlanLeftOut', async () => {
        const spared = { ...ROW, spareFrames: [A039] };
        const short = versionView({ ...JOIN_VIEW, join: { ...REPORT, coveragePct: 62 } });
        const { element, area } = await imageryPage(joinPage(short, undefined, { dates: [spared] }));

        click(button(element, 'Add A039 and join again'));

        expect(calls(area).at(-1)).toBe(`joinFrames ${JSON.stringify([F039, F040, A039])}`);
    });

    it('happyPath_aShortJoinOffersTheNextFrameAndJoinsAgainWithIt', async () => {
        const three = { ...ROW, frames: [...ROW.frames, { entityId: A039, free: true }] };
        const short = versionView({ ...JOIN_VIEW, join: { ...REPORT, coveragePct: 71 } });
        const { element, area } = await imageryPage(joinPage(short, undefined, { dates: [three] }));

        click(button(element, 'Add A039 and join again'));

        expect(calls(area).at(-1)).toBe(`joinFrames ${JSON.stringify([F039, F040, A039])}`);
    });

    it('badPath_noNextFrameForAJoinThatCoversTheCityOrWithNothingLeftOrNoPlan', async () => {
        const three = { ...ROW, frames: [...ROW.frames, { entityId: A039, free: true }] };
        const { element, area } = await imageryPage(joinPage(undefined, undefined, { dates: [three] }));
        const offers = (): string[] => deepAll(element, '[data-join-parts] hcm-button').map((target) => target.textContent.trim());
        expect(offers()).toEqual([]);

        const short = versionView({ ...JOIN_VIEW, join: { ...REPORT, coveragePct: 71 } });
        area.set({ dates: [ROW], version: versionPage({ id: 'job-join' }, short, jobView({ type: 'layer-join' })) });
        await updated(element);
        expect(offers()).toEqual([]);

        area.set({ dates: [] });
        await updated(element);
        expect(offers()).toEqual([]);
        expect(deepAll(element, '[data-join-parts]')).toHaveLength(1);
    });
});

describe("the approval card's join section", () => {
    it('happyPath_theMeasuredCoverageEachSeamTheWorstFrameAndTheLargestShift', async () => {
        const { element } = await imageryPage(joinPage());
        const report = deep(element, '.card [data-join-report]');

        expect(report.textContent).toContain('Covers 93 % of the city');
        expect(deep(report, '[data-seam="applied"]').textContent.trim()).toBe('Seam F039 and F040: 61.2 m before, 8.4 m after');
        expect(report.textContent).toContain('Worst frame error: 51.6 m; joining does not improve it');
        expect(report.textContent).toContain('Largest shift: 42.5 m');
        expect(deepAll(report, '[data-omitted]')).toEqual([]);
        // The threshold line reads the worst frame's figure: a join has no georeference of its own.
        expect(deep(element, '.card [data-rmse="over"]').textContent).toContain('51.6');
        expect(deepText(element).toLowerCase()).not.toContain('seamless');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anUnmeasuredSeamAWorsenedOneAndAFrameLeftOutSaySo', async () => {
        const join: JoinReport = {
            seams: [
                { a: F039, b: F040, measured: false, applied: false, samples: 2, heldOut: 0, maxShiftM: 0 },
                {
                    a: F040,
                    b: A039,
                    measured: true,
                    applied: false,
                    samples: 20,
                    heldOut: 4,
                    beforeRmseM: 12,
                    afterRmseM: 19,
                    maxShiftM: 0,
                },
                { a: F039, b: A039, measured: true, applied: true, samples: 20, heldOut: 4, beforeRmseM: 12, maxShiftM: 3 },
            ],
            omitted: ['DS-OTHER'],
            coveragePct: 88,
            checkpointCount: 0,
            maxShiftM: 0,
        };
        const { element } = await imageryPage(joinPage(versionView({ ...JOIN_VIEW, join })));
        const report = deep(element, '[data-join-report]');

        expect(deep(report, '[data-seam="unmeasured"]').textContent.trim()).toBe('Seam F039 and F040 could not be measured');
        // No frame moved, and the card says why: a correction was measured and refused.
        expect(deep(report, '[data-seam="not-applied"]').textContent.trim()).toBe(
            'Seam F040 and A039: 12 m; the correction did not help, so nothing moved',
        );
        expect(deep(report, '[data-seam="applied"]').textContent.trim()).toBe('Seam F039 and A039: 12 m before, 12 m after');
        expect(deep(report, '[data-omitted]').textContent).toBe('Left out, adds nothing: DS-OTHER');
        expect(report.textContent).not.toContain('Worst frame error');
        expect(deep(element, '.card [data-rmse="unmeasured"]').textContent).not.toBe('');
    });

    it('badPath_framesThatNeverMeetSaySo_noEmptyList', async () => {
        const join: JoinReport = { ...REPORT, seams: [], maxShiftM: 0 };
        const { element } = await imageryPage(joinPage(versionView({ ...JOIN_VIEW, join })));
        const report = deep(element, '[data-join-report]');

        expect(deep(report, '[data-state="join-no-seams"]').textContent).toBe(
            'These frames do not overlap, so no seam was measured: the layer may have a gap',
        );
        expect(deepAll(report, 'ul')).toEqual([]);
    });

    it('badPath_aFrameHasNoSection', async () => {
        const { element } = await imageryPage(
            imageryState({ detail: { kind: 'version', id: 'job-1966' }, dates: [ROW], version: versionPage() }),
        );

        expect(deepAll(element, '[data-join-report]')).toEqual([]);
        expect(deepAll(element, '[data-join-parts]')).toEqual([]);
    });
});

describe('the work list', () => {
    it('happyPath_aFrameALiveJoinHoldsLeavesWaitingForYouUnlessItNeedsPoints', async () => {
        const versions = ready([
            versionItem({ id: 'job-f039', partOf: 'job-join' }),
            versionItem({ id: 'job-f040', state: 'needs_gcps', partOf: 'job-join' }),
            versionItem({ id: 'job-f041', partOf: 'job-gone' }),
            versionItem({ id: 'job-join', origin: 'join', state: 'processing', needsYou: false }),
        ]);
        const { element } = await imageryPage(imageryState({ tab: 'work', versions }));
        const ids = (section: string): (string | null)[] =>
            deepAll(deep(element, `section:has(> ${section})`), 'li').map((row) => row.getAttribute('data-version'));

        expect(ids('#imagery-needs-you')).toEqual(['job-f040', 'job-f041']);
        expect(ids('#imagery-in-progress')).toEqual(['job-f039', 'job-join']);
    });

    it('happyPath_aJoinAndItsFramesAreToldApart', async () => {
        const label = { label: { ro: 'KH-9', en: 'KH-9' }, year: 1972 };
        const versions = ready([
            versionItem({ ...label, id: 'job-f039', entityIds: [F039], partOf: 'job-join' }),
            versionItem({ ...label, id: 'job-join', origin: 'join', entityIds: [F039, F040] }),
            versionItem({ ...label, id: 'job-upload', origin: 'upload' }),
        ]);
        const { element } = await imageryPage(imageryState({ tab: 'work', versions }));
        const title = (id: string): string => deep(element, `[data-version="${id}"] .row-title`).textContent;

        expect(title('job-f039')).toBe('KH-9 · 1972 · F039');
        expect(title('job-join')).toBe('KH-9 · 1972 · Joined frames');
        expect(title('job-upload')).toBe('KH-9 · 1972');
    });

    it('happyPath_aJoinsPageIsHeadedAsOne_aHeldFramesPageHasNoCancel', async () => {
        const { element, area } = await imageryPage(joinPage());
        expect(deep(element, '[data-detail-heading]').textContent).toContain('Joined frames');
        button(element, 'Cancel job');

        const live = versionItem({ id: 'job-join', origin: 'join', state: 'processing', entityIds: [F039, F040] });
        const frame = versionView({ id: 'job-f039', entityId: F039, partOf: 'job-join', state: 'processing' });
        area.set({ versions: ready([live]), version: versionPage({ id: 'job-f039' }, frame, jobView()) });
        await updated(element);
        expect(deep(element, '[data-detail-heading]').textContent).toContain('F039');
        expect(deepAll(element, 'hcm-button').map((target) => target.textContent.trim())).not.toContain('Cancel job');
    });

    it('liveJoinOver_aLiveJoinNamingAnyFrame', () => {
        const items = [
            versionItem({ id: 'plain', entityIds: [F039] }),
            versionItem({ id: 'dead', origin: 'join', state: 'failed', entityIds: [F039] }),
            versionItem({ id: 'live', origin: 'join', state: 'processing', entityIds: [F039, F040] }),
        ];

        expect(liveJoinOver(items, [F040, A039])).toBe('live');
        expect(liveJoinOver(items, [A039])).toBeNull();
        expect(liveJoinOver(items.slice(0, 2), [F039])).toBeNull();
    });

    it('versionMark_aNameWhenItHasOne', () => {
        expect(frameName('other-id')).toBe('other-id');
        expect(versionMark('en', 'usgs', F039)).toBe('F039');
        expect(versionMark('en', 'upload', undefined)).toBeNull();
        expect(versionMark('ro', 'join', undefined)).toBe('Cadre unite');
    });

    it('liveJoin_aFailedOrAbsentJoinHoldsNothing', () => {
        const items = [versionItem({ id: 'live', state: 'awaiting_approval' }), versionItem({ id: 'dead', state: 'failed' })];

        expect([liveJoin(items, 'live'), liveJoin(items, 'dead'), liveJoin(items, 'gone'), liveJoin(items, null)]).toEqual([
            true,
            false,
            false,
            false,
        ]);
    });
});

describe('the chunk', () => {
    const contextOf = (view: ImageryViewState, refresh: () => void): ImageryContext => ({
        locale: 'en',
        view,
        intents: null,
        href: (params) => `#/imagery/${params.join('/')}`,
        go: () => undefined,
        readOnly: false,
        ask: () => undefined,
        refresh,
        focusDetail: () => undefined,
        showMap: () => undefined,
    });
    const shown = (template: ReturnType<typeof lazyJoin>): string => {
        const box = document.createElement('div');
        render(template, box);
        return box.textContent;
    };

    it('happyPath_withAPlanItIsFetchedOnceAndThePageRendersAgain', async () => {
        defineAll();
        let fetched = 0;
        let refreshed = 0;
        const chunk = chunkLoader<JoinCardChunk>(async () => {
            fetched += 1;
            return JOIN_CARD_CHUNK.load();
        });
        const context = contextOf(imageryState({ dates: [ROW] }), () => {
            refreshed += 1;
        });

        const loading = shown(lazyJoin(context, null, (loaded) => loaded.dateRows(context), chunk));
        await chunk.load();
        await updated(document.body);
        const rendered = shown(lazyJoin(context, null, (loaded) => loaded.dateRows(context), chunk));

        expect(loading).not.toContain('Whole-city dates');
        expect(rendered).toContain('Whole-city dates');
        expect(fetched).toBe(1);
        expect(refreshed).toBe(1);
    });

    it('badPath_neitherAPlanNorAJoinFetchesNothingAndAFailedFetchOffersTryAgain', async () => {
        defineAll();
        let fetched = 0;
        const chunk = chunkLoader<JoinCardChunk>(() => {
            fetched += 1;
            return Promise.reject(new Error('offline'));
        });
        const context = contextOf(imageryState(), () => undefined);

        expect(shown(lazyJoin(context, null, (loaded) => loaded.dateRows(context), chunk))).toBe('');
        expect(fetched).toBe(0);

        const joinVersion = versionView(JOIN_VIEW);
        shown(lazyJoin(context, joinVersion, (loaded) => loaded.joinReport(context, joinVersion), chunk));
        expect(fetched).toBe(1);
        await chunk.load().catch(() => undefined);
        expect(chunk.failed()).toBe(true);
    });
});
