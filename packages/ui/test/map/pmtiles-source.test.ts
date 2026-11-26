import { archiveTileId, pmtilesArchive, rangeResponse, type ArchiveTile } from '@hcm/test-support/pmtiles';
import { afterEach, describe, expect, it, vi } from 'vitest';

import golden from '../../../../pipeline/tests/contracts/pmtiles-archive.json';
import {
    entryFor,
    parseDirectory,
    LEAVES_KEPT,
    PmtilesReader,
    Recent,
    PmtilesRefusal,
    pmtilesSource,
    rangeRequest,
    tileIdOf,
} from '../../src/map/pmtiles-source.js';

/** A 1×1 lossless WebP with alpha, made once by a browser: the real format, decoded for real. */
const WEBP_1X1 = Uint8Array.from(atob('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAEAdQiirUo4CBiOh/AAA='), (char) => char.charCodeAt(0));

const URL_OF_ARCHIVE = 'https://storage.example.org/tiles/kh4.pmtiles?X-Goog-Signature=secret';

interface Served {
    readonly requests: (string | null)[];
    readonly cancelled: () => number;
}

/** The bucket: every read goes through `fetch`, the network boundary, and a `Range` is answered as Cloud Storage does. */
function serve(archive: Uint8Array, respect = true): Served {
    const requests: (string | null)[] = [];
    let cancelled = 0;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
        const range = new Headers(init.headers).get('Range');
        requests.push(range);
        if (!respect) {
            const body = new ReadableStream({
                cancel: () => {
                    cancelled += 1;
                },
            });
            return Promise.resolve(new Response(body, { status: 200 }));
        }
        const answer = rangeResponse(archive, range);
        return Promise.resolve(new Response(answer.body.slice(), { status: answer.status }));
    });
    return { requests, cancelled: () => cancelled };
}

/** The tile's bytes, which the test expects to exist. */
function bytesOf(tile: ArrayBuffer | null): Uint8Array {
    if (tile === null) {
        throw new Error('no such tile');
    }
    return new Uint8Array(tile);
}

