/**
 * The static export's test world (M5, `docs/research/M5-interfaces.md` §5): the fn-content fakes (`../publish/fakes.ts`:
 * an in-memory `DocumentStore` and `BlobStore`, a movable clock, a recording task queue), plus a `BlobReader` and a
 * streaming `BlobWriter` over the same buckets, a recording `UrlSigner` and an export kit whose page is the committed
 * starter-kit template. A published city of three photos (one licensed for this map only), a USGS layer and an uploaded
 * one, each with its files. Every value is a generated test value (the public token is not a real token).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import {
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    cityDocSchema,
    cityExportDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    timestampFromDate,
    validateManifest,
    type CityDoc,
    type CityExportDoc,
    type LayerDoc,
    type Manifest,
} from '@hcm/shared';

import type { ExportFamilyDeps } from '../../src/export/index.js';
import type { BlobReader } from '../../src/ports/blob-reader.js';
import type { BucketRole } from '../../src/ports/blob-store.js';
import type { BlobWriter } from '../../src/ports/blob-writer.js';
import { UpstreamError } from '../../src/ports/errors.js';
import type { ExportKit, KitFile } from '../../src/ports/export-kit.js';
import type { SignedDownload, UrlSigner } from '../../src/ports/url-signer.js';
import { renderedVersion } from '../imagery/world.js';
import { contentDeps, publicUrl, type ContentDeps } from '../publish/fakes.js';
import { fakeAdmins, type FakeStanding } from '../support/fakes.js';

export const CITY = 'oras-export';
export const OWNER = 'u-admin';
export const NOW = '2026-11-02T10:00:00.000Z';
const T0 = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));

const ROOT = resolve(import.meta.dirname, '../../..');

/** The committed starter-kit page: the export fills it (`fillKitPage`), so a template change is tested here too. */
export const KIT_PAGE = readFileSync(resolve(ROOT, 'templates/starter-kit/index.html'), 'utf8');
export const KIT_README = '# Kit\n\nThe starter kit’s own README.\n';

