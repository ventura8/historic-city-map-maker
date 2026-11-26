import {
    MAPBOX_BOOTSTRAP_SCOPES,
    classifyMapboxToken,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type CityDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { VerifiedCaller } from '../api/access.js';
import type { Ports } from '../ports/index.js';
import { recordFailedAttempt } from './attempts.js';
import { SECRET_FAILURES, upstream } from './failures.js';
import { ensureTilesToken, readAccount, tokenNote, upsertPublicToken, type MapboxAccount, type MintedToken } from './mapbox-tokens.js';
import {
    commitCityAndStatus,
    nextSecretsRev,
    readSetupStatus,
    requireCity,
    stampOf,
    withoutReason,
    type SetupStatusFields,
} from './records.js';
import { toSetupStatusView } from './view.js';

export type SaveMapboxDeps = Pick<Ports, 'documents' | 'secrets' | 'mapbox' | 'clock' | 'config' | 'log'>;

type Request = CallableRequest<'setup.saveMapbox'>;
type Response = CallableResponse<'setup.saveMapbox'>;

interface Minted {
    readonly account: MapboxAccount;
    readonly viewer: MintedToken;
    readonly admin: MintedToken;
    readonly tilesTokenId: string;
}

/** A pasted public token, or anything that is not a secret token, is explained before any call (S-A06-BAD-PUBLIC-TOKEN-PASTED). */
function checkTokenKind(token: string): void {
    const kind = classifyMapboxToken(token);
    if (kind !== 'secret') {
        throw new ApiError(kind === 'public' ? 'apiError.mapbox.publicToken' : 'apiError.mapbox.tokenFormat');
    }
}

/** The public tokens first, then the tiles token: a refused mint stores nothing, not even the bootstrap token (S-A05-BAD-TRIAL). */
async function mintAll(deps: SaveMapboxDeps, request: Request, city: CityDoc): Promise<Minted> {
    const { projectId, viewerOrigins, adminOrigins } = deps.config;
    const account = await readAccount(deps.mapbox, request.secretToken, deps.log);
    const stored = (await readSetupStatus(deps.documents))?.mapbox;
    const viewer = await upsertPublicToken(deps.mapbox, account, {
        note: tokenNote(projectId, 'viewer', request.cityId),
        allowedUrls: viewerOrigins,
        currentId: city.mapbox?.publicTokenId,
    });
    const admin = await upsertPublicToken(deps.mapbox, account, {
        note: tokenNote(projectId, 'admin'),
        allowedUrls: adminOrigins,
        currentId: stored?.adminTokenId,
    });
    const tilesTokenId = await ensureTilesToken(deps, account, tokenNote(projectId, 'tiles'), stored?.tilesTokenId);
    return { account, viewer, admin, tilesTokenId };
}

function mapboxRecord(minted: Minted, deps: SaveMapboxDeps, current: SetupStatusFields): NonNullable<SetupStatusFields['mapbox']> {
    const retiring = current.mapbox?.retiring;
    const record = {
        state: 'ok' as const,
        checkedAt: timestampFromDate(deps.clock.now()),
        user: minted.account.user,
        scopes: [...MAPBOX_BOOTSTRAP_SCOPES],
        tilesTokenId: minted.tilesTokenId,
        adminToken: minted.admin.token,
        adminTokenId: minted.admin.id,
        adminAllowedUrls: [...deps.config.adminOrigins],
    };
    return retiring === undefined ? record : { ...record, retiring };
}

async function connect(deps: SaveMapboxDeps, caller: VerifiedCaller, request: Request, city: CityDoc): Promise<Response> {
    const minted = await mintAll(deps, request, city);
    await upstream(deps.secrets.write('mapbox-sk-bootstrap', request.secretToken), SECRET_FAILURES);
    const written = await commitCityAndStatus(deps.documents, stampOf(caller.uid, deps), request.cityId, {
        city: (current) => ({
            ...current,
            mapbox: {
                user: minted.account.user,
                publicToken: minted.viewer.token,
                publicTokenId: minted.viewer.id,
                allowedUrls: [...deps.config.viewerOrigins],
            },
        }),
        status: (current) => ({ ...current, mapbox: mapboxRecord(minted, deps, current), secretsRev: nextSecretsRev(current) }),
    });
    deps.log.info('mapbox connected', { uid: caller.uid, cityId: request.cityId, user: minted.account.user });
    return {
        mapbox: toSetupStatusView(written.status, deps.clock.now()).mapbox,
        viewer: { tokenId: minted.viewer.id, allowedUrls: [...deps.config.viewerOrigins] },
        admin: { tokenId: minted.admin.id, allowedUrls: [...deps.config.adminOrigins] },
    };
}

/**
 * `setup.saveMapbox` (admin, App Check consumed; M2-interfaces §3.3, onboarding review §2B, scenarios A05, A06): the
 * pasted secret token is checked upstream (valid, secret, every bootstrap scope), the viewer and admin public tokens
 * are updated in place or minted URL-restricted, the tiles token minted once; then the bootstrap token goes to Secret
 * Manager, the viewer token to the city (which queues a manifest rebuild when it is published), the admin token and
 * the health record to `setup/status`, and `secretsRev` is bumped. The secret token never reaches a response, a
 * document or a log line.
 */
export async function saveMapbox(deps: SaveMapboxDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    checkTokenKind(request.secretToken);
    const city = await requireCity(deps.documents, request.cityId);
    try {
        return await connect(deps, caller, request, city);
    } catch (error) {
        await recordFailedAttempt(deps, caller, error, {
            area: 'mapbox',
            apply: (current, failed) => ({
                ...current,
                mapbox: current.mapbox === undefined ? failed : { ...withoutReason(current.mapbox), ...failed },
            }),
        });
        throw error;
    }
}
