/**
 * A pass's last proved model (`functions/src/imagery/pass-calibration.ts`, `docs/research/M9-calibration.md` §2): the frame `locate`
 * proved leaves it for the pass's next frame, through `imagery.onJobWrite`; a frame nothing proved leaves the pass as it was.
 */
import { FIRESTORE_PATHS, imageryPassDocSchema, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { onJobWrite } from '../../src/imagery/on-job-write.js';
import { locateEnded, recordProvedPass } from '../../src/imagery/pass-calibration.js';
import { CITY, NOW, at, readyWorld, renderedVersion, seedJob, seedVersion, type ImageryWorld } from './world.js';

const JOB = 'job-f006';
const ENTITY = 'D3C1203-300415F006';
const DATE = '1975-08-20';
const KEY = 'D3C1203-300415-F-1975-08-20';
const MODEL = { camera: 'panoramic', rotation: 0, mirrored: false, scale: 0.946, rotationDeg: -0.17, dxM: 10320, dyM: 17289 } as const;
const SOURCE = { kind: 'usgs', entityId: ENTITY, dataset: 'declassiii', sensor: 'KH-9-pan', acquisitionDate: DATE } as const;

function job(locate?: 'running' | 'done'): JobDoc {
    return {
        type: 'usgs-import',
        status: 'running',
        params: { entityId: ENTITY, dataset: 'declassiii', sensor: 'KH-9-pan' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'layer',
        versionId: JOB,
        attempt: 1,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...(locate === undefined ? {} : { steps: { locate: { status: locate } } }),
    };
}

function passOf(world: ImageryWorld, key = KEY) {
    return world.deps.documents.get(FIRESTORE_PATHS.imageryPass(CITY, key), imageryPassDocSchema);
}

async function worldWith(version: Partial<LayerVersionDoc>): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedJob(world, JOB, job('done'));
    await seedVersion(world, JOB, { ...renderedVersion(), jobId: JOB, source: SOURCE, ...version });
    return world;
}

describe('locateEnded', () => {
    it('happyPath_onlyTheWriteThatEndedItsLocate', () => {
        expect(locateEnded(job('running'), job('done'))).toBe(true);
        expect(locateEnded(undefined, job('done'))).toBe(true);
    });

    it('badPath_notBeforeItEnded_notAgainAfter', () => {
        expect(locateEnded(job(), job('running'))).toBe(false);
        expect(locateEnded(job('done'), job('done'))).toBe(false);
    });
});

describe('the proved model of a pass', () => {
    it('happyPath_aProvedFrameLeavesItsModelThroughTheTrigger @S-A67-HAPPY-PASS-RECORDED', async () => {
        const world = await worldWith({ calibration: { how: 'votes', model: MODEL, tiles: { agreed: 402, tried: 500 } } });

        await onJobWrite(world.deps, CITY, JOB, { before: job('running'), after: job('done') });

        expect(await passOf(world)).toEqual({
            model: MODEL,
            entityId: ENTITY,
            date: DATE,
            updatedBy: 'system:imagery',
            updatedAt: at(NOW),
        });
    });

    it.each([
        ['nothing proved it', { calibration: { how: 'none', refusal: 'no-votes' } }],
        ['a refusal stands', { calibration: { how: 'votes', model: MODEL, refusal: 'few-inliers' } }],
        ['it holds no model', { calibration: { how: 'votes' } }],
        ['it was not looked for', { calibration: undefined }],
        ['it is an upload', { calibration: { how: 'votes', model: MODEL }, source: { kind: 'upload', uploadPath: 'u/a.tif', bytes: 1 } }],
    ] satisfies readonly (readonly [string, Partial<LayerVersionDoc>])[])(
        'badPath_noPassWhen_%s @S-A67-BAD-PASS-NOT-PROVED',
        async (_case, version) => {
            const world = await worldWith(version);

            await onJobWrite(world.deps, CITY, JOB, { before: job('running'), after: job('done') });

            expect(await passOf(world)).toBeUndefined();
        },
    );

    it('badPath_anEntityIdThatReadsAsNoPassWritesNothing', async () => {
        const world = await worldWith({ calibration: { how: 'pass', model: MODEL }, source: { ...SOURCE, entityId: 'NOFRAMENUMBER' } });

        expect(await recordProvedPass(world.deps, CITY, JOB, job('done'))).toBe(false);
    });

    it('badPath_aFailedWriteDoesNotStopTheTrigger', async () => {
        const world = await worldWith({ calibration: { how: 'votes', model: MODEL } });
        const documents = world.deps.documents;
        const failing = {
            ...world.deps,
            documents: Object.assign(Object.create(documents) as typeof documents, { set: () => Promise.reject(new Error('down')) }),
        };

        await expect(onJobWrite(failing, CITY, JOB, { before: job('running'), after: job('done') })).resolves.toBe('none');
    });
});
