/**
 * The address guard (`functions/src/adapters/remote-files.ts`, `docs/research/M3-interfaces.md` §8.3;
 * S-A15-BAD-PRIVATE-ADDRESS): only https on port 443 to a named, allowed host; every resolved address checked against the
 * private, loopback, link-local (metadata), CGNAT, multicast and reserved ranges; the connection pinned to the checked
 * address (a loopback HTTP server stands in for the remote host); no redirect followed; size and time limited.
 */
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createFakeFetch, route, routeTable } from '@hcm/test-support/fakes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    checkedUrl,
    createRemoteFiles,
    fetchPinnedGet,
    httpsPinnedGet,
    isBlockedAddress,
    pinnedAddress,
    systemResolver,
    type PinnedGet,
    type Resolver,
} from '../../src/adapters/remote-files.js';
import { UpstreamError } from '../../src/ports/errors.js';

/** An IPv4 address from its octets, and an IPv6 one from its groups ('' for `::`): built, so no address is a literal. */
function v4(...octets: readonly number[]): string {
    return octets.join('.');
}

function v6(...groups: readonly string[]): string {
    return groups.join(':');
}

const LIMITS = { maxBytes: 64, timeoutMs: 2000 };
const PUBLIC: Resolver = () => Promise.resolve([{ address: v4(93, 184, 215, 14), family: 4 }]);

describe('checkedUrl', () => {
    it.each([
        ['https on its own port', 'https://tiles.example.org/1/2/3.png', undefined],
        ['port 443 named', 'https://tiles.example.org:443/1/2/3.png', undefined],
        ['an allowed host', 'https://ims.cr.usgs.gov/browse/x.jpg', ['ims.cr.usgs.gov']],
    ])('happyPath_accepts_%s', (_case, url, allowed) => {
        expect(checkedUrl(url, allowed).hostname).toBe(new URL(url).hostname);
    });

    it.each([
        ['plain http', 'http://tiles.example.org/x.png', undefined],
        ['another port', 'https://tiles.example.org:8443/x.png', undefined],
        ['user information', 'https://user:secret@tiles.example.org/x.png', undefined],
        ['an IPv4 literal', `https://${v4(10, 0, 0, 1)}/x.png`, undefined],
        ['an IPv6 literal', 'https://[::1]/x.png', undefined],
        ['a host not allowed', 'https://evil.example/browse/x.jpg', ['ims.cr.usgs.gov']],
        ['no URL at all', 'not a url', undefined],
    ])('badPath_refuses_%s @S-A15-BAD-PRIVATE-ADDRESS', (_case, url, allowed) => {
        expect(() => checkedUrl(url, allowed)).toThrow(new UpstreamError('remote', 'forbidden'));
    });
});

describe('isBlockedAddress', () => {
    it.each([
        ['0.0.0.0', 4],
        [v4(10, 1, 2, 3), 4],
        [v4(100, 64, 0, 1), 4],
        ['127.0.0.1', 4],
        [v4(169, 254, 169, 254), 4],
        [v4(172, 16, 5, 4), 4],
        [v4(172, 31, 255, 255), 4],
        [v4(192, 0, 0, 8), 4],
        [v4(192, 168, 1, 1), 4],
        [v4(198, 18, 0, 1), 4],
        [v4(224, 0, 0, 1), 4],
        ['255.255.255.255', 4],
        ['::', 6],
        ['::1', 6],
        [v6('fc00', '', '1'), 6],
        [v6('fd00', 'ec2', '', '254'), 6],
        [v6('fe80', '', '1'), 6],
        [v6('ff02', '', '1'), 6],
        [v6('64', 'ff9b', '', 'a00', '1'), 6],
        [v6('', '', 'ffff', v4(127, 0, 0, 1)), 6],
    ] as const)('badPath_blocks_%s @S-A15-BAD-PRIVATE-ADDRESS', (address, family) => {
        expect(isBlockedAddress({ address, family })).toBe(true);
    });

    it.each([
        [v4(93, 184, 215, 14), 4],
        [v4(172, 32, 0, 1), 4],
        [v4(100, 128, 0, 1), 4],
        [v6('2606', '2800', '220', '1', '', '248'), 6],
        [v6('', '', 'ffff', v4(93, 184, 215, 14)), 6],
    ] as const)('happyPath_allows_%s', (address, family) => {
        expect(isBlockedAddress({ address, family })).toBe(false);
    });
});

