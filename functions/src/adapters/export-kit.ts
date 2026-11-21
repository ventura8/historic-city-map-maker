import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

import type { ExportKit, KitFile } from '../ports/export-kit.js';

/** `kit.json`, written by `functions/build.mjs` beside the kit's files: the engine's version and its files with their sizes. */
interface KitRecord {
    readonly engineVersion: string;
    readonly engine: readonly { readonly path: string; readonly bytes: number }[];
}

/** `ENGINE_VERSION`'s form (`MAJOR.MINOR.PATCH` or a pre-release `-beta.N` / `-rc.N`, as `releaseVersionSchema` of `@hcm/shared`). */
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-(?:beta|rc)\.(?:0|[1-9]\d{0,5}))?$/;

/** A file below `engine/`: relative, no `..`, no backslash (the build lists what it copied). */
const KIT_PATH = /^(?:\w[\w.-]*\/)*\w[\w.-]*$/;

function isKitFile(value: unknown): value is KitRecord['engine'][number] {
    const file = value as { readonly path?: unknown; readonly bytes?: unknown } | null;
    return typeof file?.path === 'string' && KIT_PATH.test(file.path) && Number.isInteger(file.bytes) && Number(file.bytes) > 0;
}

/** The parsed `kit.json`, or an error naming what is wrong with it (a broken deploy artifact). */
export function parseKitRecord(text: string): KitRecord {
    const value = JSON.parse(text) as { readonly engineVersion?: unknown; readonly engine?: unknown };
    const files: unknown = value.engine;
    if (typeof value.engineVersion !== 'string' || !VERSION.test(value.engineVersion) || !Array.isArray(files) || !files.every(isKitFile)) {
        throw new Error('export-kit/kit.json is not the build’s record: rebuild the functions (npm run build --workspace @hcm/functions)');
    }
    return { engineVersion: value.engineVersion, engine: files };
}

/**
 * The export kit in the deploy artifact (`functions/dist/export-kit/`, M5 `docs/research/M5-interfaces.md` §5.3): the
 * starter kit's page and README, the engine's files under `engine/` and `kit.json`, read on first use and kept for the
 * instance's life; each engine file is streamed from the disk when the zip reaches it.
 */
export function createDiskExportKit(folder: URL): ExportKit {
    let record: Promise<KitRecord> | undefined;
    const kit = (): Promise<KitRecord> => {
        record ??= readFile(new URL('kit.json', folder), 'utf8').then(parseKitRecord);
        return record;
    };
    const engineFile = (file: KitRecord['engine'][number]): KitFile => ({
        path: file.path,
        bytes: file.bytes,
        open: () => createReadStream(new URL(`engine/${file.path}`, folder)),
    });
    return {
        engineVersion: async () => (await kit()).engineVersion,
        texts: async () => {
            const [page, readme] = await Promise.all([
                readFile(new URL('index.html', folder), 'utf8'),
                readFile(new URL('README.md', folder), 'utf8'),
            ]);
            return { page, readme };
        },
        engineFiles: async () => (await kit()).engine.map(engineFile),
    };
}
