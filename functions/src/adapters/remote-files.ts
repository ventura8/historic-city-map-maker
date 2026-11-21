/**
 * The address guard (`docs/research/M3-interfaces.md` §8.3; S-A11-BAD-BROWSE-HOST-REFUSED, S-A15-BAD-PRIVATE-ADDRESS):
 * the only way a function fetches an address that came from data (a USGS browse image, a tile to probe).
 *
 * - `https:` on port 443 only, no user information, no IP literal; `allowedHosts`, when given, must list the host;
 * - the host is resolved once (every address) and refused when any address is loopback, private (RFC 1918, `fc00::/7`),
 *   link-local (`169.254.0.0/16`, the metadata server, `fe80::/10`), CGNAT, multicast, reserved or unspecified; the
 *   connection then goes to the checked address (no second resolution, so a rebinding DNS answer cannot redirect it);
 * - no redirect is followed (a 3xx is refused), at most `maxBytes` are read, `timeoutMs` in all, no cookie or credential
 *   is sent, `User-Agent: historic-city-map`.
 *
 * A refusal is `UpstreamError('remote', 'forbidden')` without a status (an HTTP 403 keeps its status); a 404 is
 * `notFound`; a timeout, a network failure or a 5xx `unavailable`. URLs are never logged (a probed Mapbox tile carries
 * the token). In the Functions emulator the guard keeps its address rules and sends the request to the fake upstreams
 * (`createEmulatorFetch`) without a DNS lookup.
 */
import { lookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

import { UpstreamError } from '../ports/errors.js';
import type { RemoteFiles } from '../ports/remote-files.js';
import { failureOfStatus, type Fetch } from './upstream-http.js';

type Limits = Parameters<RemoteFiles['get']>[1];
type RemoteFile = Awaited<ReturnType<RemoteFiles['get']>>;

const SERVICE = 'remote';
const USER_AGENT = 'historic-city-map';

/** One resolved address of a host. */
export interface ResolvedAddress {
    readonly address: string;
    readonly family: 4 | 6;
}

export type Resolver = (host: string) => Promise<readonly ResolvedAddress[]>;

/** One GET of `url` connected to `pinned` (the address the guard checked), within `limits`; never follows a redirect. */
export type PinnedGet = (url: URL, pinned: ResolvedAddress, limits: Limits) => Promise<RemoteFile>;

function refused(): UpstreamError {
    return new UpstreamError(SERVICE, 'forbidden');
}

/** IPv4 ranges a function must never reach: `[network, mask]`. */
const BLOCKED_V4: readonly (readonly [number, number])[] = [
    [0x00_00_00_00, 0xff_00_00_00], // 0.0.0.0/8 "this network"
    [0x0a_00_00_00, 0xff_00_00_00], // 10.0.0.0/8
    [0x64_40_00_00, 0xff_c0_00_00], // 100.64.0.0/10 CGNAT
    [0x7f_00_00_00, 0xff_00_00_00], // 127.0.0.0/8 loopback
    [0xa9_fe_00_00, 0xff_ff_00_00], // 169.254.0.0/16 link-local, the metadata server
    [0xac_10_00_00, 0xff_f0_00_00], // 172.16.0.0/12
    [0xc0_00_00_00, 0xff_ff_ff_00], // 192.0.0.0/24 IETF protocol assignments
    [0xc0_a8_00_00, 0xff_ff_00_00], // 192.168.0.0/16
    [0xc6_12_00_00, 0xff_fe_00_00], // 198.18.0.0/15 benchmarking
    [0xe0_00_00_00, 0xe0_00_00_00], // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved, broadcast included
];

function v4Number(address: string): number {
    return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
}

function blockedV4(address: string): boolean {
    const value = v4Number(address);
    return BLOCKED_V4.some(([network, mask]) => (value & mask) >>> 0 === network);
}

/** IPv6 prefixes a function must never reach (lower-case, as `node:net` and `dns.lookup` spell them). */
const BLOCKED_V6 = [/^::1?$/, /^f[cd][0-9a-f]{0,2}:/, /^fe[89ab][0-9a-f]?:/, /^ff[0-9a-f]{0,2}:/, /^64:ff9b:/];

function blockedV6(address: string): boolean {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower)?.[1];
    return mapped === undefined ? BLOCKED_V6.some((prefix) => prefix.test(lower)) : blockedV4(mapped);
}

/** True for an address no function may connect to (see the module comment). */
export function isBlockedAddress(resolved: ResolvedAddress): boolean {
    return resolved.family === 4 ? blockedV4(resolved.address) : blockedV6(resolved.address);
}

/** https on its own port, without user information. */
function isPlainHttps(url: URL): boolean {
    return url.protocol === 'https:' && ['', '443'].includes(url.port) && url.username === '' && url.password === '';
}

/** A named host (never an IP literal) the caller allows. */
function isAllowedHost(url: URL, allowedHosts: readonly string[] | undefined): boolean {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return isIP(host) === 0 && (allowedHosts === undefined || allowedHosts.includes(host));
}

