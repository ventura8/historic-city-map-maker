import type { Readable } from 'node:stream';

/**
 * Mapbox's Uploads API (`api.mapbox.com/uploads/v1`; `docs/research/M7-local-worker.md` §6): the free publish path of a
 * small GeoTIFF (no compute units; 10,000 MB a month free). The file is staged in Mapbox's S3 bucket with the temporary
 * credentials Mapbox hands out (a SigV4-signed `PUT`, streamed, never held in memory), then an upload turns it into a
 * tileset, which is polled until it is complete or ends in an error. Authenticated with the tiles secret token
 * `mapbox-sk-tiles` (`uploads:read`, `uploads:write`; read at run time, never logged), the S3 `PUT` with the temporary
 * credentials only. Adapter: `functions/src/adapters/mapbox-uploads.ts`. Failures are `UpstreamError('mapbox', …)`:
 * `unauthorized`, `forbidden` (a token without the uploads scopes), `notFound`, `invalid`, `rateLimited`, `unavailable`.
 */

/** The temporary S3 credentials of `POST /uploads/v1/{user}/credentials` (valid for about an hour). */
export interface UploadCredentials {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly sessionToken: string;
    readonly bucket: string;
    readonly key: string;
    /** The staged object's HTTPS address: where the file is put, and what the upload names. */
    readonly url: string;
}

/** One file to stage, streamed. */
export interface StagedFile {
    readonly bytes: number;
    readonly contentType: string;
    open(): Promise<Readable>;
}

/** An upload as Mapbox reports it. */
export interface UploadStatus {
    readonly id: string;
    readonly complete: boolean;
    /** Why the upload failed, when it did. */
    readonly error?: string;
    readonly progress: number;
}

/** What an upload makes: the tileset `<user>.<name>` (replaced when it exists and was made by an upload), its name. */
interface UploadRequest {
    readonly tileset: string;
    readonly url: string;
    readonly name: string;
}

export interface MapboxUploads {
    /** `POST /uploads/v1/{user}/credentials`. */
    credentials(user: string, token: string): Promise<UploadCredentials>;
    /** The S3 `PUT` of the file to `credentials.url`, signed (SigV4) with the temporary credentials. */
    stage(credentials: UploadCredentials, file: StagedFile): Promise<void>;
    /** `POST /uploads/v1/{user}`. */
    create(user: string, token: string, request: UploadRequest): Promise<UploadStatus>;
    /** `GET /uploads/v1/{user}/{upload}`. */
    status(user: string, token: string, uploadId: string): Promise<UploadStatus>;
}
