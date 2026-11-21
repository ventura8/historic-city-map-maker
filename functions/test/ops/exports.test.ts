/**
 * `ops.tick`'s `exports` step (`functions/src/ops/exports.ts`, M5 §5.3): a ready export past its seven days becomes
 * `expired` and its zip goes; one still queued or building long after its build may run becomes `failed`; others stay.
 */
import { FIRESTORE_PATHS, STORAGE_PATHS, cityDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { expireExports, exportChange } from '../../src/ops/exports.js';
import { CITY, cityDoc, exportRecord, exportWorld, readExport, seedCity, seedExport } from '../export/world.js';

const at = (iso: string) => timestampFromDate(new Date(iso));
const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('the exports step', () => {
    it('happyPath_anExportPastItsTimeExpiresAndItsZipGoes', async () => {
        const world = exportWorld();
        await seedCity(world);
        await seedExport(world, 'x-1', { state: 'ready', expiresAt: at('2026-11-09T10:00:00Z') });
        await seedExport(world, 'x-2', { state: 'ready', expiresAt: at('2026-11-10T10:00:00Z') });
        world.blobs.put('private', STORAGE_PATHS.cityExport(CITY, 'x-1'), new Uint8Array([1]));
        world.blobs.put('private', STORAGE_PATHS.cityExport(CITY, 'x-2'), new Uint8Array([2]));

        await expect(expireExports(world, NOW)).resolves.toBe(1);

        expect(await readExport(world, 'x-1')).toMatchObject({
            state: 'expired',
            updatedBy: 'system:export',
            updatedAt: timestampFromDate(NOW),
        });
        expect((await readExport(world, 'x-2'))?.state).toBe('ready');
        expect(world.blobs.paths('private', 'exports/')).toEqual([STORAGE_PATHS.cityExport(CITY, 'x-2')]);
    });

    it('badPath_anExportStuckInItsBuildFails_soItsOwnersCanExportAgain', async () => {
        const world = exportWorld();
        await seedCity(world);
        await seedExport(world, 'x-1', { state: 'building', createdAt: at('2026-11-09T11:00:00Z') });
        await seedExport(world, 'x-2', { state: 'queued', createdAt: at('2026-11-09T11:30:00Z') });

        await expect(expireExports(world, NOW)).resolves.toBe(1);

        expect(await readExport(world, 'x-1')).toMatchObject({ state: 'failed', error: 'apiError.unavailable' });
        expect((await readExport(world, 'x-2'))?.state).toBe('queued');
    });

    it('happyPath_everyCityIsWalked_evenOneWhoseDocumentFailsItsSchema', async () => {
        const world = exportWorld();
        await world.documents.set(FIRESTORE_PATHS.city('cluj'), cityDocSchema, cityDoc());
        world.documents.seed(FIRESTORE_PATHS.city(CITY), { name: 'not a localized name' });
        await seedExport(world, 'x-1', { state: 'ready', expiresAt: at('2026-11-01T10:00:00Z') });

        await expect(expireExports(world, NOW)).resolves.toBe(1);
    });
});

describe('exportChange', () => {
    it.each([
        ['ready, in time', exportRecord({ state: 'ready', expiresAt: at('2026-11-09T12:00:01Z') }), null],
        ['ready, at its time', exportRecord({ state: 'ready', expiresAt: at('2026-11-09T12:00:00Z') }), { state: 'expired' }],
        ['ready without an expiry', exportRecord({ state: 'ready' }), null],
        ['failed long ago', exportRecord({ state: 'failed', error: 'apiError.internal', createdAt: at('2026-11-01T00:00:00Z') }), null],
        ['expired already', exportRecord({ state: 'expired', createdAt: at('2026-11-01T00:00:00Z') }), null],
        ['queued for 39 minutes', exportRecord({ state: 'queued', createdAt: at('2026-11-09T11:21:00Z') }), null],
        [
            'queued for 40 minutes',
            exportRecord({ state: 'queued', createdAt: at('2026-11-09T11:20:00Z') }),
            { state: 'failed', error: 'apiError.unavailable' },
        ],
    ])('%s', (_case, record, change) => {
        expect(exportChange(record, NOW)).toEqual(change);
    });
});
