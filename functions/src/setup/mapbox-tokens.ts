import { MAPBOX_PUBLIC_SCOPES, MAPBOX_TILES_SCOPES, missingScopes } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { Ports } from '../ports/index.js';
import type { MapboxApi } from '../ports/mapbox-api.js';
import { MAPBOX_FAILURES, MINT_FAILURES, SECRET_FAILURES, upstream, type FailureMap } from './failures.js';

/**
 * The tokens the Setup Assistant mints with the pasted bootstrap token (onboarding review §2B, security review §1.3):
 * the URL-restricted public tokens of the viewer (per city) and of the admin, and the secret tiles token of the
 * pipeline. Each is found again by its stored id or, after a save that stopped half-way, by its note, so saving twice
 * updates the same tokens instead of adding new ones (S-A06-BAD-SAVED-TWICE).
 */
type TokenRecord = Awaited<ReturnType<MapboxApi['listTokens']>>[number];
type TokenCheck = Awaited<ReturnType<MapboxApi['retrieveToken']>>;
export type MintedToken = Awaited<ReturnType<MapboxApi['createToken']>>;

/** The Mapbox account behind a validated bootstrap token, with its tokens (never their values). */
export interface MapboxAccount {
    readonly user: string;
    readonly secretToken: string;
    readonly tokens: readonly TokenRecord[];
}

// The note that names a minted token (M6: shared with `ops.tick`'s re-mint of the viewer's token, through `api/`).
export { tokenNote } from '../api/mapbox-token-note.js';

/** `listTokens` refused: the token cannot read its own account's tokens. */
const LIST_FAILURES: FailureMap = { ...MAPBOX_FAILURES, forbidden: ['apiError.mapbox.missingScopes', { scopes: 'tokens:read' }] };

/**
 * Validates a pasted secret token upstream: `TokenValid` with `usage: 'sk'` (the user is read, never typed), then its
 * own entry in the account's token list must hold every bootstrap scope (listed by name when some are missing).
 */
export async function readAccount(mapbox: MapboxApi, secretToken: string, log: Ports['log']): Promise<MapboxAccount> {
    const check: TokenCheck = await upstream(mapbox.retrieveToken(secretToken), MAPBOX_FAILURES);
    if (check.usage !== 'sk') {
        throw new ApiError('apiError.mapbox.tokenFormat');
    }
    const tokens = await upstream(mapbox.listTokens(check.user, secretToken), LIST_FAILURES);
    const own = tokens.find((token) => token.id === check.tokenId);
    if (own === undefined) {
        log.warn('the pasted mapbox token is not in its account token list yet', { user: check.user });
        throw new ApiError('apiError.mapbox.unavailable');
    }
    const missing = missingScopes(own.scopes);
    if (missing.length > 0) {
        throw new ApiError('apiError.mapbox.missingScopes', { scopes: missing.join(', ') });
    }
    return { user: check.user, secretToken, tokens };
}

interface PublicTokenWish {
    readonly note: string;
    readonly allowedUrls: readonly string[];
    /** The id stored for this token, if any. */
    readonly currentId: string | undefined;
}

/** The public token of a wish: updated in place when it still exists (by id, else by note), else created. */
export function upsertPublicToken(mapbox: MapboxApi, account: MapboxAccount, wish: PublicTokenWish): Promise<MintedToken> {
    const existing =
        account.tokens.find((token) => token.id === wish.currentId) ??
        account.tokens.find((token) => token.usage === 'pk' && token.note === wish.note);
    const request = { note: wish.note, scopes: [...MAPBOX_PUBLIC_SCOPES], allowedUrls: [...wish.allowedUrls] };
    const work =
        existing === undefined
            ? mapbox.createToken(account.user, account.secretToken, request)
            : mapbox.updateToken(account.user, account.secretToken, existing.id, request);
    return upstream(work, MINT_FAILURES);
}

/** Mints a new public token with the same scopes and origins (the panic button: the old id is retired later). */
export function mintPublicToken(
    mapbox: MapboxApi,
    account: Pick<MapboxAccount, 'user' | 'secretToken'>,
    wish: Pick<PublicTokenWish, 'note' | 'allowedUrls'>,
): Promise<MintedToken> {
    const request = { note: wish.note, scopes: [...MAPBOX_PUBLIC_SCOPES], allowedUrls: [...wish.allowedUrls] };
    return upstream(mapbox.createToken(account.user, account.secretToken, request), MINT_FAILURES);
}

type TilesDeps = Pick<Ports, 'mapbox' | 'secrets' | 'log'>;

/** Deletes leftover tiles tokens (an earlier save that stopped before storing one); a failure only leaves a token unused. */
async function deleteLeftovers(deps: TilesDeps, account: MapboxAccount, leftovers: readonly TokenRecord[]): Promise<void> {
    for (const leftover of leftovers) {
        try {
            await deps.mapbox.deleteToken(account.user, account.secretToken, leftover.id);
        } catch (error) {
            deps.log.warn('a leftover mapbox tiles token was not deleted', { id: leftover.id, error: String(error) });
        }
    }
}

/**
 * The secret tiles token (`mapbox-sk-tiles`, the pipeline's MTS token): kept while its id exists and its value is in
 * Secret Manager (a secret token's value cannot be read back), else minted, stored, and any older tiles token of this
 * project deleted.
 */
export async function ensureTilesToken(
    deps: TilesDeps,
    account: MapboxAccount,
    note: string,
    currentId: string | undefined,
): Promise<string> {
    const kept = account.tokens.find((token) => token.usage === 'sk' && token.id === currentId);
    if (kept !== undefined && (await upstream(deps.secrets.read('mapbox-sk-tiles'), SECRET_FAILURES)) !== undefined) {
        return kept.id;
    }
    const minted = await upstream(
        deps.mapbox.createToken(account.user, account.secretToken, { note, scopes: [...MAPBOX_TILES_SCOPES] }),
        MINT_FAILURES,
    );
    await upstream(deps.secrets.write('mapbox-sk-tiles', minted.token), SECRET_FAILURES);
    const leftovers = account.tokens.filter((token) => token.usage === 'sk' && (token.note === note || token.id === currentId));
    await deleteLeftovers(deps, account, leftovers);
    return minted.id;
}
