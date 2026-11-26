/**
 * M20's Import local files as its elements read it (`docs/research/M20-import-local.md` §8), mirroring
 * `packages/admin/src/archive/feed.ts` structurally (`packages/admin/test/app/admin-port.test.ts` checks it at compile time). The
 * elements get their feed from the Imagery area's store (`ImageryIntentsPort.archive`), which the Imagery page they sit on hands
 * them through the app (`ArchiveHostPort`).
 */
import type { ArchiveSeries, HelpItem, JobStatus, JobWaitReason, LayerVersionState } from '@hcm/shared';

import type { LoadStatusPort, StoreFailurePort } from '../area-port.js';
import type { AdminNoticeInputPort } from '../notice-port.js';

/** One scanned archive in the Upload view's list. */
export interface ArchiveRowPort {
    readonly id: string;
    readonly name: string;
    readonly files: number;
    readonly bytes: number;
    readonly series: number;
    readonly imported: boolean;
}

/** The routed archive's report (`#/imagery/archive/<id>`): null `report` once read means not found. */
export interface OpenArchivePort {
    readonly id: string;
    readonly status: LoadStatusPort;
    readonly report: {
        readonly name: string;
        readonly files: number;
        readonly bytes: number;
        readonly series: readonly ArchiveSeries[];
        readonly skipped: readonly (readonly [reason: string, count: number])[];
        readonly imported: boolean;
        /** The series the archive's record names (imported); the others may be imported later (left out, or started over). */
        readonly importedSeries: readonly string[];
    } | null;
}

/** What the owner changed of a series before Import: whether it is imported, its title, its year as typed, who granted its rights. */
export interface SeriesEditPort {
    readonly include: boolean;
    readonly title: string;
    readonly year: string;
    readonly confirmedBy: string | null;
}

/** An imported series as its version and its job say: where it is, why it waits, what it measured. */
export interface SeriesProgressPort {
    readonly versionId: string | null;
    readonly state: LayerVersionState | null;
    readonly jobStatus: JobStatus | null;
    readonly waitReason: JobWaitReason | null;
    readonly step: string | null;
    readonly progress: number | null;
    readonly help: Pick<HelpItem, 'reason' | 'note'> | null;
    /** The blocked checkpoint figure in metres, when the placement measured one. */
    readonly errorM: number | null;
    /** The threshold the approval holds the map to (§5), or null for a map with no scale. */
    readonly thresholdM: number | null;
}

/** Batch 4: the folder or zip on its way to the worker from the admin's tab, then its scan (`packages/admin/src/archive/local-import.ts`). */
export interface LocalImportPort {
    readonly phase: 'idle' | 'upload' | 'scan' | 'done' | 'failed' | 'cancelled';
    readonly percent: number;
    readonly done: number;
    readonly total: number;
    readonly error: string | null;
}

/** One picked file with its path inside the chosen folder (or the zip's name). */
export interface LocalFilePort {
    readonly path: string;
    readonly file: Blob;
}

export interface ArchiveViewPort {
    readonly status: LoadStatusPort;
    readonly failure: StoreFailurePort | null;
    /** A worker of the city was seen within the last three minutes. */
    readonly connected: boolean;
    /** The worker's own import page on this computer, with the city's latitude. */
    readonly importUrl: string;
    readonly archives: readonly ArchiveRowPort[];
    readonly open: OpenArchivePort | null;
    readonly edits: Readonly<Record<string, SeriesEditPort>>;
    readonly progress: Readonly<Record<string, SeriesProgressPort>>;
    readonly importing: boolean;
    readonly result: { readonly today: number; readonly waiting: number } | null;
    readonly refusal: AdminNoticeInputPort | null;
    readonly local: LocalImportPort;
}

interface ArchiveIntentsPort {
    open(archiveId: string | null): void;
    setInclude(seriesId: string, include: boolean): void;
    setTitle(seriesId: string, title: string): void;
    setYear(seriesId: string, year: string): void;
    /** The owner's word on a series' rights: who granted them (permission, clear); empty takes it back. */
    confirmRights(seriesId: string, by: string): void;
    /** One click: every included series' job (`imagery.archiveImport`); true once the server took it. */
    import(): Promise<boolean>;
    retry(): void;
    importLocal(files: readonly LocalFilePort[], source: 'folder' | 'zip', name: string): Promise<void>;
    cancelLocal(): Promise<void>;
}

/** One element's feed: started when it connects, stopped when it goes. */
export interface ArchiveFeedPort {
    readonly state: ArchiveViewPort;
    subscribe(listener: (state: ArchiveViewPort) => void): () => void;
    readonly intents: ArchiveIntentsPort;
    start(): void;
    stop(): void;
}

/** What the elements need of the admin app: the Imagery area's store, which hands out feeds and registers the elements. */
export interface ArchiveHostPort {
    readonly content: {
        readonly imagery: { readonly intents: { archive?(): Promise<ArchiveFeedPort> } } | null;
    };
}
