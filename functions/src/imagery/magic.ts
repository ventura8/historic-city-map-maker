/**
 * File types by their first bytes, never by a name or a `Content-Type` an upload or a remote server claims
 * (`docs/research/M3-interfaces.md` §3.4, §8): browse images and probed tiles (JPEG, PNG, WebP) and raster uploads
 * (TIFF and BigTIFF, either byte order).
 */

/** Bytes that must sit at `offset`. */
interface Signature {
    readonly offset: number;
    readonly bytes: readonly number[];
}

const ascii = (text: string): number[] => Array.from(new TextEncoder().encode(text));

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const IMAGE_SIGNATURES: Readonly<Record<ImageType, readonly Signature[]>> = {
    'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
    'image/png': [{ offset: 0, bytes: [0x89, ...ascii('PNG')] }],
    'image/webp': [
        { offset: 0, bytes: ascii('RIFF') },
        { offset: 8, bytes: ascii('WEBP') },
    ],
};

/** `II*\0`, `MM\0*` (TIFF) and `II+\0`, `MM\0+` (BigTIFF). */
const TIFF_SIGNATURES: readonly (readonly number[])[] = [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
    [0x49, 0x49, 0x2b, 0x00],
    [0x4d, 0x4d, 0x00, 0x2b],
];

function matches(bytes: Uint8Array, signature: Signature): boolean {
    return signature.bytes.every((byte, index) => bytes[signature.offset + index] === byte);
}

/** The image type `bytes` start with among `accepted`, or undefined. */
export function imageTypeOf<T extends ImageType>(bytes: Uint8Array, accepted: readonly T[]): T | undefined {
    return accepted.find((type) => IMAGE_SIGNATURES[type].every((signature) => matches(bytes, signature)));
}

/** True when `bytes` start like a TIFF or a BigTIFF file. */
export function isTiff(bytes: Uint8Array): boolean {
    return TIFF_SIGNATURES.some((signature) => matches(bytes, { offset: 0, bytes: signature }));
}
