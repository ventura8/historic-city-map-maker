import { POI_ICONS } from '@hcm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { fontUrl, installFonts, loadIconFont } from '../../src/fonts/font-faces.js';
import { FONT_FILES, ICON_FONT_AXES, ICON_FONT_FAMILY, TEXT_FONT_FAMILY, TEXT_FONT_STACK } from '../../src/fonts/font-files.js';
import { ICONS } from '../../src/icons-sorted.js';
import { UI_ICONS, isBundledIcon } from '../../src/icons.js';
import { FONT_BASE, cleanup } from '../helpers.js';

const ICON_SIZE = 24;

/** Width of `text` set in the icon font: one ligature glyph is exactly 1 em wide, a word of letters is not. */
function iconWidth(text: string): number {
    const probe = document.createElement('span');
    probe.style.setProperty('font-family', `"${ICON_FONT_FAMILY}"`);
    probe.style.setProperty('font-size', `${String(ICON_SIZE)}px`);
    probe.style.setProperty('font-feature-settings', '"liga"');
    probe.style.setProperty('white-space', 'nowrap');
    probe.textContent = text;
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
}

describe('the bundled icon list', () => {
    it('happyPath_holdsTheKitAndEveryPoiIcon_sortedWithoutDuplicates', () => {
        expect(ICONS).toEqual([...new Set(ICONS)].toSorted((a, b) => a.localeCompare(b, 'en')));
        for (const name of [...UI_ICONS, ...POI_ICONS]) {
            expect(isBundledIcon(name)).toBe(true);
        }
    });

    it('badPath_anUnknownNameIsNotBundled', () => {
        expect(isBundledIcon('celebration')).toBe(false);
        expect(isBundledIcon('')).toBe(false);
    });
});

describe('installFonts', () => {
    afterEach(cleanup);

    it('happyPath_registersEveryFaceOnceWithTheDocument', () => {
        const faces = installFonts(document, FONT_BASE);

        expect(faces.map((face) => face.family.replaceAll('"', ''))).toEqual(FONT_FILES.map((font) => font.family));
        expect(faces.every((face) => document.fonts.has(face))).toBe(true);
        expect(installFonts(document, FONT_BASE)).toBe(faces);
    });

    it('happyPath_textFacesAreLimitedToTheirUnicodeRanges', () => {
        const faces = installFonts(document, FONT_BASE);
        const text = faces.filter((face) => face.family.includes(TEXT_FONT_FAMILY));

        // Latin, Latin extended (ă, ș, ț; Polish, Turkish) and Cyrillic (Russian, Ukrainian): each fetched only when drawn.
        expect(text).toHaveLength(3);
        expect(text.some((face) => /U\+0*400-0*45F/i.test(face.unicodeRange))).toBe(true);
        expect(text.every((face) => face.unicodeRange.startsWith('U+'))).toBe(true);
        expect(faces.find((face) => face.family.includes(ICON_FONT_FAMILY))?.display).toBe('block');
        expect(TEXT_FONT_STACK.startsWith(`'${TEXT_FONT_FAMILY}'`)).toBe(true);
    });

    it('happyPath_everyBundledIconRendersAsOneGlyph', async () => {
        installFonts(document, FONT_BASE);

        expect(await loadIconFont(document)).toBe(true);
        const wrong = ICONS.filter((name) => Math.round(iconWidth(name)) !== ICON_SIZE);
        expect(wrong).toEqual([]);
        expect(ICON_FONT_AXES.variable).toEqual(['FILL']);
    });

    it('badPath_aNameOutsideTheSubsetIsNotAGlyph', async () => {
        installFonts(document, FONT_BASE);
        await loadIconFont(document);

        expect(Math.round(iconWidth('celebration'))).not.toBe(ICON_SIZE);
    });

    it('happyPath_anotherBaseUrlAddsItsOwnFaces', () => {
        const first = installFonts(document, FONT_BASE);
        const second = installFonts(document, 'https://cdn.example.test/engine/');

        expect(second).not.toBe(first);
        expect(second).toHaveLength(FONT_FILES.length);
        for (const face of second) {
            document.fonts.delete(face);
        }
    });

    it('happyPath_fontUrlsResolveAgainstTheDocumentAndEncodeQuotes', () => {
        expect(fontUrl('fonts/', 'a.woff2', 'https://city.example/map/index.html')).toBe('https://city.example/map/fonts/a.woff2');
        expect(fontUrl('https://cdn.example/e"x/', 'a.woff2', 'https://city.example/')).toBe('https://cdn.example/e%22x/a.woff2');
    });

    it('happyPath_usesTheInjectedFontFaceClass', () => {
        const created: string[] = [];
        class RecordingFontFace extends FontFace {
            constructor(family: string, source: string, descriptors?: FontFaceDescriptors) {
                super(family, source, descriptors);
                created.push(source);
            }
        }
        const doc = document.implementation.createHTMLDocument('fonts');

        installFonts(doc, 'https://cdn.example.test/e/', RecordingFontFace);

        expect(created).toHaveLength(FONT_FILES.length);
        expect(created[0]).toBe('url("https://cdn.example.test/e/roboto-flex-latin-wght.woff2") format("woff2")');
    });
});

describe('loadIconFont', () => {
    it('badPath_aFailingLoadResolvesFalse', async () => {
        const doc = { fonts: { load: () => Promise.reject(new Error('NetworkError')) } } as unknown as Document;

        expect(await loadIconFont(doc)).toBe(false);
    });

    it('badPath_noMatchingFaceResolvesFalse', async () => {
        const doc = { fonts: { load: () => Promise.resolve([]) } } as unknown as Document;

        expect(await loadIconFont(doc, 'home')).toBe(false);
    });
});
