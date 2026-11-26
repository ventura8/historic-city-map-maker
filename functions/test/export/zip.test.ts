/**
 * The streaming ZIP writer (`functions/src/export/zip.ts`, M5 §5.4): entries in name order, DEFLATE for text and STORE
 * for compressed files, data descriptors, one fixed day, readable by an independent reader; unsafe names, two entries
 * with one name and too many entries throw before anything is written.
 */
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { ZipLimitError, dosDateOf, zipMethodFor, zipStream, type ZipEntry } from '../../src/export/zip.js';
import { unzip } from './unzip.js';

const MADE_AT = new Date('2026-11-02T22:15:00Z');

function entry(name: string, text: string | readonly string[]): ZipEntry {
    const parts = typeof text === 'string' ? [text] : text;
    return { name, method: zipMethodFor(name), body: () => Readable.from(parts.map((part) => Buffer.from(part, 'utf8'))) };
}

async function zipOf(entries: readonly ZipEntry[], madeAt = MADE_AT): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of zipStream(entries, madeAt)) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

describe('zipStream', () => {
    it('happyPath_theEntriesComeOutSortedWhole_andTheirMethodFollowsTheirType', async () => {
        const text = 'Orașul meu '.repeat(500);
        const zip = await zipOf([
            entry('photos/a/web.webp', ['RIFF', 'WEBP-bytes']),
            entry('index.html', text),
            entry('engine/fonts/f.woff2', 'wOF2'),
            entry('city.json', ['{"version":', '1}']),
        ]);

        const files = unzip(zip);

        expect(files.map((file) => file.name)).toEqual(['city.json', 'engine/fonts/f.woff2', 'index.html', 'photos/a/web.webp']);
        expect(files.map((file) => file.bytes.toString('utf8'))).toEqual(['{"version":1}', 'wOF2', text, 'RIFFWEBP-bytes']);
        expect(files.map((file) => file.method)).toEqual([8, 0, 8, 0]);
        // Bit 3 (data descriptor) and bit 11 (UTF-8 names) on every entry; the text deflated well below its size.
        expect(files.every((file) => file.flags === 0x0808)).toBe(true);
        expect(zip.length).toBeLessThan(text.length);
    });

    it('happyPath_everyEntryCarriesTheExportsDayAtMidnight', async () => {
        const files = unzip(await zipOf([entry('README.md', '# x'), entry('RIGHTS.md', '# y')]));

        expect(files.map((file) => file.date)).toEqual([dosDateOf(MADE_AT).date, dosDateOf(MADE_AT).date]);
        expect(dosDateOf(MADE_AT)).toEqual({ time: 0, date: ((2026 - 1980) << 9) | (11 << 5) | 2 });
        expect(dosDateOf(new Date('1970-01-01T00:00:00Z')).date).toBe((0 << 9) | (1 << 5) | 1);
    });

    it('happyPath_anEmptyArchiveAndAnEmptyFileAreValid', async () => {
        expect(unzip(await zipOf([]))).toEqual([]);
        expect(unzip(await zipOf([entry('empty.txt', [])])).map((file) => [file.name, file.bytes.length])).toEqual([['empty.txt', 0]]);
    });

    it('happyPath_twoArchivesOfTheSameFilesOnTheSameDayAreTheSameBytes', async () => {
        const files = () => [entry('b.txt', 'two'), entry('a.txt', 'one')];

        expect(await zipOf(files(), new Date('2026-11-02T01:00:00Z'))).toEqual(await zipOf(files(), new Date('2026-11-02T23:00:00Z')));
    });

    it.each(['/etc/passwd', '../up.txt', 'a/../b.txt', 'a\\b.txt', 'a//b.txt', 'folder/', ''])(
        'badPath_theUnsafeName_%s_throws',
        async (name) => {
            await expect(zipOf([entry(name, 'x')])).rejects.toThrow(RangeError);
        },
    );

    it('badPath_twoEntriesWithOneNameThrow', async () => {
        await expect(zipOf([entry('a.txt', 'one'), entry('a.txt', 'two')])).rejects.toThrow('two zip entries named "a.txt"');
    });

    it('badPath_moreEntriesThanAZipWithoutZip64HoldsThrow', async () => {
        const many = Array.from({ length: 65_536 }, (_, index) => entry(`f${String(index)}.txt`, ''));

        await expect(zipOf(many)).rejects.toBeInstanceOf(ZipLimitError);
    });

    it('badPath_aFailingSourceStopsTheArchive', async () => {
        const failing: ZipEntry = {
            name: 'index.html',
            method: 'deflate',
            body: () =>
                Readable.from(
                    (async function* () {
                        yield Buffer.from('<!doctype html>');
                        await Promise.resolve();
                        throw new Error('the source broke');
                    })(),
                ),
        };

        await expect(zipOf([failing])).rejects.toThrow('the source broke');
    });
});

describe('zipMethodFor', () => {
    it.each([
        ['photos/a/web.webp', 'store'],
        ['rasters/k.TIF', 'store'],
        ['engine/fonts/x.woff2', 'store'],
        ['index.html', 'deflate'],
        ['engine/engine.iife.js', 'deflate'],
        ['README.md', 'deflate'],
    ])('happyPath_%s_is_%s', (name, method) => {
        expect(zipMethodFor(name)).toBe(method);
    });
});
