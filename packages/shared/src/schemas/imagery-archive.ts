/**
 * M20 (`docs/research/M20-import-local.md`): a local archive of scanned maps, read by the owner's own worker. The worker scans
 * the archive where it lies (nothing is uploaded), groups its files into **series** (a sheet series, an atlas, overlapping
 * pieces or one map) and reports them here (`cities/{city}/archives/{archive}`, `worker.archiveReport`); one Import click
 * (`imagery.archiveImport`) then makes one `archive-series` job per included series, pinned to the owner's computer. The
 * per-file rows stay in the worker's own `archive.json`; host paths and file contents never reach the server.
 *
 * Rights gate publishing, never processing (§7): a series that `needs-confirmation` is imported, calibrated and previewed
 * privately, but nothing publishes it until its owner confirms the licence. A drawn map is held to a threshold scaled to its
 * printed scale (§5, {@link mapThresholdM}), measured on its own extent, never on the city's.
 */
import { z } from 'zod';

import { stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { DEFAULT_MAP_THRESHOLD_MAX_M } from './imagery-settings.js';

export { DEFAULT_MAP_THRESHOLD_MAX_M, MAP_THRESHOLD_MAX_RANGE } from './imagery-settings.js';
import { stitchedSchema } from './imagery-help.js';
import { layoutAnswerSchema } from './imagery-tiles.js';
import { coded, httpsUrlSchema, idSchema, plainText } from './primitives.js';

/** At most this many series in one archive's report (the document stays far below Firestore's 1 MiB). */
export const ARCHIVE_MAX_SERIES = 200;
/** At most this many skipped files' sample paths go up (`archives/{archive}/issues`); the counts cover the rest. */
export const ARCHIVE_ISSUES_MAX = 500;
/** One estimated series' tiles may not exceed this (2 GB): its maximum zoom is lowered until the estimate fits. */
export const ARCHIVE_SERIES_MAX_BYTES = 2_000_000_000;
/** A drawn map is true to about this much paper (classic graphical accuracy 0.2–0.3 mm, three times as tolerance). */
export const MAP_PAPER_TOLERANCE_MM = 1;
/** The oldest year an archive series may name (the scan report; a layer's own year stays `yearSchema`'s). */
export const ARCHIVE_MIN_YEAR = 1500;

/** An archive's id: the worker mints it (`ar-` and 16 hex characters) when the owner picks a folder or a zip. */
export const ARCHIVE_ID_PATTERN = /^ar-[0-9a-f]{16}$/;
/** A series' id within its archive, stable across rescans of the same files. */
export const SERIES_ID_PATTERN = /^s-[0-9a-f]{12}$/;

/** How a series is placed (§3): its own georeference, a sheet grid, an atlas, overlapping pieces, one drawn map, or CAD. */
export const ARCHIVE_SERIES_CLASSES = ['georeferenced', 'grid', 'atlas', 'pieces', 'single', 'cad'] as const;
export type ArchiveSeriesClass = (typeof ARCHIVE_SERIES_CLASSES)[number];

/** Why a file or a series is not imported (§3 d); each is shown in the report with its own sentence. */
export const ARCHIVE_SKIP_REASONS = [
    'not-a-map',
    'not-a-map-page',
    'duplicate-of',
    'twin-of',
    'crop-of',
    'do-not-publish',
    'index-only',
    'too-small',
    'unreadable',
    'pdf-password',
    'needs-cad-export',
    'unsafe-path',
    'too-many-series',
] as const;
export type ArchiveSkipReason = (typeof ARCHIVE_SKIP_REASONS)[number];

/** What the report proposes for a series: import it, or skip it with a reason. */
export const ARCHIVE_ACTIONS = ['import', 'skip'] as const;

/** How a series' tiles are encoded (§6): crisp lossless line art (opaque white paper by default), grey, or colour. */
export const ARCHIVE_ENCODINGS = ['lineart', 'grey', 'colour'] as const;
export type ArchiveEncoding = (typeof ARCHIVE_ENCODINGS)[number];

/** How likely a series calibrates itself (the report's chip): likely, possible, or it needs the owner's points. */
export const ARCHIVE_AUTO_LIKELIHOODS = ['likely', 'possible', 'points'] as const;

/**
 * How a series' layer was placed (§4), the version's `archive.method`; `gcps`: the owner's points. Batch 4 (§5.1): `grid-names`, a grid
 * series placed from its sheets' names and frames whose grid did not prove on the reference: only its owner approves it, by hand.
 */
export const ARCHIVE_PLACE_METHODS = ['embedded', 'grid', 'atlas', 'pieces', 'match', 'gcps', 'grid-names', 'overview'] as const;

/** M20 (§7): the licences a published map layer may carry. */
export const LAYER_LICENSES = ['PD', 'CC0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'permission'] as const;

/**
 * `layers/{layer}.rights` (§7): a drawn map's licence, its author and where its scan came from; plain text only. The manifest does
 * not carry it yet: the engine's bundle has no bytes left for it (`docs/research/M20-import-local.md` §14), and `attribution`
 * carries the same credit line.
 */
export const layerRightsSchema = z.strictObject({
    licence: z.enum(LAYER_LICENSES),
    author: plainText(200).optional(),
    source: z.strictObject({ label: plainText(200), url: httpsUrlSchema.optional() }).optional(),
});

export type LayerRights = z.infer<typeof layerRightsSchema>;

/** A series' licence. `unknown` never publishes. */
export const RIGHTS_LICENCES = [...LAYER_LICENSES, 'unknown'] as const;
/** Where a series' rights stand (§7): free to publish, waiting for the owner's word, or never to be published. */
export const RIGHTS_STATES = ['clear', 'needs-confirmation', 'do-not-publish'] as const;

/**
 * Why an item waits for a person (the owner's standing rule of 2026-11-09: every importer falls back to one guided
 * "Help calibrate" queue). A small record the queue's own design adopts: what is missing, in one line. `layout-check`: the tile layout's
 * verdict is `check` or `poor` (`imagery-tiles.ts`), so the series waits for the tile-import wizard instead of a doubtful mosaic.
 */
export const HELP_REASONS = ['no-path', 'low-confidence', 'frame-not-found', 'no-scale', 'archive-missing', 'layout-check'] as const;

const archiveYearSchema = z.number().int().min(ARCHIVE_MIN_YEAR).max(2100);

/** §7: a series' rights, from the worker's pre-flag rules, then the owner's edits and confirmation. */
export const rightsSchema = z
    .strictObject({
        licence: z.enum(RIGHTS_LICENCES),
        state: z.enum(RIGHTS_STATES),
        author: plainText(200).optional(),
        publisher: plainText(200).optional(),
        /** The work's own date as printed (`1846`, `c. 1900`, `1961–1977`). */
        year: plainText(40),
        sourceLabel: plainText(200).optional(),
        sourceUrl: httpsUrlSchema.optional(),
        watermark: plainText(200).optional(),
        note: plainText(500).optional(),
        /** Who granted the permission, or who confirmed the licence: the owner's own words. */
        confirmedBy: plainText(200).optional(),
        confirmedAt: timestampSchema.optional(),
        /** The original the scan was made from (a library, a museum), its address, and `probable` when that is only likely. */
        original: z
            .strictObject({ label: plainText(200), url: httpsUrlSchema.optional(), probable: z.literal(true).optional() })
            .optional(),
    })
    .refine((rights) => rights.licence !== 'permission' || rights.confirmedBy !== undefined, coded('validation.required', ['confirmedBy']));

export type Rights = z.infer<typeof rightsSchema>;

/** What the scan estimates for a series: its tiles' maximum zoom and bytes, the minutes on a home computer, and its chance. */
const estimateSchema = z.strictObject({
    maxzoom: z.number().int().min(0).max(22),
    tilesBytes: z.number().int().min(0),
    minutes: z.number().min(0),
    auto: z.enum(ARCHIVE_AUTO_LIKELIHOODS),
});

/** One series of the report. */
export const archiveSeriesSchema = z
    .strictObject({
        seriesId: z.string().regex(SERIES_ID_PATTERN),
        class: z.enum(ARCHIVE_SERIES_CLASSES),
        title: plainText(200),
        year: archiveYearSchema,
        /** The years the label shows when the series spans several (`1961–1977`). */
        yearLabel: plainText(40).optional(),
        files: z.number().int().min(1),
        bytes: z.number().int().min(0),
        action: z.enum(ARCHIVE_ACTIONS),
        reason: z.enum(ARCHIVE_SKIP_REASONS).optional(),
        /** A sheet series' edition, when its sheets name one (`_62`, `_64`). */
        edition: plainText(40).optional(),
        /** The printed scale's denominator (`1:500` is 500), when the cartouche or the grid says it. */
        scaleDenominator: z.number().int().min(1).max(100_000_000).optional(),
        encoding: z.enum(ARCHIVE_ENCODINGS),
        rights: rightsSchema,
        estimate: estimateSchema,
        /** The place in the reference ladder (§1.7): series are calibrated, and their jobs created, in this order. */
        order: z.number().int().min(0).max(10_000),
    })
    .refine((series) => series.action === 'import' || series.reason !== undefined, coded('validation.required', ['reason']));

export type ArchiveSeries = z.infer<typeof archiveSeriesSchema>;

/** `cities/{city}/archives/{archive}`: the scan's report, written by `worker.archiveReport` and `imagery.archiveImport` only. */
export const archiveDocSchema = z.strictObject({
    name: plainText(200),
    source: z.enum(['zip', 'folder']),
    fileCount: z.number().int().min(0),
    bytes: z.number().int().min(0),
    scannedAt: timestampSchema,
    workerId: z.string().regex(/^w-[0-9a-f]{16}$/),
    series: z.array(archiveSeriesSchema).max(ARCHIVE_MAX_SERIES),
    /** Files skipped, by reason (every file lands in exactly one series or one reason). */
    skipped: z.partialRecord(z.enum(ARCHIVE_SKIP_REASONS), z.number().int().min(1)),
    /** The jobs `imagery.archiveImport` made, by series. */
    jobs: z.record(z.string().regex(SERIES_ID_PATTERN), idSchema).optional(),
    importedBy: uidSchema.optional(),
    importedAt: timestampSchema.optional(),
    createdBy: uidSchema,
    updatedBy: uidSchema,
    updatedAt: timestampSchema,
});

export type ArchiveDoc = z.infer<typeof archiveDocSchema>;

/** `cities/{city}/archives/{archive}/issues/{n}`: a sample of skipped files, by relative path within the archive. */
export const archiveIssueSchema = z.strictObject({
    path: plainText(500),
    reason: z.enum(ARCHIVE_SKIP_REASONS),
    seriesId: z.string().regex(SERIES_ID_PATTERN).optional(),
    /** The kept file a duplicate, a twin or a crop stands for, also relative. */
    of: plainText(500).optional(),
});

export type ArchiveIssue = z.infer<typeof archiveIssueSchema>;

/** `archive-series`: one series of an archive the worker holds; the sheet list itself is the worker's `archive.json`. */
export const archiveSeriesParamsSchema = z.strictObject({
    archiveId: z.string().regex(ARCHIVE_ID_PATTERN),
    seriesId: z.string().regex(SERIES_ID_PATTERN),
    class: z.enum(ARCHIVE_SERIES_CLASSES),
    sheets: z.number().int().min(1),
    encoding: z.enum(ARCHIVE_ENCODINGS),
    order: z.number().int().min(0).max(10_000),
    gridId: idSchema.optional(),
    referenceLayerIds: z.array(idSchema).max(10),
    edition: plainText(40).optional(),
    scaleDenominator: z.number().int().min(1).max(100_000_000).optional(),
    /** Line art's paper made transparent (§6; the default for line art): false keeps the paper. */
    paperTransparent: z.boolean().optional(),
    /** The deepest zoom the report estimated (the owner's own cap included): the placement renders no deeper. */
    maxzoom: z.number().int().min(0).max(22).optional(),
    /**
     * Locate again on a published archive series with pieces left out of its overview mosaic (`functions/src/imagery/restitch.ts`,
     * DECISIONS §216e): the pipeline lays it on the overview again (`placing/restitch.py`). Only this job type may carry it.
     */
    restitch: z.boolean().optional(),
    /**
     * Fix the tiles (M20 §19.13, `functions/src/imagery/relayout.ts`): the series is laid out again from its sheets and waits for its
     * owner's check in the tile wizard (`layout-check`), seeded with the base's layout, whatever its class placed it by.
     */
    relayout: z.boolean().optional(),
});

export type ArchiveSeriesParams = z.infer<typeof archiveSeriesParamsSchema>;

/** An archive version's `source`: the series it was made from and what became of its sheets. */
export const archiveSourceSchema = z.strictObject({
    kind: z.literal('archive'),
    archiveId: z.string().regex(ARCHIVE_ID_PATTERN),
    seriesId: z.string().regex(SERIES_ID_PATTERN),
    sheetCount: z.number().int().min(1),
    placedCount: z.number().int().min(0).optional(),
    skipped: z.partialRecord(z.enum(ARCHIVE_SKIP_REASONS), z.number().int().min(1)).optional(),
});

/**
 * `layerVersions/{version}.archive`: what the placement measured. A series is many scans, so it has no `scan` and no `georef`
 * (those mean one scan's pixels); the per-sheet residuals stay in the worker's `sheets.json`, summarised here.
 */
export const archiveReportSchema = z.strictObject({
    method: z.enum(ARCHIVE_PLACE_METHODS),
    encoding: z.enum(ARCHIVE_ENCODINGS),
    /** Line art with its paper made transparent (a tiling choice, never a viewer adjustment). */
    paperTransparent: z.boolean(),
    scaleDenominator: z.number().int().min(1).max(100_000_000).optional(),
    /** M15's blocked figure: the error on checks held out in spatial blocks before any fit. */
    checkpointRmseM: z.number().min(0).optional(),
    checkpointCount: z.number().int().min(0),
    checksDropped: z.number().int().min(0),
    /** The share of the map's own extent the agreeing checks span (§5: never the city's). */
    measuredPct: z.number().min(0).max(100),
    /** True when the rival search found no second placement. */
    rivalClean: z.boolean(),
    /** Batch 4: a grid series' seams, the mean correlation of neighbouring sheets' edges (1: every line continues). */
    seamScore: z.number().min(-1).max(1).optional(),
    residuals: z
        .strictObject({
            medianM: z.number().min(0),
            p95M: z.number().min(0),
            worst: z.array(plainText(200)).max(5),
        })
        .optional(),
});

export type ArchiveReport = z.infer<typeof archiveReportSchema>;

/** The owner's standing rule: why an item waits for a person, in one line, for the shared "Help calibrate" queue. */
export const helpItemSchema = z.strictObject({
    reason: z.enum(HELP_REASONS),
    note: plainText(200),
    at: timestampSchema,
    /** M22 (§4.1): the series joined into one picture, which the Help calibrate wizard places. */
    stitched: stitchedSchema.optional(),
    /** The owner's tile layout from the tile-import wizard (`imagery.saveLayout`), which the series' `place` fixes. */
    layoutAnswer: layoutAnswerSchema.optional(),
});

export type HelpItem = z.infer<typeof helpItemSchema>;

/**
 * `cities/{city}/grids/{grid}` (§2.3): a city's sheet grid, learnt once from a series and confirmed by its owner, reused by
 * later imports. Its placement is metres of the grid to EPSG:3857 (a similarity: origin, scale, rotation).
 */
export const gridDocSchema = z.strictObject({
    label: plainText(200),
    grammar: z.enum(['bucharest', 'international-1m', 'row-col', 'owner']),
    cellM: z.number().positive().max(100_000),
    originX: z.number(),
    originY: z.number(),
    scale: z.number().positive(),
    rotationDeg: z.number().min(-180).max(180),
    confirmedBy: uidSchema.optional(),
    confirmedAt: timestampSchema.optional(),
    updatedBy: uidSchema,
    updatedAt: timestampSchema,
});

/**
 * §5, the owner's decision of 2026-11-09: a drawn map at scale 1:`scaleDenominator` is held to 1 mm of its paper, never less
 * than the city's own threshold and never more than `maxM`. A map with no stated or detected scale has no threshold: it
 * never publishes itself.
 */
export function mapThresholdM(
    cityThresholdM: number,
    scaleDenominator: number | undefined,
    maxM: number = DEFAULT_MAP_THRESHOLD_MAX_M,
): number | undefined {
    if (scaleDenominator === undefined) {
        return undefined;
    }
    const paper = (MAP_PAPER_TOLERANCE_MM / 1000) * scaleDenominator;
    return Math.min(Math.max(cityThresholdM, paper), Math.max(cityThresholdM, maxM));
}

/** True when the rights let a series' layer go public: clear, with a licence that publishes. */
export function rightsAllowPublish(rights: Rights | undefined): boolean {
    return rights?.state === 'clear' && rights.licence !== 'unknown';
}

/** "scan: source (watermark)", either half alone, or nothing. */
function scanPart(rights: Rights): string | undefined {
    const scan = rights.sourceLabel === undefined ? 'scan' : `scan: ${rights.sourceLabel}`;
    if (rights.watermark === undefined) {
        return rights.sourceLabel === undefined ? undefined : scan;
    }
    return `${scan} (${rights.watermark})`;
}

/** "original: label" (or "original, probably: label"), or nothing. */
function originalPart(rights: Rights): string | undefined {
    const original = rights.original;
    if (original === undefined) {
        return undefined;
    }
    return `${original.probable === true ? 'original, probably' : 'original'}: ${original.label}`;
}

/** The parts of the credit line, each skipped when absent. */
function creditParts(rights: Rights, title: string): string[] {
    const work = [rights.author, title, rights.year].filter((part) => part !== undefined).join(', ');
    const licence = rights.licence === 'unknown' ? undefined : rights.licence;
    return [work, licence, scanPart(rights), originalPart(rights)].filter((part) => part !== undefined);
}

/** §7: the layer's credit line, "Author, Title, year · licence · scan: source (watermark) · original: label", within 500 characters. */
export function creditLine(rights: Rights, title: string): string {
    return creditParts(rights, title).join(' · ').slice(0, 500);
}

/** The layer's source of a series' scan: its label and address, when the rights name one. */
function layerSourceOf(rights: Rights): LayerRights['source'] {
    if (rights.sourceLabel === undefined) {
        return undefined;
    }
    return rights.sourceUrl === undefined ? { label: rights.sourceLabel } : { label: rights.sourceLabel, url: rights.sourceUrl };
}

/** §7: what the layer keeps of a series' rights (plain text): its licence, author and source; none for a licence that never publishes. */
export function layerRightsOf(rights: Rights): LayerRights | undefined {
    if (rights.licence === 'unknown') {
        return undefined;
    }
    const source = layerSourceOf(rights);
    return {
        licence: rights.licence,
        ...(rights.author === undefined ? {} : { author: rights.author }),
        ...(source === undefined ? {} : { source }),
    };
}

/**
 * `ops/daily` (M20 §1.3): the counted jobs' turnstile. Every transaction that counts a new raster job against today's shares
 * (`imagery.archiveImport`, the daily release of `imagery.tick`) reads and writes it, so two of them never both spend the same
 * room: the later one retries and counts again. Written by the functions only; no client reads it. A factory, so a bundle
 * that never calls it (the engine's) carries none of it.
 */
export const opsDailyDocSchema = () => z.strictObject({ ...stamp });
