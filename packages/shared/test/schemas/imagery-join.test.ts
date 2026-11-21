/**
 * M8's contracts (`docs/research/M8-join-interfaces.md` §2): a join version's source, its job's params, the report of what
 * it measured, the new state, and the plan document's rows.
 */
import { describe, expect, it } from 'vitest';

import { imageryJoinRequestSchema, imageryJoinResponseSchema } from '../../src/api/imagery.js';
import { CLIENT_JOB_TYPES, JOB_TYPES, JOB_WAIT_REASONS, jobDocSchema } from '../../src/schemas/firestore-ops.js';
import { layerDocSchema } from '../../src/schemas/firestore.js';
import {
    joinPartSchema,
    joinReportSchema,
    joinSeamSchema,
    joinSourceSchema,
    layerJoinParamsSchema,
} from '../../src/schemas/imagery-join.js';
import { DATE_PLAN_MAX_ROWS, datePlanDocSchema, datePlanRowSchema } from '../../src/schemas/imagery-plan.js';
import { JOIN_MAX_PARTS } from '../../src/schemas/imagery-settings.js';
import { ENDED_VERSION_STATES, JOB_PARAMS_SCHEMAS, JOB_STEPS, layerVersionDocSchema, PIPELINE_STEPS } from '../../src/schemas/imagery.js';

const PART = {
    versionId: 'job-f039',
    layerId: 'layer-f039',
    entityId: 'D3C1202-200149F039',
    dataset: 'declassiii',
    sensor: 'KH-9-pan',
    acquisitionDate: '1972-08-08',
} as const;
const PARTS = [PART, { ...PART, versionId: 'job-f040', layerId: 'layer-f040', entityId: 'D3C1202-200149F040' }];
const AT = { seconds: 1, nanoseconds: 0 };
const SEAM = {
    a: 'F039',
    b: 'F040',
    measured: true,
    applied: true,
    samples: 24,
    heldOut: 4,
    beforeRmseM: 60,
    afterRmseM: 9,
    maxShiftM: 40,
};
const REPORT = { seams: [SEAM], omitted: [], coveragePct: 97.5, checkpointRmseM: 51.6, checkpointCount: 3, maxShiftM: 40 };
const OUTPUT = {
    cogPath: 'rasters/c/l/v/cog.tif',
    cogBytes: 1,
    cogSha256: 'c'.repeat(64),
    previewPath: 'rasters/c/l/v/preview.png',
    bounds: { west: 25, south: 44, east: 26, north: 45 },
    minzoom: 10,
    maxzoom: 17,
    areaKm2: 500,
};
const VERSION = {
    layerId: 'layer-join',
    jobId: 'job-join',
    origin: 'join',
    state: 'awaiting_approval',
    source: { kind: 'join', parts: PARTS },
    label: { ro: 'KH-9' },
    year: 1972,
    output: OUTPUT,
    join: REPORT,
    createdBy: 'uid-1',
    createdAt: AT,
    updatedBy: 'system:pipeline',
    updatedAt: AT,
};
const FRAME = { entityId: 'F039', free: true };
const ROW = {
    date: '1972-08-08',
    sensor: 'KH-9-pan',
    frames: [FRAME],
    paidFrames: [],
    coveragePct: 90,
    framesToDownload: 1,
    winter: false,
};

describe('the join version', () => {
    it('happyPath_aJoinVersionHasASourceOfPartsAndAReportButNoScan', () => {
        expect(layerVersionDocSchema.safeParse(VERSION).success).toBe(true);
    });

    it('happyPath_aFrameHeldByAJoinNamesIt', () => {
        const { entityId, dataset, sensor, acquisitionDate } = PART;
        const part = {
            ...VERSION,
            origin: 'usgs',
            source: { kind: 'usgs', entityId, dataset, sensor, acquisitionDate },
            partOf: 'job-join',
        };

        expect(layerVersionDocSchema.safeParse(part).success).toBe(true);
        expect(layerVersionDocSchema.safeParse({ ...part, partOf: '../job' }).success).toBe(false);
    });

    it('happyPath_joinedIsEndedAndRequiresItsOutput', () => {
        expect(ENDED_VERSION_STATES).toContain('joined');
        expect(layerVersionDocSchema.safeParse({ ...VERSION, state: 'joined' }).success).toBe(true);
        expect(layerVersionDocSchema.safeParse({ ...VERSION, state: 'joined', output: undefined }).success).toBe(false);
    });

    it.each([
        ['one frame', { kind: 'join', parts: [PART] }],
        ['more frames than a join takes', { kind: 'join', parts: Array.from({ length: JOIN_MAX_PARTS + 1 }, () => PART) }],
    ])('badPath_aSourceOf_%s_isRefused', (_case, source) => {
        expect(joinSourceSchema.safeParse(source).success).toBe(false);
        expect(layerVersionDocSchema.safeParse({ ...VERSION, source }).success).toBe(false);
    });

    it('badPath_aPartNeedsItsDatasetAndADate', () => {
        expect(joinPartSchema.safeParse(PART).success).toBe(true);
        expect(joinPartSchema.safeParse({ ...PART, dataset: 'landsat' }).success).toBe(false);
        expect(joinPartSchema.safeParse({ ...PART, acquisitionDate: 'August' }).success).toBe(false);
    });

    it('badPath_theReportRefusesImpossibleFigures', () => {
        expect(joinReportSchema.safeParse(REPORT).success).toBe(true);
        expect(joinReportSchema.safeParse({ ...REPORT, coveragePct: 101 }).success).toBe(false);
        expect(joinReportSchema.safeParse({ ...REPORT, checkpointCount: 1.5 }).success).toBe(false);
        expect(joinReportSchema.safeParse({ ...REPORT, maxShiftM: -1 }).success).toBe(false);
    });

    it('happyPath_anUnmeasuredSeamHasNoFigures', () => {
        const unmeasured = { ...SEAM, measured: false, applied: false, beforeRmseM: undefined, afterRmseM: undefined };

        expect(joinSeamSchema.safeParse(unmeasured).success).toBe(true);
        expect(joinSeamSchema.safeParse({ ...SEAM, samples: -1 }).success).toBe(false);
    });
});