function tiles(z: number, count: number, data: Uint8Array = new Uint8Array([1, 2, 3])): ArchiveTile[] {
    return Array.from({ length: count }, (_, index) => ({ z, x: index, y: 0, data }));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the Hilbert id', () => {
    it('happyPath_theSpecificationsFirstIds', () => {
        const ids = [tileIdOf(0, 0, 0), tileIdOf(1, 0, 0), tileIdOf(1, 0, 1), tileIdOf(1, 1, 1), tileIdOf(1, 1, 0), tileIdOf(2, 0, 0)];

        expect(ids).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('happyPath_agreesWithAWriterOfItsOwnAtHighZooms', () => {
        for (const [z, x, y] of [
            [12, 2300, 1480],
            [17, 74_000, 47_000],
            [26, 39_000_000, 25_000_000],
        ] as const) {
            expect(tileIdOf(z, x, y)).toBe(archiveTileId(z, x, y));
        }
    });
});

describe('a directory', () => {
    it('happyPath_itsColumnsAndARunOfTiles', () => {
        // Two entries: id 5 run 2 length 3 at 0, id 7 run 1 length 4 following it; then a look at runs and holes.
        const entries = parseDirectory(new Uint8Array([2, 5, 2, 2, 1, 3, 4, 1, 0]));

        expect(entries).toEqual([
            { id: 5, offset: 0, length: 3, run: 2 },
            { id: 7, offset: 3, length: 4, run: 1 },
        ]);
        expect(entryFor(entries, 6)?.id).toBe(5);
        expect(entryFor(entries, 7)?.id).toBe(7);
    });

    it('badPath_beforeTheFirstOrPastARunIsNoTile', () => {
        const entries = parseDirectory(new Uint8Array([1, 5, 2, 3, 1]));

        expect(entryFor(entries, 4)).toBeNull();
        expect(entryFor(entries, 7)).toBeNull();
    });

    it('happyPath_aLargeOffsetSurvivesPast2To31', () => {
        // 2^32 + 1 as a varint: five bytes.
        const offset = [0x81, 0x80, 0x80, 0x80, 0x10];
        const [entry] = parseDirectory(new Uint8Array([1, 1, 1, 1, ...offset]));

        expect(entry?.offset).toBe(2 ** 32);
    });
});

describe('the reader', () => {
    it('happyPath_aTileIsOneRangeRequestAfterTheHeaderAndAHoleIsNone @S-V32-HAPPY-OWN-TILES', async () => {
        const data = new Uint8Array([9, 8, 7]);
        const { requests } = serve(await pmtilesArchive([{ z: 3, x: 1, y: 2, data }]));
        const reader = new PmtilesReader(URL_OF_ARCHIVE);

        expect(bytesOf(await reader.tile(3, 1, 2))).toEqual(data);
        expect(requests).toHaveLength(2);
        expect(requests[0]).toBe('bytes=0-16383');
        await expect(reader.tile(3, 7, 7)).resolves.toBeNull();
        expect(requests).toHaveLength(2);
    });

    it('happyPath_aLeafDirectoryIsReadOnceWhicheverTileAsks', async () => {
        const { requests } = serve(await pmtilesArchive(tiles(4, 8), { perLeaf: 3 }));
        const reader = new PmtilesReader(URL_OF_ARCHIVE);

        const answers = await Promise.all([reader.tile(4, 0, 0), reader.tile(4, 1, 0)]);
        const after = requests.length;
        await reader.tile(4, 1, 0);

        expect(answers.every((answer) => answer !== null)).toBe(true);
        expect(requests).toHaveLength(after + 1);
        expect(new Set(requests).size).toBeLessThan(requests.length);
    });

    it('badPath_aServerWithoutRangeHasItsBodyCancelledAndIsNotAskedAgain @S-V32-BAD-NO-RANGE', async () => {
        const { requests, cancelled } = serve(new Uint8Array(), false);
        const reader = new PmtilesReader(URL_OF_ARCHIVE);

        await expect(reader.tile(3, 1, 2)).rejects.toBeInstanceOf(PmtilesRefusal);
        await expect(reader.tile(3, 2, 2)).rejects.toThrow('status-200');

        expect(cancelled()).toBe(1);
        expect(requests).toHaveLength(1);
    });

    it('badPath_aFileThatIsNoArchiveIsRefusedAndItsMessageNamesNoAddress', async () => {
        serve(new TextEncoder().encode('PMTiles'));
        const failure = await new PmtilesReader(URL_OF_ARCHIVE).tile(3, 1, 2).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(PmtilesRefusal);
        expect(String(failure)).not.toContain('secret');
        expect((failure as Error).message).toBe('not-pmtiles');
    });

    it('badPath_anUnknownVersionOrCompressionIsRefused', async () => {
        const archive = await pmtilesArchive(tiles(2, 1));
        const version = archive.slice();
        version[7] = 2;
        serve(version);
        await expect(new PmtilesReader(URL_OF_ARCHIVE).tile(2, 0, 0)).rejects.toThrow('not-pmtiles');

        const compression = archive.slice();
        compression[97] = 3;
        serve(compression);
        await expect(new PmtilesReader(URL_OF_ARCHIVE).tile(2, 0, 0)).rejects.toThrow('compression');
    });

    it('badPath_aNetworkFailureIsAskedAgainByTheNextTile', async () => {
        const archive = await pmtilesArchive(tiles(2, 1));
        vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
        const reader = new PmtilesReader(URL_OF_ARCHIVE);
        await expect(reader.tile(2, 0, 0)).rejects.toThrow('Failed to fetch');

        serve(archive);

        await expect(reader.tile(2, 0, 0)).resolves.not.toBeNull();
    });

    it('badPath_aLeafThatFailsIsAskedAgainByTheNextTile', async () => {
        const archive = await pmtilesArchive(tiles(4, 8), { perLeaf: 3 });
        const reader = new PmtilesReader(URL_OF_ARCHIVE);
        serve(archive);
        await reader.tile(4, 0, 0);
        const fresh = new PmtilesReader(URL_OF_ARCHIVE);
        let reads = 0;
        vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
            reads += 1;
            if (reads === 2) {
                return Promise.reject(new TypeError('Failed to fetch'));
            }
            const answer = rangeResponse(archive, new Headers(init.headers).get('Range'));
            return Promise.resolve(new Response(answer.body.slice(), { status: answer.status }));
        });

        await expect(fresh.tile(4, 0, 0)).rejects.toThrow('Failed to fetch');
        await expect(fresh.tile(4, 0, 0)).resolves.not.toBeNull();
    });

    it('happyPath_uncompressedDirectoriesAreReadToo', async () => {
        // Written by hand: a header saying `none`, and the root as bare varints.
        const root = new Uint8Array([1, 1, 1, 2, 1]);
        const archive = new Uint8Array(127 + root.length + 2);
        const view = new DataView(archive.buffer);
        archive.set(new TextEncoder().encode('PMTiles'));
        view.setUint8(7, 3);
        view.setBigUint64(8, 127n, true);
        view.setBigUint64(16, BigInt(root.length), true);
        view.setBigUint64(56, BigInt(127 + root.length), true);
        view.setUint8(97, 1);
        archive.set(root, 127);
        archive.set([5, 6], 127 + root.length);
        serve(archive);

        expect(bytesOf(await new PmtilesReader(URL_OF_ARCHIVE).tile(1, 0, 0))).toEqual(new Uint8Array([5, 6]));
    });

    it('badPath_aLoopOfLeavesEnds', async () => {
        // A root whose leaf points at itself: a broken file ends in "no tile", never in a loop.
        const pointer = new Uint8Array([1, 1, 0, 5, 1]);
        const archive = new Uint8Array(127 + pointer.length);
        const view = new DataView(archive.buffer);
        archive.set(new TextEncoder().encode('PMTiles'));
        view.setUint8(7, 3);
        view.setBigUint64(8, 127n, true);
        view.setBigUint64(16, BigInt(pointer.length), true);
        view.setBigUint64(40, 127n, true);
        view.setUint8(97, 1);
        archive.set(pointer, 127);
        serve(archive);

        await expect(new PmtilesReader(URL_OF_ARCHIVE).tile(1, 0, 0)).resolves.toBeNull();
    });

    it('happyPath_aTilesSignalReachesItsRead', async () => {
        serve(await pmtilesArchive(tiles(2, 1)));
        const seen: (AbortSignal | undefined)[] = [];
        const served = globalThis.fetch;
        vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
            seen.push(init.signal ?? undefined);
            return served(url, init);
        });
        const { signal } = new AbortController();

        await new PmtilesReader(URL_OF_ARCHIVE).tile(2, 0, 0, signal);

        expect(seen).toEqual([undefined, signal]);
    });
});

