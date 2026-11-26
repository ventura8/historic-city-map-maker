/**
 * One GET of an outside https address that came from data (a USGS browse image, a tile to probe): the only way a
 * function fetches such an address (docs/research/M3-interfaces.md §8.3). The adapter refuses anything but https on
 * port 443, resolves the host and refuses loopback, private, link-local, multicast and metadata addresses, follows no
 * redirect, stops at `maxBytes` and `timeoutMs`, and sends no credential. A refused address is `UpstreamError('remote',
 * 'forbidden')`; a 404 `notFound`; a timeout or a network failure `unavailable`. Adapter
 * `functions/src/adapters/remote-files.ts` (fn-imagery); in the emulator the address goes to the fake upstreams.
 */
interface RemoteFetchLimits {
    readonly maxBytes: number;
    readonly timeoutMs: number;
    /** When given, the host must be one of these (`ims.cr.usgs.gov` for browse images). */
    readonly allowedHosts?: readonly string[];
}

export interface RemoteFile {
    readonly status: number;
    readonly contentType: string;
    readonly bytes: Uint8Array;
}

export interface RemoteFiles {
    get(url: string, limits: RemoteFetchLimits): Promise<RemoteFile>;
}
