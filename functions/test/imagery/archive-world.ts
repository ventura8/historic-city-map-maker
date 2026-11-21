/**
 * M20's test world (`docs/research/M20-import-local.md`): a scanned archive's report (`cities/{city}/archives/{archive}`) with
 * its series in the reference ladder's order, the rights a series may carry, an archive series' job and the version its
 * placement rendered. Every value is a generated test value; the series' names follow the Bucharest archive's.
 */
import {
    FIRESTORE_PATHS,
    archiveDocSchema,
    type ArchiveDoc,
    type ArchiveReport,
    type ArchiveSeries,
    type JobDoc,
    type LayerVersionDoc,
    type Rights,
} from '@hcm/shared';

import { omit } from '../../src/api/objects.js';
import { joinVersion } from './join-world.js';
import { CITY, NOW, at, type ImageryWorld } from './world.js';

export const ARCHIVE = 'ar-0123456789abcdef';
const WORKER = 'w-0123456789abcdef';

export const CLEAR: Rights = { licence: 'PD', state: 'clear', author: 'IGA', year: '1895', sourceLabel: 'Idei Urbane – DocuBucurești' };
export const UNCONFIRMED: Rights = { licence: 'unknown', state: 'needs-confirmation', year: '1977', note: 'Confirm where it came from.' };

/** The series id of the `n`th series (`s-` and 12 hex characters). */
export function seriesIdOf(n: number): string {
    return `s-${n.toString(16).padStart(12, '0')}`;
}

/** One series of the report, the `n`th of the ladder. */
export function archiveSeries(n: number, overrides: Partial<ArchiveSeries> = {}): ArchiveSeries {
    return {
        seriesId: seriesIdOf(n),
        class: 'single',
        title: `Planul ${String(1890 + n)}`,
        year: 1890 + n,
        files: 1,
        bytes: 1000,
        action: 'import',
        encoding: 'grey',
        rights: CLEAR,
        estimate: { maxzoom: 17, tilesBytes: 1000, minutes: 2, auto: 'possible' },
        order: n,
        ...overrides,
    };
}

/** The archive's report as `worker.archiveReport` left it, with `count` series. */
export function archiveDoc(count: number, overrides: Partial<ArchiveDoc> = {}): ArchiveDoc {
    return {
        name: 'harti.zip',
        source: 'zip',
        fileCount: count,
        bytes: count * 1000,
        scannedAt: at(NOW),
        workerId: WORKER,
        series: Array.from({ length: count }, (_, n) => archiveSeries(n)),
        skipped: { 'not-a-map': 2 },
        createdBy: 'u-admin',
        updatedBy: 'u-admin',
        updatedAt: at(NOW),
        ...overrides,
    };
}

export async function seedArchive(world: ImageryWorld, archive: ArchiveDoc): Promise<void> {
    await world.deps.documents.set(FIRESTORE_PATHS.archive(CITY, ARCHIVE), archiveDocSchema, archive);
}

export function readArchive(world: ImageryWorld): Promise<ArchiveDoc | undefined> {
    return world.deps.documents.get(FIRESTORE_PATHS.archive(CITY, ARCHIVE), archiveDocSchema);
}

/** What a grid series' placement measured: within 15 m on 24 blocked checks spread over most of the map. */
export const PLACED: ArchiveReport = {
    method: 'grid',
    encoding: 'lineart',
    paperTransparent: true,
    scaleDenominator: 500,
    checkpointRmseM: 4.2,
    checkpointCount: 24,
    checksDropped: 0,
    measuredPct: 85,
    rivalClean: true,
    residuals: { medianM: 2.1, p95M: 6.4, worst: ['17A3', '29-30cb'] },
};

/** An archive series' version, rendered and waiting for approval (the join golden's render, as a series). */
export function archiveVersion(overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return {
        ...omit(joinVersion(), ['join', 'sensor', 'date']),
        layerId: 'planul-1895',
        jobId: 'ar-1',
        origin: 'archive',
        source: { kind: 'archive', archiveId: ARCHIVE, seriesId: seriesIdOf(1), sheetCount: 124, placedCount: 120 },
        label: { ro: 'Planul IGA 1895' },
        year: 1895,
        archive: PLACED,
        rights: CLEAR,
        ...overrides,
    };
}

/** An archive series' job, waiting for its approval. */
export function archiveJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'archive-series',
        status: 'awaiting_approval',
        waitReason: 'approval',
        params: {
            archiveId: ARCHIVE,
            seriesId: seriesIdOf(1),
            class: 'grid',
            sheets: 124,
            encoding: 'lineart',
            order: 1,
            referenceLayerIds: [],
        },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'planul-1895',
        versionId: 'ar-1',
        runOn: 'local',
        localOnly: true,
        countedAt: at(NOW),
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}