/** The seed's city as published (theme, About and privacy texts), renamed for this world. */
function publishedCity(): Manifest['city'] {
    const seed = JSON.parse(readFileSync(resolve(ROOT, 'seed/bucharest/manifest.static.json'), 'utf8')) as Manifest;
    return {
        ...seed.city,
        id: CITY,
        name: { ro: 'Orașul | exportat', en: 'The exported city' },
        mapbox: { publicToken: 'pk.test-viewer-token' },
        analytics: { measurementId: 'G-TEST1234', errorEndpoint: 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError' },
    };
}

function photo(id: string, license: Manifest['photos'][number]['license'], extra: Partial<Manifest['photos'][number]> = {}) {
    return {
        id,
        title: { ro: `Fotografia ${id}` },
        license,
        links: [],
        location: { lat: 44.43, lng: 26.09 },
        image: {
            web: publicUrl(`photos/${CITY}/${id}/12345678/web.webp`),
            thumb: publicUrl(`photos/${CITY}/${id}/12345678/thumb.webp`),
            w: 1600,
            h: 1000,
        },
        ...extra,
    };
}

function layer(id: string, source: Manifest['layers'][number]['source']): Manifest['layers'][number] {
    return {
        id,
        year: 1966,
        label: { ro: `Stratul ${id}`, en: `Layer ${id}` },
        kind: 'satellite',
        attribution: 'USGS',
        source,
        minzoom: 10,
        maxzoom: 17,
        order: 1,
        defaultVisible: false,
        opacity: 1,
    };
}

/** The published manifest: three photos (one `permission`), a USGS layer and an uploaded one, no POIs. */
export function publishedManifest(): Manifest {
    const result = validateManifest({
        version: 1,
        city: publishedCity(),
        layers: [
            layer('corona-1966', { type: 'mapbox', tilesetId: 'e2e-user.corona-1966' }),
            layer('plan-1911', { type: 'xyz', tiles: ['https://tiles.example.test/1911/{z}/{x}/{y}.png'], tileSize: 256 }),
        ],
        photos: [
            photo('strand-1976', 'CC-BY-4.0'),
            photo('opera-1940', 'permission', { rightsHolder: 'Arhiva | familiei' }),
            photo('gara-1930', 'PD', {
                image: {
                    web: 'https://images.example.test/gara/web.webp',
                    thumb: 'https://images.example.test/gara/thumb.webp',
                    w: 10,
                    h: 10,
                },
            }),
        ],
    });
    if (!result.ok) {
        throw new Error(`the export world's manifest is invalid: ${JSON.stringify(result.issues)}`);
    }
    return result.value;
}

interface FakeWriter extends BlobWriter {
    /** The next upload fails after taking the stream (the bucket refused it). */
    failNextUpload(): void;
}

function bytesOf(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

function createReader(deps: ContentDeps): BlobReader {
    return {
        open: async (bucket, path) => {
            const stored = deps.blobs.object(bucket, path);
            if (stored === undefined) {
                throw new UpstreamError('cloud-storage', 'notFound', { status: 404 });
            }
            return Promise.resolve({
                bytes: stored.bytes.length,
                contentType: stored.options.contentType,
                body: Readable.from([stored.bytes]),
            });
        },
        range: (bucket, path, start, end) => Promise.resolve(deps.blobs.object(bucket, path)?.bytes.slice(start, end) ?? new Uint8Array()),
    };
}

function createWriter(deps: ContentDeps): FakeWriter {
    let fail = false;
    return {
        failNextUpload: () => {
            fail = true;
        },
        stream: async (bucket: BucketRole, path: string, body: AsyncIterable<Uint8Array>, options) => {
            const chunks: Uint8Array[] = [];
            for await (const chunk of body) {
                chunks.push(chunk);
            }
            if (fail) {
                fail = false;
                throw new UpstreamError('cloud-storage', 'unavailable', { status: 503 });
            }
            deps.blobs.put(bucket, path, Buffer.concat(chunks), { contentType: options.contentType });
        },
    };
}

interface FakeSigner extends UrlSigner {
    readonly signed: { readonly bucket: BucketRole; readonly download: SignedDownload }[];
}

function createSigner(): FakeSigner {
    const signed: { bucket: BucketRole; download: SignedDownload }[] = [];
    return {
        signed,
        signedDownload: (bucket, download) => {
            signed.push({ bucket, download });
            return Promise.resolve(`https://storage.googleapis.com/demo-hcm.firebasestorage.app/${download.path}?X-Goog-Signature=test`);
        },
        // M7: the local worker's objects; the export never signs one.
        signedObject: () => Promise.reject(new Error('the export signs downloads only')),
    };
}

/** Engine files of a given size each (the export's size check reads `bytes`). */
export function engineFiles(sizes: Readonly<Record<string, number>> = {}): KitFile[] {
    const files: Readonly<Record<string, string>> = {
        'engine.iife.js': 'globalThis.HistoricCityMap = {};\n',
        'engine.css': '.hcm-fullpage { margin: 0; }\n',
        'fonts/roboto-flex-latin-wght.woff2': 'wOF2-test-font',
        'THIRD_PARTY_NOTICES.txt': 'Third-party notices (test)\n',
    };
    return Object.entries(files).map(([path, text]) => ({
        path,
        bytes: sizes[path] ?? bytesOf(text).length,
        open: () => Readable.from([bytesOf(text)]),
    }));
}

function createKit(engine: () => KitFile[]): ExportKit {
    return {
        engineVersion: () => Promise.resolve('1.0.0'),
        texts: () => Promise.resolve({ page: KIT_PAGE, readme: KIT_README }),
        engineFiles: () => Promise.resolve(engine()),
    };
}

export type ExportWorld = Omit<ContentDeps, 'admins'> &
    ExportFamilyDeps & {
        readonly admins: ReturnType<typeof fakeAdmins>;
        readonly reader: BlobReader;
        readonly writer: FakeWriter;
        readonly signer: FakeSigner;
        readonly kit: ExportKit;
        /** Replaces the kit's engine files (a huge engine, for the size check). */
        setEngine(files: KitFile[]): void;
    };

/** Fresh fakes, `u-admin` an admin with `standing` (default: the project's owner and the owner of every city). */
export function exportWorld(standing: FakeStanding = {}, now = NOW): ExportWorld {
    const deps = contentDeps(now);
    let engine = engineFiles();
    return {
        ...deps,
        admins: fakeAdmins([OWNER], standing),
        reader: createReader(deps),
        writer: createWriter(deps),
        signer: createSigner(),
        kit: createKit(() => engine),
        setEngine: (files) => {
            engine = files;
        },
    };
}

export function cityDoc(overrides: Partial<CityDoc> = {}): CityDoc {
    return {
        name: { ro: 'Orașul exportat' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: T0,
        ...overrides,
    };
}

export async function seedCity(world: ExportWorld, overrides: Partial<CityDoc> = {}): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.city(CITY), cityDocSchema, cityDoc(overrides));
}

/** The manifest in the public bucket and every photo file it names there (each a few bytes of its own). */
export function publish(world: ExportWorld, manifest: Manifest = publishedManifest()): void {
    world.blobs.put('public', STORAGE_PATHS.manifest(CITY), bytesOf(JSON.stringify(manifest)), { contentType: 'application/json' });
    for (const item of manifest.photos) {
        for (const url of [item.image.web, item.image.thumb]) {
            const prefix = publicUrl('');
            if (url.startsWith(prefix)) {
                world.blobs.put('public', url.slice(prefix.length), bytesOf(`webp:${url.slice(prefix.length)}`), {
                    contentType: 'image/webp',
                });
            }
        }
    }
}

function layerDoc(overrides: Partial<LayerDoc> = {}): LayerDoc {
    return {
        year: 1966,
        label: { ro: 'Strat' },
        kind: 'satellite',
        source: { type: 'mapbox', tilesetId: 'e2e-user.corona-1966' },
        minzoom: 10,
        maxzoom: 17,
        order: 1,
        opacity: 1,
        defaultVisible: false,
        status: 'ready',
        published: true,
        updatedBy: 'system:pipeline',
        updatedAt: T0,
        ...overrides,
    };
}

/** `corona-1966`, a USGS frame with its COG; `plan-1911`, an uploaded GeoTIFF with its own. */
export async function seedLayers(world: ExportWorld): Promise<void> {
    const versions = [
        {
            layerId: 'corona-1966',
            versionId: 'v-corona',
            provenance: { usgsEntityId: 'DS1035-1057DA023', usgsDataset: 'corona2' as const },
        },
        { layerId: 'plan-1911', versionId: 'v-plan', provenance: undefined },
    ];
    for (const { layerId, versionId, provenance } of versions) {
        const cogPath = `rasters/${CITY}/${layerId}/${versionId}/cog.tif`;
        await world.documents.set(
            FIRESTORE_PATHS.layer(CITY, layerId),
            layerDocSchema,
            layerDoc({ currentVersion: versionId, ...(provenance === undefined ? {} : { provenance }) }),
        );
        const version = renderedVersion({
            layerId,
            jobId: versionId,
            state: 'published',
            mapbox: { tilesetId: 'e2e-user.x', origin: 'mts' },
        });
        const { output } = version;
        if (output === undefined) {
            throw new Error('the golden version has an output');
        }
        await world.documents.set(FIRESTORE_PATHS.layerVersion(CITY, versionId), layerVersionDocSchema, {
            ...version,
            output: { ...output, cogPath },
        });
        world.blobs.put('private', cogPath, bytesOf(`cog:${layerId}`), { contentType: 'image/tiff' });
    }
}

export function exportRecord(overrides: Partial<CityExportDoc> = {}): CityExportDoc {
    return {
        state: 'queued',
        requestedBy: OWNER,
        rasters: false,
        engineVersion: '1.0.0',
        createdAt: timestampFromDate(new Date(NOW)),
        updatedBy: OWNER,
        updatedAt: timestampFromDate(new Date(NOW)),
        ...overrides,
    };
}

export async function seedExport(world: ExportWorld, exportId: string, overrides: Partial<CityExportDoc> = {}): Promise<void> {
    await world.documents.set(FIRESTORE_PATHS.cityExport(CITY, exportId), cityExportDocSchema, exportRecord(overrides));
}

export async function readExport(world: ExportWorld, exportId: string): Promise<CityExportDoc | undefined> {
    return world.documents.get(FIRESTORE_PATHS.cityExport(CITY, exportId), cityExportDocSchema);
}