describe('an archive the pipeline wrote', () => {
    it('happyPath_theViewersReaderReadsItsTiles @S-V32-HAPPY-OWN-TILES', async () => {
        serve(Uint8Array.from(atob(golden.base64), (char) => char.charCodeAt(0)));
        const reader = new PmtilesReader(URL_OF_ARCHIVE);

        for (const { z, x, y, text } of golden.tiles) {
            expect(new TextDecoder().decode(bytesOf(await reader.tile(z, x, y)))).toBe(text);
        }
        await expect(reader.tile(10, 500, 300)).resolves.toBeNull();
    });
});

describe('the source Mapbox GL takes', () => {
    const spec = { minzoom: 2, maxzoom: 4, attribution: 'USGS' };

    it('happyPath_aTileDecodesToAPicture @S-V32-HAPPY-OWN-TILES', async () => {
        serve(await pmtilesArchive([{ z: 3, x: 1, y: 2, data: WEBP_1X1 }]));
        const source = pmtilesSource('hcm-source-a', URL_OF_ARCHIVE, spec);

        const picture = await source.loadTile({ z: 3, x: 1, y: 2 }, { signal: new AbortController().signal });

        expect(picture).toBeInstanceOf(ImageBitmap);
    });

    it('badPath_aHoleIsATransparentPictureNeverNullSoMapboxGlCannotDrawAnOldTileThere @S-V32-BAD-STALE-HOLE', async () => {
        // Mapbox GL 3.34.1 draws a null tile with a texture from its pool and uploads no pixels to it: an earlier tile's picture,
        // of another place and zoom (docs/LESSONS.md). A transparent picture of the tile's size overwrites whatever the texture held.
        const { requests } = serve(await pmtilesArchive([{ z: 3, x: 1, y: 2, data: WEBP_1X1 }]));
        const source = pmtilesSource('hcm-source-a', URL_OF_ARCHIVE, spec);
        const { signal } = new AbortController();
        await source.loadTile({ z: 3, x: 1, y: 2 }, { signal });
        const reads = requests.length;

        const hole = await source.loadTile({ z: 3, x: 0, y: 0 }, { signal });
        const another = await source.loadTile({ z: 3, x: 7, y: 7 }, { signal });

        expect(hole).toBeInstanceOf(ImageData);
        expect(hole).toMatchObject({ width: 256, height: 256 });
        expect((hole as ImageData).data.every((value) => value === 0)).toBe(true);
        expect(another).toBe(hole);
        expect(requests).toHaveLength(reads);
    });

    it('happyPath_itsBoundsAreOptionalAndPassAsRasterSourceFlattensThem', () => {
        // rasters.ts flattens a layer's bounds for every raster source (layers.test.ts); the archive's source keeps them as given.
        const bounds = [25.9, 44.3, 26.3, 44.6];

        expect(pmtilesSource('a', URL_OF_ARCHIVE, { ...spec, bounds })['bounds']).toEqual([25.9, 44.3, 26.3, 44.6]);
        expect(pmtilesSource('a', URL_OF_ARCHIVE, spec)).not.toHaveProperty('bounds');
    });

    it('badPath_aFailedTileRejectsAndMapboxGlReportsItAsTheLayersError @S-V32-BAD-NO-RANGE', async () => {
        serve(new Uint8Array(), false);
        const source = pmtilesSource('a', URL_OF_ARCHIVE, spec);

        await expect(source.loadTile({ z: 3, x: 1, y: 2 }, { signal: new AbortController().signal })).rejects.toBeInstanceOf(
            PmtilesRefusal,
        );
    });
});

