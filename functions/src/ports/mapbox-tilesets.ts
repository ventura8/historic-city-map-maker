import type { Readable } from 'node:stream';

/**
 * The Mapbox Tilesets API (MTS, `api.mapbox.com/tilesets/v1`) and TileJSON over REST, authenticated with the tiles
 * secret token `mapbox-sk-tiles` (read from Secret Manager at run time, never logged): the publisher's half of
 * `MapboxApi` (CR-M2-15 (a) and docs/research/M3-interfaces.md §7). Adapter: `MapboxTilesetsApi` of
 * `functions/src/adapters/mapbox.ts` (fn-imagery takes it over); the fake: `packages/test-support/src/fakes/mapbox-tilesets.ts`.
 * Failures are `UpstreamError('mapbox', …)`: `unauthorized`, `forbidden` (a missing scope), `notFound`, `rateLimited`
 * (MTS allows about two publishes a minute), `invalid` (a recipe refused), `unavailable`.
 */
interface TilesetSummary {
    /** `<user>.<name>` */
    readonly id: string;
    readonly name?: string;
    /** When it was created (ISO 8601), when Mapbox says. */
    readonly created?: string;
}

/** A publish job of a tileset as listed: its id, its stage and when it was created (epoch milliseconds). */
export interface MtsJobSummary {
    readonly id: string;
    readonly stage: MtsJob['stage'];
    readonly createdAt: number;
}

/** One file to upload, streamed (a city's COG is a few hundred MB: never held in memory). */
interface SourceFile {
    readonly bytes: number;
    readonly contentType: string;
    open(): Promise<Readable>;
}

interface TilesetRequest {
    readonly name: string;
    /** `rasterRecipe(...)` of `@hcm/shared`. */
    readonly recipe: Readonly<Record<string, unknown>>;
    readonly description?: string;
}

/** An MTS job as polled: `tileset_precisions` is the km² processed per precision (the compute-unit calibration). */
export interface MtsJob {
    readonly stage: 'queued' | 'processing' | 'success' | 'failed';
    readonly errors: readonly string[];
    readonly precisions?: Readonly<Record<string, number>>;
}

export interface MapboxTilesets {
    /** `GET /tilesets/v1/{user}?limit=`: the account's tilesets (Studio uploads included). */
    listTilesets(user: string, token: string, limit: number): Promise<readonly TilesetSummary[]>;
    /** `POST /tilesets/v1/sources/{user}/{source}`: replaces the source (a retry is idempotent). */
    uploadSource(user: string, token: string, sourceId: string, file: SourceFile): Promise<{ readonly bytes: number }>;
    /** `POST /tilesets/v1/{tileset}`, or `PATCH /tilesets/v1/{tileset}/recipe` when it exists. */
    upsertTileset(token: string, tilesetId: string, request: TilesetRequest): Promise<'created' | 'updated'>;
    /** `POST /tilesets/v1/{tileset}/publish`. */
    publish(token: string, tilesetId: string): Promise<{ readonly jobId: string }>;
    /** `GET /tilesets/v1/{tileset}/jobs/{job}`. */
    job(token: string, tilesetId: string, jobId: string): Promise<MtsJob>;
    /**
     * `GET /tilesets/v1/{tileset}/jobs?limit=`: the tileset's latest publish jobs, so a publish whose answer was lost finds
     * the job it started instead of starting (and paying for) another one (CR-M3-47).
     */
    listJobs(token: string, tilesetId: string, limit: number): Promise<readonly MtsJobSummary[]>;
    /** `GET /v4/{tileset}.json`: the smoke test after a publish, and the probe of a linked Mapbox tileset. */
    tileJson(token: string, tilesetId: string): Promise<{ readonly minzoom: number; readonly maxzoom: number }>;
    /** `DELETE /tilesets/v1/{tileset}`; deleting a missing one is not an error. */
    deleteTileset(token: string, tilesetId: string): Promise<void>;
    /** `DELETE /tilesets/v1/sources/{user}/{source}`; deleting a missing one is not an error. */
    deleteSource(user: string, token: string, sourceId: string): Promise<void>;
}
