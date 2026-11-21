import { createReadStream } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import { publicObjectUrl, validateManifest, type Manifest } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { planExport, type PlannedEntry } from '../../functions/src/export/plan.js';
import { zipMethodFor, zipStream } from '../../functions/src/export/zip.js';
import type { KitFile } from '../../functions/src/ports/export-kit.js';
import { siteManifestData } from '../fixtures/manifest.js';
import { E2E_PUBLIC_BUCKET, E2E_SITE_DIR, SITE_ORIGIN } from '../fixtures/world.js';
import { isFile } from '../mock-apis/server.js';
import { unzipInto } from './unzip.js';

/**
 * A static export as the viewer's tier serves it (M5, behaviour V28, `docs/research/M5-interfaces.md` §5.7): the
 * export's own planner and zip writer (`functions/src/export/`) run over the e2e fixture city as the admin publishes it
 * (the built Bucharest site's manifest, its photos in the public bucket, a GA4 id when asked), the kit's committed page
 * and README and the engine of `packages/engine/dist`; the archive is unpacked with the e2e's own reader into a folder of
 * the site server's origin (`serveExports`). The starter-kit tier runs without the emulators, and on another machine in a split run, so it builds
 * its own export instead of reading the one the admin tier downloads (S-A53-HAPPY reads that one).
 */

const ROOT = resolve(import.meta.dirname, '../..');
const SITE_DATA = join(ROOT, E2E_SITE_DIR, 'bucharest', 'data');
const ENGINE_DIST = join(ROOT, 'packages', 'engine', 'dist');
const KIT = join(ROOT, 'templates', 'starter-kit');
const ENGINE_FILES = ['engine.iife.js', 'engine.extras.js', 'engine.css', 'THIRD_PARTY_NOTICES.txt'];
/** The IIFE's extras, which it loads from its own folder (DECISIONS-for-review.md §186). */
const ENGINE_EXTRA = /^extra-[\w-]+\.js$/;
const PUBLIC_PREFIX = publicObjectUrl(E2E_PUBLIC_BUCKET, '');

/**
 * Where the exports are unpacked (`dist/e2e-exports/<name>/`, outside the e2e build's output folders, so a run never
 * makes the next build look stale) and the path of the site server's origin they are served at (`serveExports`).
 */
const EXPORTS_DIR = join(ROOT, 'dist', 'e2e-exports');
const EXPORTS_PATH = '/exports/';

export interface ExportSite {
    /** The site server's path of the export's folder (`/exports/<name>/`). */
    readonly path: string;
    /** The unpacked folder on disk (for a `file://` visit). */
    readonly folder: string;
    readonly files: readonly string[];
    readonly manifest: Manifest;
}

async function fileOf(path: string): Promise<KitFile> {
    return { path: relative(ENGINE_DIST, path), bytes: (await stat(path)).size, open: () => createReadStream(path) };
}

/** The engine's files as the functions' build copies them (no source maps, no ES module build; the IIFE's extras). */
async function engineFiles(): Promise<KitFile[]> {
    // The fonts and the languages' texts (`i18n/<locale>.json`, fetched when shown) are folders beside the engine.
    const folders = await Promise.all(
        ['fonts', 'i18n'].map(async (folder) => (await readdir(join(ENGINE_DIST, folder))).map((name) => join(ENGINE_DIST, folder, name))),
    );
    const extras = (await readdir(ENGINE_DIST)).filter((name) => ENGINE_EXTRA.test(name));
    return Promise.all([...[...ENGINE_FILES, ...extras].map((name) => join(ENGINE_DIST, name)), ...folders.flat()].map(fileOf));
}

