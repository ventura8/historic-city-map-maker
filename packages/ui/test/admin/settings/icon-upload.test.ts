/**
 * What the browser tells of a chosen tab icon (`packages/ui/src/admin/settings/icon-upload.ts`; S-A101-BAD-SVG): a PNG or a
 * WebP by its first bytes within 1 MB becomes the request's base64; an SVG (whatever it is called), anything else or a file
 * too big is refused with its reason, and nothing is sent.
 */
import { CITY_ICON_LIMITS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { base64Of, browserProblem, isIconType, readIcon } from '../../../src/admin/settings/icon-upload.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('the browser tab icon: what the browser checks', () => {
    it('happyPath_aPngOrAWebpIsAnIcon', async () => {
        expect([isIconType(PNG), isIconType(WEBP), browserProblem(PNG)]).toEqual([true, true, null]);
        await expect(readIcon(new Blob([PNG], { type: 'image/svg+xml' }))).resolves.toEqual({ image: base64Of(PNG) });
    });

    it.each([
        ['an SVG', SVG],
        ['a RIFF that is not WebP', new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt ')],
        ['nothing', new Uint8Array(0)],
    ])('badPath_%s_isNoIcon @S-A101-BAD-SVG', async (_name, bytes) => {
        expect(browserProblem(bytes)).toEqual({ key: 'apiError.cityIcon.badType' });
        await expect(readIcon(new Blob([bytes], { type: 'image/png' }))).resolves.toEqual({
            problem: { key: 'apiError.cityIcon.badType' },
        });
    });

    it('badPath_aFileOverOneMegabyteIsTooBig', () => {
        const big = new Uint8Array(CITY_ICON_LIMITS.maxBytes + 1);
        big.set(PNG);

        expect(browserProblem(big)).toEqual({ key: 'apiError.cityIcon.tooBig', params: { max: '1 MB' } });
    });

    it('happyPath_base64IsTheBrowsersOwnForAFileLargerThanOneSlice', () => {
        const bytes = new Uint8Array(70_000).map((_, index) => index % 251);

        expect(atob(base64Of(bytes))).toHaveLength(70_000);
        expect(base64Of(new Uint8Array([0xff, 0x00, 0x7f]))).toBe('/wB/');
    });
});