describe('pinnedAddress', () => {
    it('happyPath_theFirstOfPublicAddresses', async () => {
        const resolve: Resolver = () =>
            Promise.resolve([
                { address: v4(93, 184, 215, 14), family: 4 },
                { address: v6('2606', '2800', '220', '1', '', '248'), family: 6 },
            ]);

        await expect(pinnedAddress(resolve, 'tiles.example.org')).resolves.toEqual({ address: v4(93, 184, 215, 14), family: 4 });
    });

    it.each([
        [
            'any private answer among public ones',
            [
                { address: v4(93, 184, 215, 14), family: 4 as const },
                { address: v4(10, 0, 0, 5), family: 4 as const },
            ],
        ],
        ['no answer', []],
    ])('badPath_refuses_%s @S-A15-BAD-PRIVATE-ADDRESS', async (_case, addresses) => {
        await expect(pinnedAddress(() => Promise.resolve(addresses), 'rebind.example')).rejects.toEqual(
            new UpstreamError('remote', 'forbidden'),
        );
    });

    it('badPath_aFailedLookupIsUnavailable', async () => {
        await expect(pinnedAddress(() => Promise.reject(new Error('ENOTFOUND')), 'nowhere.example')).rejects.toEqual(
            new UpstreamError('remote', 'unavailable'),
        );
    });

    it('happyPath_theSystemResolverFindsLocalhostWithoutTheNetwork', async () => {
        const addresses = await systemResolver('localhost');

        expect(addresses.length).toBeGreaterThan(0);
        expect(addresses.every(isBlockedAddress)).toBe(true);
    });
});

describe('createRemoteFiles', () => {
    it('happyPath_theGetGoesToTheCheckedAddress', async () => {
        const calls: unknown[] = [];
        const get: PinnedGet = (url, pinned, limits) => {
            calls.push([url.toString(), pinned, limits]);
            return Promise.resolve({ status: 200, contentType: 'image/png', bytes: new Uint8Array([1]) });
        };
        const remote = createRemoteFiles({ get, resolve: PUBLIC });

        await expect(remote.get('https://tiles.example.org/1.png', LIMITS)).resolves.toMatchObject({ status: 200 });
        expect(calls).toEqual([['https://tiles.example.org/1.png', { address: v4(93, 184, 215, 14), family: 4 }, LIMITS]]);
    });

    it('badPath_aHostResolvingToThePrivateNetworkIsNeverAsked @S-A15-BAD-PRIVATE-ADDRESS', async () => {
        const calls: unknown[] = [];
        const remote = createRemoteFiles({
            get: (url) => {
                calls.push(url);
                return Promise.reject(new Error('never'));
            },
            resolve: () => Promise.resolve([{ address: v4(169, 254, 169, 254), family: 4 }]),
        });

        await expect(remote.get('https://metadata.example/computeMetadata/v1/', LIMITS)).rejects.toEqual(
            new UpstreamError('remote', 'forbidden'),
        );
        expect(calls).toEqual([]);
    });
});

