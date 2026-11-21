/**
 * An in-memory `MapboxUploads` of one account (`docs/research/M7-local-worker.md` §6) for the publisher's tests: the
 * credentials (refused with 403 while the tiles token lacks the uploads scopes, as Setup minted it before M7: `scoped`
 * false, the default), the staged files (their bytes counted from the stream), and uploads that answer `outcomes` in
 * order on each status poll (`complete` once they are used up). A complete upload publishes the tileset into the tilesets
 * fake's `recipes`, so its TileJSON answers. Calls are recorded; `recorder.failNext` scripts a failure.
 */
import { UpstreamError } from '../../src/ports/errors.js';
import type { MapboxUploads, UploadStatus } from '../../src/ports/mapbox-uploads.js';
import { PortRecorder, promised } from './recorder.js';

type UploadsMethod = 'credentials' | 'stage' | 'create' | 'status';

/** What one status poll answers. */
export type UploadOutcome = 'processing' | 'complete' | { readonly error: string };

type Recipes = Map<string, { readonly name: string; readonly recipe: Readonly<Record<string, unknown>> }>;

const S3 = 'https://tilestream-tilesets-production.s3.amazonaws.com';

export function createFakeMapboxUploads(recipes: Recipes, user = 'e2e-mapbox', token = 'sk.e2e-tiles-token') {
    const recorder = new PortRecorder<UploadsMethod>();
    const staged = new Map<string, number>();
    const uploads = new Map<string, { readonly tileset: string; readonly name: string }>();
    const outcomes: UploadOutcome[] = [];
    const state = { scoped: false, next: 0 };
    const check = (given: string): void => {
        if (given !== token) {
            throw new UpstreamError('mapbox', 'unauthorized', { status: 401 });
        }
    };
    const answer = (id: string, outcome: UploadOutcome): UploadStatus => {
        if (outcome === 'processing') {
            return { id, complete: false, progress: 0.5 };
        }
        if (outcome === 'complete') {
            const upload = uploads.get(id);
            recipes.set(String(upload?.tileset), { name: String(upload?.name), recipe: { minzoom: 10, maxzoom: 16 } });
            return { id, complete: true, progress: 1 };
        }
        return { id, complete: false, progress: 0, error: outcome.error };
    };
    const port: MapboxUploads = {
        credentials: (owner, given) =>
            promised(() => {
                recorder.enter('credentials', [owner]);
                check(given);
                if (!state.scoped) {
                    throw new UpstreamError('mapbox', 'forbidden', { status: 403 });
                }
                state.next += 1;
                const key = `_pending/${owner}/e2e-upload-key-${String(state.next)}`;
                return {
                    accessKeyId: 'e2e-uploads-access-key-id',
                    secretAccessKey: 'e2e-uploads-secret-access-key',
                    sessionToken: 'e2e-uploads-session-token',
                    bucket: 'tilestream-tilesets-production',
                    key,
                    url: `${S3}/${key}`,
                };
            }),
        stage: async (credentials, file) => {
            recorder.enter('stage', [credentials.url, file.bytes, file.contentType]);
            let bytes = 0;
            for await (const chunk of await file.open()) {
                bytes += (chunk as Uint8Array).length;
            }
            staged.set(credentials.url, bytes);
        },
        create: (owner, given, request) =>
            promised(() => {
                recorder.enter('create', [owner, request]);
                check(given);
                if (!staged.has(request.url)) {
                    throw new UpstreamError('mapbox', 'invalid', { status: 422 });
                }
                const id = `e2e-upload-${String(uploads.size + 1)}`;
                uploads.set(id, { tileset: request.tileset, name: request.name });
                return { id, complete: false, progress: 0 };
            }),
        status: (owner, given, uploadId) =>
            promised(() => {
                recorder.enter('status', [owner, uploadId]);
                check(given);
                if (!uploads.has(uploadId)) {
                    throw new UpstreamError('mapbox', 'notFound', { status: 404 });
                }
                return answer(uploadId, outcomes.shift() ?? 'complete');
            }),
    };
    return {
        uploads: port,
        user,
        staged,
        created: uploads,
        outcomes,
        recorder,
        /** The tiles token carries `uploads:read` and `uploads:write` from now on. */
        grantScopes: () => {
            state.scoped = true;
        },
    };
}