/** The URL when it is https on port 443 to a named host (no IP, no user information) the caller allows. */
export function checkedUrl(url: string, allowedHosts: readonly string[] | undefined): URL {
    const parsed = URL.parse(url);
    if (parsed === null || !isPlainHttps(parsed) || !isAllowedHost(parsed, allowedHosts)) {
        throw refused();
    }
    return parsed;
}

/** Every address of `host` checked; the first one is where the connection goes. */
export async function pinnedAddress(resolve: Resolver, host: string): Promise<ResolvedAddress> {
    const addresses = await resolve(host).catch(() => {
        throw new UpstreamError(SERVICE, 'unavailable');
    });
    const [first] = addresses;
    if (first === undefined || addresses.some(isBlockedAddress)) {
        throw refused();
    }
    return first;
}

/** The system resolver, every address of the host (`dns.lookup` with `all`). */
export const systemResolver: Resolver = async (host) =>
    (await lookup(host, { all: true, order: 'verbatim' })).map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));

/** A status that is not a 2xx: a redirect is refused (never followed), the others fail as their status says. */
function statusFailure(status: number): UpstreamError {
    return status >= 300 && status < 400 ? refused() : new UpstreamError(SERVICE, failureOfStatus(status), { status });
}

/** Reads a response's chunks up to `maxBytes` (more is `invalid`: the file is not what was asked for). */
async function collect(chunks: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of chunks) {
        total += chunk.length;
        if (total > maxBytes) {
            throw new UpstreamError(SERVICE, 'invalid');
        }
        parts.push(chunk);
    }
    return new Uint8Array(Buffer.concat(parts));
}

async function fileOf(response: IncomingMessage, maxBytes: number): Promise<RemoteFile> {
    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
        response.resume();
        throw statusFailure(status);
    }
    const contentType = response.headers['content-type'] ?? 'application/octet-stream';
    return { status, contentType, bytes: await collect(response, maxBytes) };
}

type HttpsRequest = (url: URL, options: RequestOptions, answer: (response: IncomingMessage) => void) => ClientRequest;

/** Any failure as the port names it: an `UpstreamError` as it is, anything else (a reset, an abort) `unavailable`. */
function asUpstream(error: unknown): UpstreamError {
    return error instanceof UpstreamError ? error : new UpstreamError(SERVICE, 'unavailable');
}

/**
 * `node:https` connected to the checked address (its `lookup` answers only that address); the TLS name stays the host.
 * `timeoutMs` bounds the whole GET, the answer's body included: a server that drips a byte now and then would hold an
 * idle timeout open until the callable's own (CR-M3-47), so one deadline destroys the request.
 */
export function httpsPinnedGet(requestFn: HttpsRequest = httpsRequest): PinnedGet {
    return (url, pinned, limits) => {
        let deadline: NodeJS.Timeout | undefined;
        const answer = new Promise<RemoteFile>((resolve, reject) => {
            const pinnedLookup: RequestOptions['lookup'] = (_host, options, callback) => {
                const all = (options as { readonly all?: boolean }).all === true;
                (callback as (...args: unknown[]) => void)(...(all ? [null, [pinned]] : [null, pinned.address, pinned.family]));
            };
            const options: RequestOptions = {
                method: 'GET',
                headers: { 'user-agent': USER_AGENT, accept: '*/*' },
                lookup: pinnedLookup,
                agent: false,
            };
            const request = requestFn(url, options, (response) => {
                fileOf(response, limits.maxBytes).then(resolve, (error: unknown) => {
                    reject(asUpstream(error));
                });
            });
            deadline = setTimeout(() => request.destroy(new UpstreamError(SERVICE, 'unavailable')), limits.timeoutMs);
            request.on('error', (error) => {
                reject(asUpstream(error));
            });
            request.end();
        });
        return answer.finally(() => {
            clearTimeout(deadline);
        });
    };
}

/** In the Functions emulator: the same GET through the emulator `fetch` (the fake upstreams), without a DNS lookup. */
export function fetchPinnedGet(fetchFn: Fetch): PinnedGet {
    return async (url, _pinned, limits) => {
        const response = await fetchFn(url, {
            method: 'GET',
            redirect: 'manual',
            headers: { 'user-agent': USER_AGENT },
            signal: AbortSignal.timeout(limits.timeoutMs),
        }).catch(() => {
            throw new UpstreamError(SERVICE, 'unavailable');
        });
        if (!response.ok) {
            throw statusFailure(response.status);
        }
        const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
        const bytes = response.body === null ? new Uint8Array(0) : await collect(response.body, limits.maxBytes);
        return { status: response.status, contentType, bytes };
    };
}

interface RemoteFilesOptions {
    readonly get: PinnedGet;
    /** Undefined in the Functions emulator, whose upstreams are loopback fakes. */
    readonly resolve: Resolver | undefined;
}

const LOOPBACK_FAKE: ResolvedAddress = { address: '127.0.0.1', family: 4 };

export function createRemoteFiles(options: RemoteFilesOptions): RemoteFiles {
    return {
        get: async (url, limits) => {
            const checked = checkedUrl(url, limits.allowedHosts);
            const pinned = options.resolve === undefined ? LOOPBACK_FAKE : await pinnedAddress(options.resolve, checked.hostname);
            return options.get(checked, pinned, limits);
        },
    };
}
