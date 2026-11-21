/** `GET /tokens/v2?access_token=<token>`: whose token it is and what kind (`code: TokenValid` only). */
interface MapboxTokenCheck {
    readonly user: string;
    readonly usage: 'pk' | 'sk' | 'tk';
    /** The token's id (`authorization`), the key of `listTokens`. */
    readonly tokenId: string;
}

/** One token of `GET /tokens/v2/{user}` (never its value). */
interface MapboxTokenRecord {
    readonly id: string;
    readonly usage: 'pk' | 'sk' | 'tk';
    readonly note: string;
    readonly scopes: readonly string[];
    readonly allowedUrls?: readonly string[];
}

interface MapboxTokenRequest {
    readonly note: string;
    readonly scopes: readonly string[];
    /** https origins only (security review §1.3); absent for secret tokens. */
    readonly allowedUrls?: readonly string[];
}

/** A token Mapbox has just created or updated: the only moment its value is visible. */
interface MintedMapboxToken {
    readonly id: string;
    readonly token: string;
}

/**
 * The Mapbox Tokens API (`api.mapbox.com/tokens/v2`) over REST with `fetch`, authenticated with the bootstrap secret
 * token `secretToken` (read from Secret Manager, never logged). Adapter `functions/src/adapters/mapbox.ts` (fn-setup);
 * failures are `UpstreamError`s (`unauthorized` for 401 or a `TokenInvalid` code, `forbidden` for a missing scope,
 * `invalid` for 422, `rateLimited`, `unavailable`). The tilesets calls of the publisher join in M3.
 */
export interface MapboxApi {
    retrieveToken(token: string): Promise<MapboxTokenCheck>;
    listTokens(user: string, secretToken: string): Promise<readonly MapboxTokenRecord[]>;
    createToken(user: string, secretToken: string, request: MapboxTokenRequest): Promise<MintedMapboxToken>;
    updateToken(user: string, secretToken: string, tokenId: string, request: MapboxTokenRequest): Promise<MintedMapboxToken>;
    /** Deleting a missing token is not an error. */
    deleteToken(user: string, secretToken: string, tokenId: string): Promise<void>;
}
