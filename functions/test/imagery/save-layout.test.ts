/**
 * The tile-import wizard's callables (`docs/research/M20-import-local.md` §19.10): `imagery.saveLayout` and `imagery.acceptLayout` on an
 * archive series waiting with `layout-check`; each writes `help.layoutAnswer` and runs the series again from `place`.
 */
import type { HelpItem, JobDoc, LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { acceptLayoutFunction } from '../../src/imagery/accept-layout.js';
import { saveLayoutFunction } from '../../src/imagery/save-layout.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, NOW, at, needsGcpsVersion, readJob, readVersion, readyWorld, seedJob, seedVersion, type ImageryWorld } from './world.js';

const JOB = 'ar-mw993zri-s-4054e55659a3';
const DONE = 'done' as const;
const SHEETS = [
    { index: 0, row: 0, col: 1, turn: 90 as const, flip: false },
    { index: 1, row: 0, col: 0, turn: 0 as const, flip: true, out: 'not-part' as const },
];
const SEAMS = [{ a: 0, b: 2, side: 'right' as const, points: { a: [10, 20] as [number, number], b: [3, 21] as [number, number] } }];

function parkedSeries(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'archive-series',
        status: 'awaiting_gcps',
        waitReason: 'gcps',
        params: {
            archiveId: 'ar-0123456789abcdef',
            seriesId: 's-4054e55659a3',
            class: 'atlas',
            sheets: 94,
            encoding: 'lineart',
            order: 0,
            referenceLayerIds: [],
        },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'atlas-1911',
        versionId: JOB,
        attempt: 3,
        steps: { gather: { status: DONE }, place: { status: DONE }, export: { status: 'pending' } },
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

const LAYOUT = {
    rows: 10,
    cols: 10,
    revision: 4,
    quality: { placedPct: 62, seamMedian: 0.31, seamRmsPx: 7.5, verdict: 'check' as const },
    weakSeams: [{ a: 0, b: 2, side: 'right' as const, score: 0.2 }],
};

function parkedHelp(reason: 'layout-check' | 'low-confidence' = 'layout-check', withLayout = true, revision = 4): HelpItem {
    const stitched = {
        previewPath: `rasters/${CITY}/atlas-1911/${JOB}/stitched.jpg`,
        previewScale: 0.5,
        width: 8000,
        height: 6000,
        method: 'names' as const,
        parts: 94,
        joined: 58,
        leftOut: [],
        leftOutCount: 36,
        ...(withLayout ? { layout: { ...LAYOUT, revision } } : {}),
    };
    return { reason, note: 'The tiles need a look.', at: at(NOW), stitched };
}

function parkedVersion(help: HelpItem = parkedHelp()): LayerVersionDoc {
    const rest = omit(needsGcpsVersion(), ['scan', 'georef', 'reference']);
    return {
        ...rest,
        layerId: 'atlas-1911',
        jobId: JOB,
        origin: 'archive',
        source: { kind: 'archive', archiveId: 'ar-0123456789abcdef', seriesId: 's-4054e55659a3', sheetCount: 94 },
        help,
    };
}

async function world(job: Partial<JobDoc> = {}, version: LayerVersionDoc = parkedVersion()): Promise<ImageryWorld> {
    const ready = await readyWorld();
    await seedJob(ready, JOB, parkedSeries(job));
    await seedVersion(ready, JOB, version);
    return ready;
}

function saveLayout(ready: ImageryWorld, revision = 4, preview = true) {
    return saveLayoutFunction(() => ready.deps).run(
        adminCall({ cityId: CITY, versionId: JOB, revision, sheets: SHEETS, seams: SEAMS, preview }),
    );
}

function acceptLayout(ready: ImageryWorld, revision = 4) {
    return acceptLayoutFunction(() => ready.deps).run(adminCall({ cityId: CITY, versionId: JOB, revision }));
}

describe('imagery.saveLayout: the owner arranges the tiles', () => {
    it('happyPath_theAnswerIsWrittenAndTheSeriesPlacesItselfAgain @S-A-HAPPY-TILE-WIZARD-ORDER', async () => {
        const ready = await world();

        await expect(saveLayout(ready)).resolves.toEqual({ jobId: JOB, versionId: JOB });

        const version = await readVersion(ready, JOB);
        expect(version?.state).toBe('processing');
        expect(version?.help?.layoutAnswer).toMatchObject({ revision: 4, sheets: SHEETS, seams: SEAMS, preview: true });
        expect(version?.help?.layoutAnswer?.accepted).toBeUndefined();
        expect(version?.help?.stitched?.layout).toEqual(LAYOUT);
        const job = await readJob(ready, JOB);
        expect(job).toMatchObject({ status: 'queued', attempt: 2 });
        expect(job?.waitReason).toBeUndefined();
        expect(job?.steps).toEqual({ gather: { status: DONE }, place: { status: 'pending' }, export: { status: 'pending' } });
    });

    it('badPath_anAnswerOnAnOlderRevisionIsRefused @S-A-BAD-TILE-WIZARD-STALE-REVISION', async () => {
        const ready = await world();

        expect(await failureOf(saveLayout(ready, 3))).toMatchObject({ details: { code: 'apiError.imagery.layoutStale' } });
        expect((await readVersion(ready, JOB))?.state).toBe('needs_gcps');
        expect((await readJob(ready, JOB))?.status).toBe('awaiting_gcps');
    });

    it('badPath_aSeriesWaitingForAnotherReasonIsRefused', async () => {
        const ready = await world({}, parkedVersion(parkedHelp('low-confidence')));

        expect(await failureOf(saveLayout(ready))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_aWaitWithoutALayoutIsRefused', async () => {
        const ready = await world({}, parkedVersion(parkedHelp('layout-check', false)));

        expect(await failureOf(saveLayout(ready))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_aSeriesAskedToStopIsRefused', async () => {
        const ready = await world({ cancelRequested: true });

        expect(await failureOf(saveLayout(ready))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_aMissingVersionIsRefused', async () => {
        const ready = await readyWorld();

        expect(await failureOf(saveLayout(ready))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });
});

describe('imagery.acceptLayout: the layout as it stands', () => {
    it('happyPath_theLayoutIsAcceptedAndTheEarlierAnswerKept @S-A-HAPPY-TILE-WIZARD-HANDOFF', async () => {
        const ready = await world();
        await saveLayout(ready);
        await seedJob(ready, JOB, parkedSeries({ attempt: 1 }));
        const saved = (await readVersion(ready, JOB))?.help?.layoutAnswer;
        expect(saved).toBeDefined();
        await seedVersion(
            ready,
            JOB,
            parkedVersion({ ...parkedHelp('layout-check', true, 5), ...(saved === undefined ? {} : { layoutAnswer: saved }) }),
        );

        await expect(acceptLayout(ready, 5)).resolves.toEqual({ jobId: JOB, versionId: JOB });

        const answer = (await readVersion(ready, JOB))?.help?.layoutAnswer;
        expect(answer).toMatchObject({ revision: 5, sheets: SHEETS, seams: SEAMS, preview: false, accepted: true });
        expect(await readJob(ready, JOB)).toMatchObject({ status: 'queued', attempt: 1 });
    });

    it('happyPath_aLayoutAcceptedWithoutChangesCarriesNone', async () => {
        const ready = await world();

        await acceptLayout(ready);

        expect((await readVersion(ready, JOB))?.help?.layoutAnswer).toMatchObject({ sheets: [], seams: [], accepted: true });
    });

    it('badPath_acceptingAnOlderRevisionIsRefused', async () => {
        const ready = await world();

        expect(await failureOf(acceptLayout(ready, 1))).toMatchObject({ details: { code: 'apiError.imagery.layoutStale' } });
    });
});
