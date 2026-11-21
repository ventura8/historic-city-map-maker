/**
 * The imagery family's shared records (`functions/src/imagery/{records,usgs-session}.ts`): the redacted job log stops
 * at 500 lines and never fails the work it describes; USGS failures become the Imagery area's codes and anything else
 * passes through as an error.
 */
import { FIRESTORE_PATHS, jobLogDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/api/api-error.js';
import { appendJobLog, pickDefined } from '../../src/imagery/records.js';
import { usgsError } from '../../src/imagery/usgs-session.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { CITY, at, readyWorld } from './world.js';

describe('appendJobLog', () => {
    it('happyPath_aLineIsRedactedAndNumberedAfterTheLastOne', async () => {
        const world = await readyWorld();
        await world.deps.documents.set(`${FIRESTORE_PATHS.jobLogs(CITY, 'j1')}/000004`, jobLogDocSchema, {
            seq: 4,
            level: 'info',
            message: 'fetch done',
            updatedBy: 'system:pipeline',
            updatedAt: at('2026-10-23T07:00:00.000Z'),
        });

        await appendJobLog(world.deps, CITY, 'j1', {
            level: 'warn',
            step: 'upload',
            message: 'see https://example.org/x?access_token=sk.secret',
        });

        expect(world.deps.documents.peek(`${FIRESTORE_PATHS.jobLogs(CITY, 'j1')}/000005`)).toMatchObject({
            seq: 5,
            level: 'warn',
            step: 'upload',
            updatedBy: 'system:imagery',
        });
        expect(JSON.stringify(world.deps.documents.peek(`${FIRESTORE_PATHS.jobLogs(CITY, 'j1')}/000005`))).not.toContain('sk.secret');
    });

    it('badPath_theFiveHundredAndFirstLineIsDropped', async () => {
        const world = await readyWorld();
        await world.deps.documents.set(`${FIRESTORE_PATHS.jobLogs(CITY, 'j1')}/000499`, jobLogDocSchema, {
            seq: 499,
            level: 'info',
            message: 'x',
            updatedBy: 'system:pipeline',
            updatedAt: at('2026-10-23T07:00:00.000Z'),
        });

        await appendJobLog(world.deps, CITY, 'j1', { level: 'info', message: 'one too many' });

        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobLogs(CITY, 'j1'))).toHaveLength(1);
    });

    it('badPath_aLogLineThatCannotBeWrittenNeverFailsTheWork', async () => {
        const world = await readyWorld();
        world.deps.documents.recorder.failNext('create', new UpstreamError('firestore', 'unavailable'));

        await expect(appendJobLog(world.deps, CITY, 'j1', { level: 'error', message: 'x' })).resolves.toBeUndefined();
        expect(world.deps.recording.records.map((record) => record.message)).toContain('job log line not written');
    });
});

describe('usgsError', () => {
    it.each([
        ['a USGS outage', new UpstreamError('usgs', 'unavailable'), new ApiError('apiError.usgs.unavailable')],
        ['another service', new UpstreamError('mapbox', 'unavailable'), new UpstreamError('mapbox', 'unavailable')],
        ['an error of its own', new Error('boom'), new Error('boom')],
        ['a value that is not an error', 'boom', new Error('boom')],
    ])('maps_%s', (_case, error, expected) => {
        expect(usgsError(error)).toEqual(expected);
    });
});

describe('pickDefined', () => {
    it('happyPath_keepsTheKeysThatAreSet', () => {
        const value: { a?: number; b?: number | undefined; c?: string } = { a: 1, b: undefined, c: 'x' };

        expect(pickDefined(value, ['a', 'b'])).toEqual({ a: 1 });
    });
});
