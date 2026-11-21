/**
 * What the browser tells of a chosen tab icon before sending it (Settings → Browser tab icon, in the card's own chunk): the
 * type from the file's first bytes (never its name or the type the browser guesses: an SVG is neither PNG nor WebP) and the
 * size. `cities.setIcon` checks everything again, the shape included (`docs/research/M2-interfaces.md` → *The city's tab icon*).
 */
import { CITY_ICON_LIMITS } from '@hcm/shared';

import type { AdminNoticeInputPort } from '../notice-port.js';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, at: number, expected: readonly number[]): boolean {
    return expected.every((byte, index) => bytes[at + index] === byte);
}

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

/** PNG or WebP by the file's first bytes. */
export function isIconType(bytes: Uint8Array): boolean {
    return startsWith(bytes, 0, PNG) || (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP')));
}

/** The bytes as standard base64 (`btoa` takes a binary string; built in slices, so a large file never overflows the stack). */
export function base64Of(bytes: Uint8Array): string {
    const slice = 0x8000;
    let binary = '';
    for (let at = 0; at < bytes.length; at += slice) {
        binary += String.fromCharCode(...bytes.subarray(at, at + slice));
    }
    return btoa(binary);
}

/** What the browser can refuse before sending: too big, or not a PNG or WebP. */
export function browserProblem(bytes: Uint8Array): AdminNoticeInputPort | null {
    if (bytes.length > CITY_ICON_LIMITS.maxBytes) {
        return { key: 'apiError.cityIcon.tooBig', params: { max: `${String(CITY_ICON_LIMITS.maxBytes / 1_000_000)} MB` } };
    }
    return isIconType(bytes) ? null : { key: 'apiError.cityIcon.badType' };
}

/** The chosen file as the request's base64, or why the browser refuses it. */
export async function readIcon(file: Blob): Promise<{ readonly image: string } | { readonly problem: AdminNoticeInputPort }> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const problem = browserProblem(bytes);
    return problem === null ? { image: base64Of(bytes) } : { problem };
}
