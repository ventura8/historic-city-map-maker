/**
 * `export.download` (`functions/src/export/download.ts`, M5 §5.5; behaviour A53): a ready export's signed address,
 * fifteen minutes long, saved as `<city>-<day>.zip`; an export not ready, expired or missing is refused, and so is an
 * editor; the address is never logged.
 */
import { EXPORT_LIMITS, FIRESTORE_PATHS, STORAGE_PATHS, cityExportDocSchema, opsGuardDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { exportDownloadFunction } from '../../src/export/download.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, OWNER, exportWorld, seedExport, type ExportWorld } from './world.js';

const EXPORT = 'x-20261102-1';

function download(world: ExportWorld, exportId = EXPORT) {
    return exportDownloadFunction(() => world).run(adminCall({ cityId: CITY, exportId }, OWNER));
}

const READY = {
    state: 'ready' as const,
    bytes: 1234,
    sha256: 'a'.repeat(64),
    finishedAt: timestampFromDate(new Date('2026-11-02T10:01:00Z')),
    expiresAt: timestampFromDate(new Date('2026-11-09T10:01:00Z')),
};

describe('export.download', () => {
    it('happyPath_aReadyExportGetsAFifteenMinuteAddress', async () => {
        const world = exportWorld();
        await seedExport(world, EXPORT, READY);

        const response = await download(world);

        expect(response).toEqual({
            url: `https://storage.googleapis.com/demo-hcm.firebasestorage.app/${STORAGE_PATHS.cityExport(CITY, EXPORT)}?X-Goog-Signature=test`,
            expiresAt: '2026-11-02T10:15:00.000Z',
            fileName: `${CITY}-2026-11-02.zip`,
        });
        expect(world.signer.signed).toEqual([
            {
                bucket: 'private',
                download: {
                    path: STORAGE_PATHS.cityExport(CITY, EXPORT),
                    expiresAt: new Date('2026-11-02T10:15:00.000Z'),
                    fileName: `${CITY}-2026-11-02.zip`,
                },
            },
        ]);
        expect(JSON.stringify(world.recording.records)).not.toContain('X-Goog-Signature');
    });

    it.each([
        ['an export marked expired', { state: 'expired' as const }],
        ['a ready export past its time', { ...READY, expiresAt: timestampFromDate(new Date('2026-11-02T09:59:59Z')) }],
    ])('badPath_%s_isExpired', async (_case, record) => {
        const world = exportWorld();
        await seedExport(world, EXPORT, record);

        const failure = await failureOf(download(world));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.export.expired' } });
        expect(world.signer.signed).toEqual([]);
    });

    it.each(['queued', 'building', 'failed'] as const)('badPath_anExport_%s_isNotReady', async (state) => {
        const world = exportWorld();
        await seedExport(world, EXPORT, state === 'failed' ? { state, error: 'apiError.internal' } : { state });

        await expect(failureOf(download(world))).resolves.toMatchObject({ details: { code: 'apiError.export.notReady' } });
    });

    it('badPath_aMissingExportIsNotFound', async () => {
        const world = exportWorld();

        await expect(failureOf(download(world, 'x-20261102-9'))).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
    });

    it('badPath_anEditorCannotDownload @S-A53-BAD-EDITOR', async () => {
        const world = exportWorld({ projectRole: 'admin', cities: { [CITY]: 'editor' } });
        await seedExport(world, EXPORT, READY);

        const failure = await failureOf(download(world));

        expect(failure).toMatchObject({ code: 'permission-denied', details: { code: 'apiError.city.notOwner' } });
        expect(world.signer.signed).toEqual([]);
    });

    it('badPath_anExportIsSignedAtMostTenTimesADay @S-A53-BAD-DOWNLOAD-LIMIT', async () => {
        // docs/LESSONS.md 246: each address can be shared for fifteen minutes, and the project pays the egress.
        const world = exportWorld();
        await seedExport(world, EXPORT, { ...READY, downloads: { day: '2026-11-01', count: EXPORT_LIMITS.downloadsPerDay } });

        for (let signed = 0; signed < EXPORT_LIMITS.downloadsPerDay; signed += 1) {
            await download(world);
        }
        const failure = await failureOf(download(world));

        expect(failure).toMatchObject({
            code: 'resource-exhausted',
            details: { code: 'apiError.export.downloadLimit', params: { limit: String(EXPORT_LIMITS.downloadsPerDay) } },
        });
        expect(world.signer.signed).toHaveLength(EXPORT_LIMITS.downloadsPerDay);
        await expect(world.documents.get(FIRESTORE_PATHS.cityExport(CITY, EXPORT), cityExportDocSchema)).resolves.toMatchObject({
            downloads: { day: '2026-11-02', count: EXPORT_LIMITS.downloadsPerDay },
        });
        expect(JSON.stringify(world.recording.records)).toContain('"today":10');
    });

    it('badPath_noDownloadWhileTheBudgetGuardIsRed', async () => {
        const world = exportWorld();
        await seedExport(world, EXPORT, READY);
        await world.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            state: 'red',
            updatedBy: 'system:ops',
            updatedAt: timestampFromDate(new Date('2026-11-02T09:00:00Z')),
        });

        await expect(failureOf(download(world))).resolves.toMatchObject({ details: { code: 'apiError.guardPaused' } });
        expect(world.signer.signed).toEqual([]);
    });
});
