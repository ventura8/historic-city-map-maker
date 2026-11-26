/**
 * USGS M2M (EarthExplorer machine-to-machine, `m2m.cr.usgs.gov/api/api/json/stable/`) over REST with `fetch`. Adapter
 * `functions/src/adapters/usgs.ts` (fn-setup): it parses the body on every status (JSON errors arrive as HTTP 500 with
 * an `errorCode`) and throws `UpstreamError` `unauthorized` (HTML 403, `AUTH_INVALID`), `maintenance` (HTML 503
 * "Application Offline"), `rateLimited` (`RATE_LIMIT`, 429), `unavailable`, `invalid` (another `errorCode`). Scene
 * search and downloads join in M3.
 */
export interface UsgsApi {
    /** `login-token`: exchanges the ERS username and application token for a two-hour API key. */
    login(username: string, applicationToken: string): Promise<string>;
    /** `permissions`: the roles of the authenticated user (`USGS_DOWNLOAD_PERMISSION` once M2M access is approved). */
    permissions(apiKey: string): Promise<readonly string[]>;
    /** `logout`, in a `finally` after every use; never throws. */
    logout(apiKey: string): Promise<void>;
    /**
     * M7 (`docs/research/M7-local-worker.md` §2.5): one M2M call made for a local worker, its `data` as USGS sent it. The
     * caller checks the endpoint and the payload first (`worker.urls`); the same failures as every call.
     */
    request(apiKey: string, endpoint: string, payload: Readonly<Record<string, unknown>>): Promise<unknown>;
}
