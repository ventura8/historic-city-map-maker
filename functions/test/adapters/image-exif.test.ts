/**
 * The EXIF reader of the image adapter: the fields `photos.onUpload` uses, from EXIF that sharp writes and from TIFF
 * blocks built here byte by byte (big-endian, broken offsets, wrong types), because EXIF is attacker-controlled and
 * a broken field must be skipped, never thrown.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { readExif } from '../../src/adapters/image-exif.js';
import { jpeg } from '../photos/images.js';

type Order = 'II' | 'MM';

interface Field {
    readonly tag: number;
    readonly type: number;
    readonly count: number;
    readonly bytes: (little: boolean) => number[];
    /** A pointer field: the IFD it points to, written after this one. */
    readonly child?: readonly Field[];
}

function u16(value: number, little: boolean): number[] {
    return little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff];
}

function u32(value: number, little: boolean): number[] {
    const bytes = [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    return little ? bytes.reverse() : bytes;
}

const ascii = (tag: number, text: string): Field => ({
    tag,
    type: 2,
    count: text.length + 1,
    bytes: () => [...Buffer.from(text, 'latin1'), 0],
});

const rationals = (tag: number, pairs: readonly (readonly [number, number])[]): Field => ({
    tag,
    type: 5,
    count: pairs.length,
    bytes: (little) => pairs.flatMap(([numerator, denominator]) => [...u32(numerator, little), ...u32(denominator, little)]),
});

const short = (tag: number, value: number): Field => ({ tag, type: 3, count: 1, bytes: (little) => u16(value, little) });

const pointer = (tag: number, child: readonly Field[], type = 4): Field => ({
    tag,
    type,
    count: 1,
    bytes: (little) => u32(0, little),
    child,
});

/** A TIFF block (`II*\0` or `MM\0*`), IFD0 at offset 8, values over four bytes after their IFD, child IFDs after that. */
function tiff(order: Order, fields: readonly Field[], prefix = true): Uint8Array {
    const little = order === 'II';
    const bytes: number[] = [...Buffer.from(order, 'ascii'), ...u16(42, little), ...u32(8, little)];
    const writeIfd = (ifd: readonly Field[]): number => {
        const start = bytes.length;
        let data = start + 2 + ifd.length * 12 + 4;
        const patches: { readonly at: number; readonly child: readonly Field[] }[] = [];
        const values: number[] = [];
        bytes.push(...u16(ifd.length, little));
        for (const field of ifd) {
            const value = field.bytes(little);
            bytes.push(...u16(field.tag, little), ...u16(field.type, little), ...u32(field.count, little));
            if (field.child !== undefined) {
                patches.push({ at: bytes.length, child: field.child });
            }
            bytes.push(...(value.length <= 4 ? [...value, 0, 0, 0, 0].slice(0, 4) : u32(data, little)));
            if (value.length > 4) {
                values.push(...value);
                data += value.length;
            }
        }
        bytes.push(...u32(0, little), ...values);
        for (const patch of patches) {
            const offset = writeIfd(patch.child);
            bytes.splice(patch.at, 4, ...u32(offset, little));
        }
        return start;
    };
    writeIfd(fields);
    const block = new Uint8Array(bytes);
    return prefix ? new Uint8Array([...Buffer.from('Exif\0\0', 'latin1'), ...block]) : block;
}

const GPS = 0x8825;
const EXIF = 0x8769;
const LAT = [
    [44, 1],
    [25, 1],
    [3000, 100],
] as const;
const LNG = [
    [26, 1],
    [5, 1],
    [0, 1],
] as const;

describe('readExif from sharp', () => {
    it('happyPath_readsCameraDescriptionDatePositionAndDirection', async () => {
        const image = await jpeg(16, 16, {
            make: 'TestCam',
            description: 'Calea Victoriei',
            dateTimeOriginal: '1936:07:01 10:00:00',
            gps: { lat: '44/1 25/1 3000/100', latRef: 'N', lng: '26/1 5/1 0/1', lngRef: 'E' },
            direction: '2012/10',
        });

        const exif = readExif((await sharp(image).metadata()).exif);

        expect(exif).toEqual({
            make: 'TestCam',
            model: 'M1',
            imageDescription: 'Calea Victoriei',
            artist: 'Someone',
            dateTimeOriginal: '1936:07:01 10:00:00',
            gps: { lat: 44 + 25 / 60 + 30 / 3600, lng: 26 + 5 / 60 },
            direction: 201.2,
        });
    });

    it('happyPath_southAndWestAreNegative', async () => {
        const image = await jpeg(16, 16, { gps: { lat: '33/1 52/1 0/1', latRef: 'S', lng: '151/1 12/1 0/1', lngRef: 'W' } });

        expect(readExif((await sharp(image).metadata()).exif).gps).toEqual({ lat: -(33 + 52 / 60), lng: -(151 + 12 / 60) });
    });

    it('badPath_noExifGivesAnEmptySummary', async () => {
        expect(readExif((await sharp(await jpeg(8, 8)).metadata()).exif)).toEqual({});
        expect(readExif(undefined)).toEqual({});
    });
});

describe('readExif from hand-made TIFF blocks', () => {
    it('happyPath_bigEndianWithoutThePrefix', () => {
        const block = tiff(
            'MM',
            [ascii(0x010f, 'BigEndianCam'), pointer(GPS, [ascii(1, 'N'), rationals(2, LAT), ascii(3, 'E'), rationals(4, LNG)])],
            false,
        );

        expect(readExif(block)).toEqual({ make: 'BigEndianCam', gps: { lat: 44 + 25 / 60 + 30 / 3600, lng: 26 + 5 / 60 } });
    });

    it('happyPath_theOriginalDateComesFromTheExifIfd', () => {
        expect(readExif(tiff('II', [pointer(EXIF, [ascii(0x9003, '1955:01:02 03:04:05')])]))).toEqual({
            dateTimeOriginal: '1955:01:02 03:04:05',
        });
    });

    it('badPath_controlCharactersBecomeSpacesAndLongTextIsCut', () => {
        const exif = readExif(
            tiff('II', [
                ascii(0x010e, 'line\u0001one\n\ttwo\u007f'),
                ascii(0x013b, 'x'.repeat(700)),
                ascii(0x010f, '\u0000\u0000\u0000\u0000\u0000'),
            ]),
        );

        expect(exif).toEqual({ imageDescription: 'line one two', artist: 'x'.repeat(500) });
    });

    it.each([
        [
            'no fix (0, 0)',
            [
                ascii(1, 'N'),
                rationals(2, [
                    [0, 1],
                    [0, 1],
                    [0, 1],
                ]),
                ascii(3, 'E'),
                rationals(4, [
                    [0, 1],
                    [0, 1],
                    [0, 1],
                ]),
            ],
        ],
        [
            'a latitude past the pole',
            [
                ascii(1, 'N'),
                rationals(2, [
                    [95, 1],
                    [0, 1],
                    [0, 1],
                ]),
                ascii(3, 'E'),
                rationals(4, LNG),
            ],
        ],
        [
            'a longitude past 180',
            [
                ascii(1, 'N'),
                rationals(2, LAT),
                ascii(3, 'E'),
                rationals(4, [
                    [181, 1],
                    [0, 1],
                    [0, 1],
                ]),
            ],
        ],
        [
            'two values instead of three',
            [
                ascii(1, 'N'),
                rationals(2, [
                    [44, 1],
                    [25, 1],
                ]),
                ascii(3, 'E'),
                rationals(4, LNG),
            ],
        ],
        [
            'a zero denominator',
            [
                ascii(1, 'N'),
                rationals(2, LAT),
                ascii(3, 'E'),
                rationals(4, [
                    [26, 0],
                    [5, 1],
                    [0, 1],
                ]),
            ],
        ],
        ['no longitude', [ascii(1, 'N'), rationals(2, LAT)]],
        ['a direction past 360', [rationals(0x11, [[400, 1]])]],
    ] as const)('badPath_%s_isLeftOut', (_name, gpsFields) => {
        expect(readExif(tiff('II', [ascii(0x010f, 'Cam'), pointer(GPS, gpsFields)]))).toEqual({ make: 'Cam' });
    });
});

describe('readExif from broken TIFF blocks', () => {
    it('badPath_fieldsOfTheWrongTypeAreSkipped', () => {
        const block = tiff('II', [short(0x010f, 7), ascii(0x0110, 'Model'), pointer(GPS, [ascii(2, 'not rationals'), short(0x11, 90)], 3)]);

        expect(readExif(block)).toEqual({ model: 'Model' });
    });

    it('badPath_anUnknownTypeOrAnOffsetOutsideTheBlockIsSkipped', () => {
        const unknown: Field = { tag: 0x010f, type: 99, count: 1, bytes: () => [1, 2, 3, 4] };
        const block = tiff('II', [unknown, ascii(0x0110, 'a model name'), ascii(0x013b, 'kept')]);
        const outside = new DataView(block.buffer, block.byteOffset + 6);
        outside.setUint32(8 + 2 + 12 + 8, 60_000, true);

        expect(readExif(block)).toEqual({ artist: 'kept' });
    });

    it('badPath_anIfdThatClaimsMoreEntriesThanTheBlockHoldsStopsAtTheEnd', () => {
        const block = tiff('II', [ascii(0x010f, 'Cam')]);
        new DataView(block.buffer, block.byteOffset + 6).setUint16(8, 40, true);

        expect(readExif(block)).toEqual({ make: 'Cam' });
    });

    it.each([
        ['not TIFF at all', new TextEncoder().encode('Exif\0\0not a tiff header at all')],
        ['a wrong magic number', new Uint8Array([0x49, 0x49, 0x2b, 0x00, 8, 0, 0, 0, 0, 0])],
        ['an unknown byte order', new Uint8Array([0x41, 0x41, 0x2a, 0x00, 8, 0, 0, 0, 0, 0])],
        ['a block too short for a header', new Uint8Array([0x49, 0x49, 0x2a])],
        ['an IFD0 offset outside the block', new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0xff, 0xff, 0, 0])],
    ])('badPath_%s_givesAnEmptySummary', (_name, block) => {
        expect(readExif(block)).toEqual({});
    });
});
