import { fixtureResponse } from '../api-fixtures/index.js';
import { mapboxAuthorized, type MapboxAnswer, type MapboxState } from './mapbox-state.js';
import { requestObject, route, type Route } from './routes.js';
import { sequence } from './service.js';

/**
 * Mapbox's Uploads API (`docs/research/M7-local-worker.md` §6, the M7 free publish path): temporary credentials of the S3
 * staging bucket (the token needs `uploads:write`: the tiles token Setup minted before M7 holds only the `tilesets:*`
 * scopes, so the publisher falls back to MTS, S-A64-BAD-NO-SCOPE), the SigV4-signed `PUT` of the file (refused without a
 * signature and the session token of handed-out credentials), the upload that makes the tileset from a staged file
 * (refused for a tileset an MTS publish made), and its status: `complete` on the second poll, the tiles then published.
 * The Functions emulator does not forward the S3 host (`functions/src/adapters/emulator-fetch.ts`): the e2e worlds use
 * the tiles token without the scopes.
 */
const S3 = 'https://tilestream-tilesets-production.s3.amazonaws.com';
/** The session token of `mapbox/uploads.credentials.ok` (a generated test value). */
const SESSION = 'e2e-session-e2e-session';

interface StagedUpload {
    readonly user: string;
    readonly tileset: string;
    polls: number;
}

/** The staged objects (by S3 key, with the session token that may write them) and the uploads (by id). */
interface UploadsState {
    readonly tokens: Map<string, string>;
    readonly staged: Set<string>;
    readonly uploads: Map<string, StagedUpload>;
}

function signedFor(request: Parameters<Route['answer']>[0], session: string | undefined): boolean {
    const authorization = request.headers.get('authorization') ?? '';
    return (
        session !== undefined && request.headers.get('x-amz-security-token') === session && authorization.startsWith('AWS4-HMAC-SHA256 ')
    );
}

/** The S3 key of a staging address (`https://<bucket>.s3.amazonaws.com/<key>`), or '' for another address. */
function keyOf(url: unknown): string {
    return typeof url === 'string' && url.startsWith(`${S3}/`) ? url.slice(S3.length + 1) : '';
}

export function uploadRoutes(state: MapboxState): readonly Route[] {
    const uploads: UploadsState = { tokens: new Map(), staged: new Set(), uploads: new Map() };
    const nextKey = sequence('cle2e00uploadkey', 9);
    const nextUpload = sequence('cle2e00upload', 14);
    const credentials: MapboxAnswer = (_request, params) => {
        const uploadKey = nextKey();
        const user = String(params['user']);
        uploads.tokens.set(`_pending/${user}/${uploadKey}`, SESSION);
        return fixtureResponse('mapbox/uploads.credentials.ok', { values: { mapboxUser: user, uploadKey } });
    };
    const stage: Route['answer'] = (request, params) => {
        const key = `_pending/${String(params['user'])}/${String(params['key'])}`;
        if (!signedFor(request, uploads.tokens.get(key))) {
            return fixtureResponse('mapbox/uploads.stage.denied');
        }
        uploads.staged.add(key);
        return fixtureResponse('mapbox/uploads.stage.ok');
    };
    const create: MapboxAnswer = (request, params, owner) => {
        const body = requestObject(request);
        const [tileset, name] = [String(body['tileset']), body['name']];
        if (!uploads.staged.has(keyOf(body['url'])) || typeof name !== 'string') {
            return fixtureResponse('mapbox/error.not-found');
        }
        if (owner.tilesets.get(tileset)?.recipe !== undefined) {
            return fixtureResponse('mapbox/uploads.create.mts-tileset', { values: { tilesetId: tileset } });
        }
        const uploadId = nextUpload();
        uploads.uploads.set(uploadId, { user: String(params['user']), tileset, polls: 0 });
        owner.tilesets.set(tileset, { id: tileset, name, created: new Date().toISOString(), recipe: undefined });
        return fixtureResponse('mapbox/uploads.create.ok', { values: { tilesetId: tileset, uploadId, sourceId: name } });
    };
    const status: MapboxAnswer = (_request, params, owner) => {
        const upload = uploads.uploads.get(String(params['upload']));
        if (upload === undefined || upload.user !== params['user']) {
            return fixtureResponse('mapbox/error.not-found');
        }
        upload.polls += 1;
        const values = { tilesetId: upload.tileset, uploadId: String(params['upload']) };
        const tileset = owner.tilesets.get(upload.tileset);
        if (upload.polls < 2 || tileset === undefined) {
            return fixtureResponse('mapbox/uploads.status.processing', { values });
        }
        tileset.published = { minzoom: 0, maxzoom: 16, jobId: String(params['upload']) };
        return fixtureResponse('mapbox/uploads.status.complete', { values });
    };
    const base = 'https://api.mapbox.com/uploads/v1';
    return [
        route('POST', `${base}/{user}/credentials`, 'mapbox.uploads.credentials', mapboxAuthorized(state, 'uploads:write', credentials)),
        route('PUT', `${S3}/_pending/{user}/{key}`, 'mapbox.uploads.stage', stage),
        route('POST', `${base}/{user}`, 'mapbox.uploads.create', mapboxAuthorized(state, 'uploads:write', create)),
        route('GET', `${base}/{user}/{upload}`, 'mapbox.uploads.status', mapboxAuthorized(state, 'uploads:read', status)),
    ];
}