/** The fixture city as the admin publishes it: its photos in the public bucket, the GA4 id when asked. */
function publishedFixture(analytics: boolean): { readonly manifest: Manifest; readonly files: ReadonlyMap<string, string> } {
    const data = siteManifestData({ analytics });
    const files = new Map<string, string>();
    const photos = (data['photos'] as { readonly id: string; readonly image: Record<string, unknown> }[]).map((photo) => {
        const image = { ...photo.image };
        for (const variant of ['web', 'thumb'] as const) {
            const path = `photos/bucharest/${photo.id}/${variant}.webp`;
            files.set(path, join(SITE_DATA, String(image[variant])));
            image[variant] = `${PUBLIC_PREFIX}${path}`;
        }
        return { ...photo, image };
    });
    const result = validateManifest({ ...data, photos });
    if (!result.ok) {
        throw new Error(`the fixture city does not validate: ${JSON.stringify(result.issues.slice(0, 3))}`);
    }
    return { manifest: result.value, files };
}

function bodyOf(entry: PlannedEntry, files: ReadonlyMap<string, string>): () => AsyncIterable<Uint8Array> {
    const { source } = entry;
    if (source.kind === 'text') {
        return () => Readable.from([Buffer.from(source.text, 'utf8')]);
    }
    if (source.kind === 'kit') {
        return () => source.file.open();
    }
    const file = files.get(source.path);
    if (file === undefined) {
        throw new Error(`the fixture has no file for ${source.path}`);
    }
    return () => createReadStream(file);
}

/** The export's archive of the fixture city, made by the export's own planner and writer. */
async function exportArchive(madeAt: Date, analytics: boolean): Promise<{ readonly zip: Buffer; readonly manifest: Manifest }> {
    const { manifest, files } = publishedFixture(analytics);
    const plan = planExport({
        manifest,
        publicPrefix: PUBLIC_PREFIX,
        rasters: [],
        archives: [],
        kitPage: await readFile(join(KIT, 'index.html'), 'utf8'),
        kitReadme: await readFile(join(KIT, 'README.md'), 'utf8'),
        engine: await engineFiles(),
        madeAt,
    });
    const entries = plan.entries.map((entry) => ({ name: entry.name, method: zipMethodFor(entry.name), body: bodyOf(entry, files) }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of zipStream(entries, madeAt)) {
        chunks.push(chunk);
    }
    return { zip: Buffer.concat(chunks), manifest };
}

/** Unpacks an export's archive into `exports/<name>/` of the site server (replacing an older one), as an owner would. */
export async function unpackExport(name: string, zip: Buffer): Promise<Omit<ExportSite, 'manifest'>> {
    const folder = join(EXPORTS_DIR, name);
    await rm(folder, { recursive: true, force: true });
    const files = await unzipInto(zip, folder);
    return { path: `${EXPORTS_PATH}${name}/`, folder, files };
}

/** Builds the fixture city's export and unpacks it into `exports/<name>/` of the site server (replacing an older one). */
export async function exportSite(name: string, options: { readonly analytics?: boolean } = {}): Promise<ExportSite> {
    const { zip, manifest } = await exportArchive(new Date('2026-11-02T10:00:00Z'), options.analytics === true);
    return { ...(await unpackExport(name, zip)), manifest };
}

/** The file below `EXPORTS_DIR` an address of the site's `/exports/` names (a folder: its index.html), or null outside it. */
function exportedFile(url: URL): string | null {
    const relativePath = decodeURIComponent(url.pathname.slice(EXPORTS_PATH.length));
    const file = normalize(
        join(EXPORTS_DIR, relativePath.endsWith('/') || relativePath === '' ? `${relativePath}index.html` : relativePath),
    );
    return file.startsWith(`${EXPORTS_DIR}${sep}`) ? file : null;
}

/**
 * The site server's origin serves the unpacked exports at `/exports/<name>/` as any static host would: each file as it
 * is on the disk, with its type, and 404 for anything else.
 */
export async function serveExports(page: Page): Promise<void> {
    await page.route(`${SITE_ORIGIN}${EXPORTS_PATH}**`, async (route) => {
        const file = exportedFile(new URL(route.request().url()));
        if (file === null || !(await isFile(file))) {
            await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
            return;
        }
        await route.fulfill({ path: file });
    });
}