describe('httpsPinnedGet over a loopback server', () => {
    let server: Server;
    let port: number;

    beforeAll(async () => {
        server = createServer((request, response) => {
            const answers: Record<string, () => void> = {
                '/tile.png': () => response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
                '/plain': () => response.writeHead(200).end('x'),
                '/moved': () => response.writeHead(302, { location: 'http://127.0.0.1/' }).end(),
                '/missing': () => response.writeHead(404).end(),
                '/broken': () => response.writeHead(503).end(),
                '/large': () => response.writeHead(200).end(Buffer.alloc(100)),
                '/slow': () => undefined,
                // A server that drips a byte every 20 ms: each chunk would reset an idle timeout (CR-M3-47).
                '/drip': () => {
                    response.writeHead(200, { 'content-type': 'image/png' });
                    const timer = setInterval(() => response.write(Buffer.from([0])), 20);
                    response.on('close', () => {
                        clearInterval(timer);
                    });
                },
            };
            (answers[String(request.url)] ?? answers['/missing'])?.();
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    });

    /** The production GET with node:http instead of node:https, to a host name the pinned lookup sends to the server. */
    function get(path: string, limits = LIMITS) {
        const pinnedGet = httpsPinnedGet(httpRequest);
        return pinnedGet(new URL(`http://tiles.example.org:${String(port)}${path}`), { address: '127.0.0.1', family: 4 }, limits);
    }

    it('happyPath_aTileComesFromThePinnedAddressNotFromTheHostsDns', async () => {
        await expect(get('/tile.png')).resolves.toEqual({
            status: 200,
            contentType: 'image/png',
            bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        });
        await expect(get('/plain')).resolves.toMatchObject({ contentType: 'application/octet-stream' });
    });

    it.each([
        ['a redirect, never followed', '/moved', new UpstreamError('remote', 'forbidden')],
        ['a 404', '/missing', new UpstreamError('remote', 'notFound', { status: 404 })],
        ['a 5xx', '/broken', new UpstreamError('remote', 'unavailable', { status: 503 })],
        ['more than the limit', '/large', new UpstreamError('remote', 'invalid')],
    ])('badPath_fails_%s', async (_case, path, error) => {
        await expect(get(path)).rejects.toEqual(error);
    });

    it('badPath_noAnswerInTimeIsUnavailable', async () => {
        await expect(get('/slow', { maxBytes: 64, timeoutMs: 50 })).rejects.toEqual(new UpstreamError('remote', 'unavailable'));
    });

    it('badPath_aServerThatDripsBytesIsCutAtTheTotalTimeout', async () => {
        await expect(get('/drip', { maxBytes: 4096, timeoutMs: 150 })).rejects.toEqual(new UpstreamError('remote', 'unavailable'));
    });

    it('badPath_aRefusedConnectionIsUnavailable', async () => {
        const pinnedGet = httpsPinnedGet(httpRequest);

        await expect(pinnedGet(new URL('http://tiles.example.org:1/x'), { address: '127.0.0.1', family: 4 }, LIMITS)).rejects.toEqual(
            new UpstreamError('remote', 'unavailable'),
        );
    });

    it('happyPath_theLookupAnswersBothWaysNodeAsks', () => {
        const options: { lookup?: (host: string, opts: unknown, callback: (...args: unknown[]) => void) => void } = {};
        const pinnedGet = httpsPinnedGet(((_url: URL, requestOptions: typeof options) => {
            Object.assign(options, requestOptions);
            return httpRequest('http://127.0.0.1:1/');
        }) as unknown as Parameters<typeof httpsPinnedGet>[0]);
        void pinnedGet(new URL('https://tiles.example.org/x'), { address: v4(93, 184, 215, 14), family: 4 }, LIMITS).catch(() => undefined);
        const answers: unknown[] = [];

        options.lookup?.('tiles.example.org', { all: true }, (...args) => answers.push(args));
        options.lookup?.('tiles.example.org', {}, (...args) => answers.push(args));

        expect(answers).toEqual([
            [null, [{ address: v4(93, 184, 215, 14), family: 4 }]],
            [null, v4(93, 184, 215, 14), 4],
        ]);
    });
});

describe('fetchPinnedGet (the Functions emulator)', () => {
    function emulator(answer: () => Response) {
        const upstream = createFakeFetch(routeTable([route('GET', 'https://ims.cr.usgs.gov/browse/{file}', 'usgs.browse', answer)]));
        return { upstream, remote: createRemoteFiles({ get: fetchPinnedGet(upstream.fetch), resolve: undefined }) };
    }

    it('happyPath_theFakeUpstreamAnswersWithoutADnsLookup', async () => {
        const { upstream, remote } = emulator(
            () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } }),
        );

        await expect(remote.get('https://ims.cr.usgs.gov/browse/x.jpg', LIMITS)).resolves.toEqual({
            status: 200,
            contentType: 'image/jpeg',
            bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        });
        expect(upstream.calls[0]?.headers).toMatchObject({ 'user-agent': 'historic-city-map' });
    });

    it.each([
        [
            'a redirect',
            () => new Response(null, { status: 301, headers: { location: 'https://evil.example/' } }),
            new UpstreamError('remote', 'forbidden'),
        ],
        ['a 404', () => new Response(null, { status: 404 }), new UpstreamError('remote', 'notFound', { status: 404 })],
    ])('badPath_fails_%s', async (_case, answer, error) => {
        await expect(emulator(answer).remote.get('https://ims.cr.usgs.gov/browse/x.jpg', LIMITS)).rejects.toEqual(error);
    });

    it('happyPath_anEmptyAnswerHasNoBytes', async () => {
        await expect(
            emulator(() => new Response(null, { status: 204 })).remote.get('https://ims.cr.usgs.gov/browse/x.jpg', LIMITS),
        ).resolves.toEqual({
            status: 204,
            contentType: 'application/octet-stream',
            bytes: new Uint8Array(0),
        });
    });

    it('badPath_anAddressNoFakeAnswersIsUnavailable', async () => {
        await expect(emulator(() => new Response(null)).remote.get('https://elsewhere.example/x', LIMITS)).rejects.toEqual(
            new UpstreamError('remote', 'unavailable'),
        );
    });
});
