/**
 * The map's tab icon (`packages/shared/src/kit/map-icon.ts`): the SVG of the Layers panel's map glyph on a square of the
 * city's colour, refused for anything but `#RRGGBB` and an icon's size; the default inlined as a PNG; the upload's
 * request and the icon's paths. The pixels are compared with sharp in `functions/test/cities/map-icon.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { CITY_ICON_LIMITS, cityIconRequestSchema } from '../../src/api/city-icon.js';
import {
    DEFAULT_FAVICON_DATA_URL,
    DEFAULT_ICON_VARIANTS,
    DEFAULT_TAB_ICONS,
    MAP_GLYPH_PATH,
    MAP_ICON_GEOMETRY,
    mapIconSvg,
} from '../../src/kit/map-icon.js';
import { STORAGE_PATHS } from '../../src/schemas/paths.js';

describe('mapIconSvg', () => {
    it('happyPath_theGlyphInWhiteOnTheColour', () => {
        const svg = mapIconSvg('#3D6B8C');

        expect(svg).toContain('width="512" height="512" viewBox="0 0 960 960"');
        expect(svg).toContain('<rect width="960" height="960" rx="211" fill="#3D6B8C"/>');
        expect(svg).toContain(`fill="#FFFFFF" d="${MAP_GLYPH_PATH}"`);
    });

    it('happyPath_theGlyphInANamedColourForADarkTheme', () => {
        expect(mapIconSvg('#F4BB92', 32, '#5D3719')).toContain(`fill="#5D3719" d="${MAP_GLYPH_PATH}"`);
    });

    it.each([['red'], ['#3D6B8C" onload="x'], ['#3D6B8']])('badPath_theColour_%s_isRefused', (colour) => {
        expect(() => mapIconSvg(colour)).toThrow(RangeError);
        expect(() => mapIconSvg('#3D6B8C', 512, colour)).toThrow(RangeError);
    });

    it.each([[8], [2048], [31.5]])('badPath_theSize_%s_isRefused', (size) => {
        expect(() => mapIconSvg('#3D6B8C', size)).toThrow(RangeError);
    });
});

describe('the icon files and their request', () => {
    it('happyPath_theDefaultIsAPngAndTheFilesHaveFixedNames', () => {
        expect(DEFAULT_FAVICON_DATA_URL).toMatch(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+=*$/);
        expect(STORAGE_PATHS.cityIcon('bacau', 32)).toBe('cities/bacau/icon-32.png');
        expect(STORAGE_PATHS.cityOwnIcon('bacau')).toBe('cities/bacau/icon-own-32.png');
        for (const scheme of ['light', 'dark'] as const) {
            expect(DEFAULT_TAB_ICONS[scheme]).toMatch(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+=*$/);
            expect(Object.values(DEFAULT_ICON_VARIANTS[scheme]).every((colour) => /^#[0-9A-F]{6}$/.test(colour))).toBe(true);
        }
        expect(MAP_ICON_GEOMETRY).toEqual({ em: 960, radius: 211, scale: 0.8267 });
        expect(cityIconRequestSchema.safeParse({ kind: 'upload', cityId: 'bacau', image: 'iVBORw0KGgo=' }).success).toBe(true);
        expect(cityIconRequestSchema.safeParse({ kind: 'reset', cityId: 'bacau' }).success).toBe(true);
    });

    it('badPath_aRequestTooLongOrNotBase64OrBothIsRefused', () => {
        const long = 'A'.repeat(CITY_ICON_LIMITS.maxBase64Chars + 4);

        for (const request of [
            { kind: 'upload', cityId: 'bacau', image: long },
            { kind: 'upload', cityId: 'bacau', image: '<svg/>' },
            { kind: 'reset', cityId: 'bacau', image: 'iVBORw0KGgo=' },
            { kind: 'svg', cityId: 'bacau' },
            { kind: 'reset', cityId: 'Bacau' },
        ]) {
            expect(cityIconRequestSchema.safeParse(request).success).toBe(false);
        }
        expect(() => STORAGE_PATHS.cityIcon('../x', 32)).toThrow(RangeError);
    });
});
