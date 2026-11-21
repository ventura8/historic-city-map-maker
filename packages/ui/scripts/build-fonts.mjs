// Builds the self-hosted fonts of the kit into packages/ui/fonts/ (no Google Fonts, for GDPR):
//
// * Roboto Flex (OFL-1.1): the weight-axis files of @fontsource-variable/roboto-flex for the `latin` and `latin-ext`
//   ranges (Romanian needs both: ă ș ț live in latin-ext), copied as they are;
// * Material Symbols Rounded (Apache-2.0): a subset of the 5 MB variable font of `material-symbols` that keeps only the
//   ligatures of ICONS (packages/ui/src/icons-sorted.ts, from the lists of icons.ts) and the letters they are typed with,
//   instanced at wght 400, GRAD 0, opsz 24 with the FILL axis kept (filled icons for selected states). HarfBuzz shapes
//   every name to find its glyph, then subsets with "no layout closure", so GSUB keeps exactly those ligatures; wawoff2
//   decodes and encodes WOFF2.
//
// Run with Node 24 in the quality image:
//
//     node packages/ui/scripts/build-fonts.mjs           # (re)write the fonts
//     node packages/ui/scripts/build-fonts.mjs --check   # verify the committed fonts (exit 1 when stale or incomplete)
//
// The output is deterministic, so --check rebuilds in memory and compares bytes, also shapes every icon name with the
// committed subset, refuses an icon the sources use that is not listed, and checks that the tab icon's glyph
// (MAP_GLYPH_PATH, packages/shared/src/kit/map-icon.ts) is still the subset's `map`. Exit status: 0 ok, 1 stale, an icon
// missing or the glyph changed, 2 usage.
import { Buffer } from 'node:buffer';
import { glob, readFile, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import * as hb from 'harfbuzzjs';
import wawoff2 from 'wawoff2';

// The TypeScript sources import with `.js` (bundler style); retry a failed relative resolve with `.ts`.
registerHooks({
    resolve(specifier, context, nextResolve) {
        try {
            return nextResolve(specifier, context);
        } catch (error) {
            if (!specifier.startsWith('.') || !specifier.endsWith('.js')) {
                throw error;
            }
            return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
        }
    },
});

const { createLogger } = await import('../../shared/src/log.ts');
const { ICONS } = await import('../src/icons-sorted.ts');
const { FONT_FILES, ICON_FONT_AXES } = await import('../src/fonts/font-files.ts');
const { iconNamesIn } = await import('../src/fonts/icon-scan.ts');
const { MAP_GLYPH_PATH } = await import('../../shared/src/kit/map-icon.ts');

const log = createLogger('build-fonts');
const require = createRequire(import.meta.url);
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
// Package folders, found through each package's main file (their `exports` maps do not expose the font files).
const PACKAGE_DIRS = {
    '@fontsource-variable/roboto-flex': path.dirname(require.resolve('@fontsource-variable/roboto-flex')),
    'material-symbols': path.dirname(require.resolve('material-symbols')),
};

function sourcePath(font) {
    return path.join(PACKAGE_DIRS[font.source.package], font.source.path);
}

/** HarfBuzz `hb_subset_flags_t`: drop hinting (smaller, renderers ignore it), and no GSUB closure. */
const SUBSET_FLAGS = 0x1 | 0x200;

function tag(name) {
    return (name.charCodeAt(0) << 24) | (name.charCodeAt(1) << 16) | (name.charCodeAt(2) << 8) | name.charCodeAt(3);
}

/** The glyph ids `text` shapes to with the font in `bytes` (one id per icon name when the ligature exists). */
function shapeAll(bytes, names) {
    const font = new hb.Font(new hb.Face(new hb.Blob(bytes), 0));
    return new Map(
        names.map((name) => {
            const buffer = new hb.Buffer();
            buffer.addText(name);
            buffer.guessSegmentProperties();
            hb.shape(font, buffer);
            return [name, buffer.getGlyphInfos().map((info) => info.codepoint)];
        }),
    );
}

/** Names that do not shape to exactly one real glyph (a missing ligature renders as letters). */
function missingLigatures(glyphs) {
    return [...glyphs].filter(([, ids]) => ids.length !== 1 || ids[0] === 0).map(([name]) => name);
}

async function subsetter() {
    const wasm = await readFile(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'));
    const { instance } = await globalThis.WebAssembly.instantiate(wasm);
    instance.exports._initialize();
    return instance.exports;
}

/** Subsets `ttf` to the letters of `names` plus their ligature glyphs and pins the static axes. */
function subset(hbs, ttf, names, glyphIds) {
    const pointer = hbs.malloc(ttf.length);
    new Uint8Array(hbs.memory.buffer).set(ttf, pointer);
    const blob = hbs.hb_blob_create(pointer, ttf.length, 2, 0, 0);
    const face = hbs.hb_face_create(blob, 0);
    hbs.hb_blob_destroy(blob);
    const input = hbs.hb_subset_input_create_or_fail();
    const unicodes = hbs.hb_subset_input_unicode_set(input);
    for (const char of new Set(names.join(''))) {
        hbs.hb_set_add(unicodes, char.codePointAt(0));
    }
    const glyphs = hbs.hb_subset_input_glyph_set(input);
    for (const id of glyphIds) {
        hbs.hb_set_add(glyphs, id);
    }
    hbs.hb_subset_input_set_flags(input, hbs.hb_subset_input_get_flags(input) | SUBSET_FLAGS);
    for (const [axis, value] of Object.entries(ICON_FONT_AXES.pinned)) {
        hbs.hb_subset_input_pin_axis_location(input, face, tag(axis), value);
    }
    const result = hbs.hb_subset_or_fail(face, input);
    const resultBlob = hbs.hb_face_reference_blob(result);
    const data = hbs.hb_blob_get_data(resultBlob, 0);
    const bytes = new Uint8Array(hbs.memory.buffer).slice(data, data + hbs.hb_blob_get_length(resultBlob));
    for (const [destroy, handle] of [
        ['hb_blob_destroy', resultBlob],
        ['hb_face_destroy', result],
        ['hb_subset_input_destroy', input],
        ['hb_face_destroy', face],
    ]) {
        hbs[destroy](handle);
    }
    hbs.free(pointer);
    return bytes;
}

async function buildIconFont(font) {
    const source = await wawoff2.decompress(await readFile(sourcePath(font)));
    const glyphs = shapeAll(source, ICONS);
    const missing = missingLigatures(glyphs);
    if (missing.length > 0) {
        throw new Error(`not in Material Symbols Rounded: ${missing.join(', ')}`);
    }
    const ttf = subset(await subsetter(), source, ICONS, [...glyphs.values()].flat());
    return Buffer.from(await wawoff2.compress(ttf));
}

/** Every output file and its expected bytes. */
async function buildAll() {
    const outputs = new Map();
    for (const font of FONT_FILES) {
        outputs.set(font.file, font.subset ? await buildIconFont(font) : await readFile(sourcePath(font)));
    }
    return outputs;
}

async function readOrEmpty(file) {
    try {
        return await readFile(file);
    } catch {
        return Buffer.alloc(0);
    }
}

/**
 * Icon names the sources use that the subset does not hold, each with its file (finding 82 of 2026-11-03: `<hcm-icon>` draws
 * nothing for an unlisted name, so a button shows an empty gap and no other check sees it).
 */
async function unbundledIcons() {
    const known = new Set(ICONS);
    const unbundled = [];
    const root = path.join(import.meta.dirname, '..', '..');
    for await (const file of glob(['ui/src/**/*.ts', 'admin/src/**/*.ts', 'engine/src/**/*.ts'], { cwd: root })) {
        const names = iconNamesIn(await readFile(path.join(root, file), 'utf8'));
        unbundled.push(...names.filter((name) => !known.has(name)).map((name) => `${name} in ${file}`));
    }
    return unbundled;
}

/** The outline HarfBuzz draws for the `map` ligature of the committed subset (its default instance: FILL 0). */
function mapGlyphPath(ttf) {
    const font = new hb.Font(new hb.Face(new hb.Blob(ttf), 0));
    const [id] = shapeAll(ttf, ['map']).get('map');
    return font.glyphToPath(id);
}

/**
 * The tab icon's glyph (`MAP_GLYPH_PATH` of packages/shared/src/kit/map-icon.ts, the owner's 2026-11-08 request) is still the
 * font's `map`: the icon a city's tab shows and the one beside each layer in Layers never part.
 */
async function checkMapGlyph() {
    const committed = await readOrEmpty(path.join(OUT_DIR, FONT_FILES.find((font) => font.subset).file));
    const drawn = committed.length === 0 ? '' : mapGlyphPath(await wawoff2.decompress(committed));
    if (drawn !== MAP_GLYPH_PATH) {
        log.error("MAP_GLYPH_PATH is not the font's map glyph: copy the path below into packages/shared/src/kit/map-icon.ts", { drawn });
        return 1;
    }
    return 0;
}

/** `--check`: the sources' icons first, then the committed fonts and the tab icon's glyph. */
async function checkAll(outputs) {
    const unbundled = await unbundledIcons();
    if (unbundled.length > 0) {
        log.error('icons the sources use are not listed in packages/ui/src/icons.ts', { unbundled });
        return 1;
    }
    return (await check(outputs)) || checkMapGlyph();
}

async function check(outputs) {
    const stale = [];
    for (const [file, bytes] of outputs) {
        if (!bytes.equals(await readOrEmpty(path.join(OUT_DIR, file)))) {
            stale.push(file);
        }
    }
    const iconFile = FONT_FILES.find((font) => font.subset).file;
    const committed = await readOrEmpty(path.join(OUT_DIR, iconFile));
    const missing = committed.length === 0 ? [...ICONS] : missingLigatures(shapeAll(await wawoff2.decompress(committed), ICONS));
    if (stale.length > 0 || missing.length > 0) {
        log.error('fonts are stale: run node packages/ui/scripts/build-fonts.mjs', { stale, missing });
        return 1;
    }
    log.info('fonts are up to date', { files: outputs.size, icons: ICONS.length });
    return 0;
}

async function write(outputs) {
    for (const [file, bytes] of outputs) {
        await writeFile(path.join(OUT_DIR, file), bytes);
        log.info('font written', { file, bytes: bytes.length });
    }
    return 0;
}

function readMode(argv) {
    try {
        return parseArgs({ args: argv, options: { check: { type: 'boolean' } }, strict: true }).values.check === true ? 'check' : 'write';
    } catch (error) {
        log.error('usage: build-fonts.mjs [--check]', { reason: String(error) });
        return null;
    }
}

const mode = readMode(process.argv.slice(2));
if (mode === null) {
    process.exitCode = 2;
} else {
    const outputs = await buildAll();
    process.exitCode = mode === 'check' ? await checkAll(outputs) : await write(outputs);
}
