/**
 * Registers the kit's fonts with a document: the only global side effect of the kit. `@font-face` rules inside a
 * shadow root are ignored by browsers, so the faces are added to `document.fonts` (the FontFace API) instead of an
 * injected stylesheet, which also keeps the strict CSP happy (`style-src 'self'`, no inline style; `font-src` must
 * allow the engine's origin). A face loads lazily, the first time text needs it.
 */
import { FONT_FILES, ICON_FONT_FAMILY, type FontFile } from './font-files.js';

/** The FontFace constructor (injectable for tests). */
export type FontFaceConstructor = new (family: string, source: string, descriptors?: FontFaceDescriptors) => FontFace;

const installed = new WeakMap<Document, Map<string, readonly FontFace[]>>();

/** `url("…")` of `file` under `baseUrl` (resolved against the document); the URL parser percent-encodes quotes. */
export function fontUrl(baseUrl: string, file: string, documentUrl: string): string {
    return new URL(file, new URL(baseUrl, documentUrl)).href;
}

function descriptorsOf(font: FontFile): FontFaceDescriptors {
    const descriptors: FontFaceDescriptors = { weight: font.weight, style: 'normal', display: font.display };
    return font.unicodeRange === undefined ? descriptors : { ...descriptors, unicodeRange: font.unicodeRange };
}

/**
 * Adds every face of `FONT_FILES` to `doc.fonts`, loading from `baseUrl` (the engine's `engineBase`, a folder URL
 * ending with `/`, absolute or relative to the document). Idempotent per document and base URL: a second call returns
 * the faces of the first.
 */
export function installFonts(doc: Document, baseUrl: string, FontFaceClass: FontFaceConstructor = FontFace): readonly FontFace[] {
    const perBase = installed.get(doc) ?? new Map<string, readonly FontFace[]>();
    installed.set(doc, perBase);
    const existing = perBase.get(baseUrl);
    if (existing !== undefined) {
        return existing;
    }
    const faces = FONT_FILES.map(
        (font) => new FontFaceClass(font.family, `url("${fontUrl(baseUrl, font.file, doc.baseURI)}") format("woff2")`, descriptorsOf(font)),
    );
    for (const face of faces) {
        doc.fonts.add(face);
    }
    perBase.set(baseUrl, faces);
    return faces;
}

/**
 * Waits until the icon font is usable (the engine rasterises POI icons into map images with it). Resolves `false`
 * when it cannot load (missing file, CSP), so the caller can fall back to plain markers; never rejects.
 */
export async function loadIconFont(doc: Document, sample = 'location_on'): Promise<boolean> {
    try {
        const faces = await doc.fonts.load(`24px "${ICON_FONT_FAMILY}"`, sample);
        return faces.length > 0;
    } catch {
        return false;
    }
}
