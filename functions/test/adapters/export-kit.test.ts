/**
 * The export kit on disk (`functions/src/adapters/export-kit.ts`, M5 §5.3): `kit.json` names the engine's version and
 * files, the page and README are read as text and each engine file is streamed when the zip reaches it; a `kit.json`
 * the build did not write is refused with the command that fixes it.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDiskExportKit, parseKitRecord } from '../../src/adapters/export-kit.js';

let folder: string;

beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'hcm-export-kit-'));
    await mkdir(join(folder, 'engine', 'fonts'), { recursive: true });
    await writeFile(join(folder, 'index.html'), '<!doctype html>');
    await writeFile(join(folder, 'README.md'), '# Kit');
    await writeFile(join(folder, 'engine', 'engine.css'), 'a{}');
    await writeFile(join(folder, 'engine', 'fonts', 'f.woff2'), 'wOF2');
    const kit = {
        engineVersion: '1.0.0',
        engine: [
            { path: 'engine.css', bytes: 3 },
            { path: 'fonts/f.woff2', bytes: 4 },
        ],
    };
    await writeFile(join(folder, 'kit.json'), JSON.stringify(kit));
});

afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
});

async function text(body: AsyncIterable<unknown>): Promise<string> {
    const parts: Buffer[] = [];
    for await (const part of body) {
        parts.push(part as Buffer);
    }
    return Buffer.concat(parts).toString('utf8');
}

describe('createDiskExportKit', () => {
    it('happyPath_theVersionTheTextsAndTheEngineFilesComeFromTheFolder', async () => {
        const kit = createDiskExportKit(pathToFileURL(`${folder}/`));

        await expect(kit.engineVersion()).resolves.toBe('1.0.0');
        await expect(kit.texts()).resolves.toEqual({ page: '<!doctype html>', readme: '# Kit' });
        const files = await kit.engineFiles();
        expect(files.map((file) => [file.path, file.bytes])).toEqual([
            ['engine.css', 3],
            ['fonts/f.woff2', 4],
        ]);
        expect(await Promise.all(files.map((file) => text(file.open())))).toEqual(['a{}', 'wOF2']);
    });

    it('badPath_aFolderWithoutTheKitRejects', async () => {
        await expect(createDiskExportKit(pathToFileURL(`${folder}/missing/`)).engineVersion()).rejects.toThrow();
    });
});

describe('parseKitRecord', () => {
    it.each([
        ['no version', { engine: [] }],
        ['a version that is not one', { engineVersion: 'v1', engine: [] }],
        ['no file list', { engineVersion: '1.0.0' }],
        ['a path that climbs up', { engineVersion: '1.0.0', engine: [{ path: '../secret', bytes: 1 }] }],
        ['an empty file', { engineVersion: '1.0.0', engine: [{ path: 'engine.css', bytes: 0 }] }],
        ['a file that is not an object', { engineVersion: '1.0.0', engine: [null] }],
    ])('badPath_%s_isRefused', (_case, record) => {
        expect(() => parseKitRecord(JSON.stringify(record))).toThrow('npm run build --workspace @hcm/functions');
    });
});
