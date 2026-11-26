import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createLogger, type LogRecord, type Logger } from '@hcm/shared';

import { jsonText, nodeReleaseFiles, type ReleaseFiles } from '../src/files.js';

/** The repository root (scripts/release/test → ../../..). */
export const ROOT = resolve(import.meta.dirname, '../../..');

const made: string[] = [];

/** A fresh temporary folder; `cleanup()` deletes every folder made so far. */
export function temporaryDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hcm-release-'));
    made.push(dir);
    return dir;
}

export function cleanup(): void {
    for (const dir of made.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** A logger whose records the test reads. */
export function recordingLogger(): { log: Logger; records: LogRecord[] } {
    const records: LogRecord[] = [];
    const sink = (record: LogRecord): void => {
        records.push(record);
    };
    return { log: createLogger('release-test', { sink, minLevel: 'debug' }), records };
}

/** The messages of the records at `level`. */
export function messages(records: readonly LogRecord[], level: LogRecord['level']): string[] {
    return records.filter((record) => record.level === level).map((record) => record.message);
}

/** Generated stand-ins for the pinned Mapbox GL JS release (never the real files: only their digests matter here). */
export const MAPBOX_JS = 'mapbox-gl test script\n';
export const MAPBOX_CSS = '.mapboxgl-map{}\n';

/** The engine build a test releases: two entries with their source maps, the stylesheet, a chunk, a font, the notices. */
const ENGINE_BUILD: Readonly<Record<string, string | Uint8Array>> = {
    'engine.iife.js': 'var HistoricCityMap=(function(){return {}})();\n//# sourceMappingURL=engine.iife.js.map',
    'engine.iife.js.map': '{"version":3}',
    'engine.mjs': 'export{};\n//# sourceMappingURL=engine.mjs.map',
    'engine.mjs.map': '{"version":3}',
    'compare-AbC123.js': 'export const compareModule={};\n//# sourceMappingURL=compare-AbC123.js.map',
    'compare-AbC123.js.map': '{"version":3}',
    'engine.css': '.hcm-engine-root{display:block}\n/*$vite$:1*/',
    'fonts/roboto-flex-latin-wght.woff2': new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x0a, 0x20]),
    'THIRD_PARTY_NOTICES.txt': 'Third-party notices\n',
};

/** A repository at `version` with one workspace on another, its lockfile, the deploy lock and the engine's version. */
export function fakeRepository(version = '0.0.0'): { root: string; files: ReleaseFiles } {
    const root = temporaryDir();
    const files = nodeReleaseFiles(root);
    files.write('package.json', jsonText({ name: 'historic-city-map', version, workspaces: ['packages/*', 'functions'] }));
    files.write('packages/shared/package.json', jsonText({ name: '@hcm/shared', version, dependencies: { zod: '4.6.6' } }));
    files.write(
        'packages/engine/package.json',
        jsonText({ name: '@hcm/engine', version, dependencies: { '@hcm/shared': version, firebase: '13.0.0' } }),
    );
    files.write('packages/no-manifest/README.md', 'not a workspace');
    files.write('functions/package.json', jsonText({ name: '@hcm/functions', version, devDependencies: { '@hcm/shared': version } }));
    files.write(
        'package-lock.json',
        jsonText({
            name: 'historic-city-map',
            version,
            lockfileVersion: 3,
            packages: {
                '': { name: 'historic-city-map', version, workspaces: ['packages/*', 'functions'] },
                functions: { name: '@hcm/functions', version, devDependencies: { '@hcm/shared': version } },
                'node_modules/@hcm/shared': { resolved: 'packages/shared', link: true },
                'node_modules/zod': { version: '4.6.6' },
                'packages/engine': { name: '@hcm/engine', version, dependencies: { '@hcm/shared': version, firebase: '13.0.0' } },
                'packages/shared': { name: '@hcm/shared', version, dependencies: { zod: '4.6.6' } },
            },
        }),
    );
    files.write('functions/deploy-lock/package.json', jsonText({ name: 'hcm-functions', version, dependencies: { sharp: '0.35.5' } }));
    files.write(
        'functions/deploy-lock/package-lock.json',
        jsonText({ name: 'hcm-functions', version, lockfileVersion: 3, packages: { '': { name: 'hcm-functions', version } } }),
    );
    files.write('packages/engine/src/index.ts', `/** Engine release. */\nexport const ENGINE_VERSION = '${version}';\n`);
    return { root, files };
}

/** `files` with the engine built and the pinned Mapbox GL JS installed. */
export function withEngineBuild(files: ReleaseFiles, mapboxVersion = '3.34.1'): ReleaseFiles {
    for (const [path, content] of Object.entries(ENGINE_BUILD)) {
        files.write(`packages/engine/dist/${path}`, content);
    }
    files.write('node_modules/mapbox-gl/package.json', jsonText({ name: 'mapbox-gl', version: mapboxVersion }));
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.js', MAPBOX_JS);
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.css', MAPBOX_CSS);
    return files;
}