describe('the layer-join job', () => {
    it('happyPath_onlyTheCallableQueuesIt_itsStepsReuseExportAndRegister', () => {
        expect(JOB_TYPES).toContain('layer-join');
        expect(CLIENT_JOB_TYPES as readonly string[]).not.toContain('layer-join');
        expect(JOB_STEPS['layer-join'].slice(0, 5)).toEqual(['align', 'merge', 'export', 'pyramid', 'register']);
        expect(PIPELINE_STEPS.indexOf('merge')).toBeLessThan(PIPELINE_STEPS.indexOf('warp'));
        expect(JOB_WAIT_REASONS).toContain('parts');
    });

    it('happyPath_itsParamsNameTheFramesAndTheCamera', () => {
        const parts = [
            { versionId: 'v1', layerId: 'l1' },
            { versionId: 'v2', layerId: 'l2' },
        ];

        expect(JOB_PARAMS_SCHEMAS['layer-join'].safeParse({ parts, sensor: 'KH-9-pan' }).success).toBe(true);
        expect(layerJoinParamsSchema.safeParse({ parts: parts.slice(1), sensor: 'KH-9-pan' }).success).toBe(false);
        expect(layerJoinParamsSchema.safeParse({ parts, sensor: 'KH-6' }).success).toBe(false);
        expect(layerJoinParamsSchema.safeParse({ parts, sensor: 'KH-9-pan', extra: 1 }).success).toBe(false);
    });

    it('happyPath_aJoinIsBornWaitingForItsParts', () => {
        const job = {
            type: 'layer-join',
            status: 'queued',
            params: {},
            waitReason: 'parts',
            createdBy: 'uid-1',
            createdAt: AT,
            updatedBy: 'uid-1',
            updatedAt: AT,
        };

        expect(jobDocSchema.safeParse(job).success).toBe(true);
        expect(jobDocSchema.safeParse({ ...job, waitReason: 'frames' }).success).toBe(false);
    });
});

describe('imagery.join', () => {
    it('happyPath_takesTwoToEightFrames', () => {
        expect(imageryJoinRequestSchema.safeParse({ cityId: 'bucharest', entityIds: ['a', 'b'] }).success).toBe(true);
        expect(imageryJoinResponseSchema.safeParse({ jobId: 'j', versionId: 'j', layerId: 'l' }).success).toBe(true);
    });

    it.each([
        ['one frame', ['a']],
        ['nine frames', Array.from({ length: 9 }, (_frame, index) => `f${String(index)}`)],
    ])('badPath_refuses_%s', (_case, entityIds) => {
        expect(imageryJoinRequestSchema.safeParse({ cityId: 'bucharest', entityIds }).success).toBe(false);
    });
});

describe('a joined layer provenance', () => {
    it('badPath_atMostAJoinsFramesAreListed', () => {
        const provenance = (usgsParts: readonly string[]) => layerDocSchema.shape.provenance.safeParse({ usgsEntityId: 'a', usgsParts });

        expect(provenance(['a', 'b']).success).toBe(true);
        expect(provenance(Array.from({ length: JOIN_MAX_PARTS + 1 }, () => 'a')).success).toBe(false);
    });
});

describe('the plan of the dates', () => {
    it('happyPath_aRowHoldsFramesAndTheirEstimate', () => {
        expect(datePlanRowSchema.safeParse(ROW).success).toBe(true);
        expect(
            datePlanRowSchema.safeParse({ ...ROW, frames: [{ ...FRAME, versionId: 'v', state: 'joined', displayId: 'F039' }] }).success,
        ).toBe(true);
    });

    it('badPath_aRowRefusesAnImpossibleOne', () => {
        expect(datePlanRowSchema.safeParse({ ...ROW, coveragePct: 101 }).success).toBe(false);
        expect(datePlanRowSchema.safeParse({ ...ROW, frames: Array.from({ length: JOIN_MAX_PARTS + 1 }, () => FRAME) }).success).toBe(
            false,
        );
        expect(datePlanRowSchema.safeParse({ ...ROW, paidFrames: Array.from({ length: 9 }, () => 'p') }).success).toBe(false);
        expect(datePlanRowSchema.safeParse({ ...ROW, frames: [{ ...FRAME, state: 'lost' }] }).success).toBe(false);
    });

    it('badPath_theDocumentHoldsAtMostItsRows', () => {
        expect(datePlanDocSchema.safeParse({ rows: [ROW], updatedAt: AT }).success).toBe(true);
        expect(
            datePlanDocSchema.safeParse({ rows: Array.from({ length: DATE_PLAN_MAX_ROWS + 1 }, () => ROW), updatedAt: AT }).success,
        ).toBe(false);
    });
});
