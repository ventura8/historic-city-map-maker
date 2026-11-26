import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { manifestSchema, type Manifest } from '@hcm/shared';

import { ROOT } from './support.js';

/** A committed manifest, parsed (a test fails loudly if it ever stops being valid). */
export function readRepositoryManifest(path: string): Manifest {
    return manifestSchema.parse(JSON.parse(readFileSync(join(ROOT, path), 'utf8')));
}

/** A committed manifest as plain JSON data, for tests that break a copy of it. */
export function readRepositoryJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Record<string, unknown>;
}