describe('a range request', () => {
    it('happyPath_aPublicArchiveGetsOneAddressPerRangeSoTheBrowserRunsThemTogether', () => {
        const first = rangeRequest('https://storage.googleapis.com/b/c/layer.pmtiles', '0-16383');
        const second = rangeRequest('https://storage.googleapis.com/b/c/layer.pmtiles', '16384-20000');

        expect(first.url).toBe('https://storage.googleapis.com/b/c/layer.pmtiles?range=0-16383');
        expect(second.url).not.toBe(first.url);
        expect(first.init.cache).toBeUndefined();
        expect(rangeRequest('https://example.org/a.pmtiles?v=2', '5-9').url).toBe('https://example.org/a.pmtiles?v=2&range=5-9');
    });

    it('badPath_aSignedAddressIsNeverChangedAndSkipsTheCacheInstead', () => {
        const signed = 'https://storage.googleapis.com/b/t.pmtiles?X-Goog-Algorithm=GOOG4&X-Goog-Signature=abc';
        const request = rangeRequest(signed, '0-9');

        expect(request.url).toBe(signed);
        expect(request.init.cache).toBe('no-store');
    });
});

describe('the leaf directories a reader keeps', () => {
    it('happyPath_theMostRecentlyReadStayAndTheOldestAreDropped', () => {
        const recent = new Recent<number, string>(LEAVES_KEPT);
        for (let offset = 0; offset < LEAVES_KEPT; offset += 1) {
            recent.set(offset, `leaf ${String(offset)}`);
        }
        // The first is read again, then two more arrive: the second and third go, the first stays.
        expect(recent.get(0)).toBe('leaf 0');
        recent.set(100, 'leaf 100');
        recent.set(101, 'leaf 101');

        expect(recent.size).toBe(LEAVES_KEPT);
        expect([recent.get(0), recent.get(1), recent.get(2), recent.get(3), recent.get(101)]).toEqual([
            'leaf 0',
            undefined,
            undefined,
            'leaf 3',
            'leaf 101',
        ]);
    });

    it('badPath_aLeafThatFailedIsForgottenAndAMissingOneIsNotThere', () => {
        const recent = new Recent<number, string>(2);
        recent.set(1, 'a');

        expect([recent.delete(1), recent.delete(1), recent.get(1), recent.size]).toEqual([true, false, undefined, 0]);
    });
});
