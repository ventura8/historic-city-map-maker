import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect } from '@playwright/test';

import { PIPELINE_PYTHON, REPO_ROOT } from '../../support/imagery-runner.js';

/**
 * The synthetic scene the real pipeline imports in the admin's world (`pipeline/tests/synthetic/scenes.py`, generated into
 * the test's folder, never committed): shared by the Cloud Run run (`pipeline.spec.ts`, S-P01-HAPPY-ADMIN) and the local
 * worker's (`worker-run.spec.ts`, S-A62-HAPPY-WORKER-RUN, M7).
 */

/** The 1966 target frame the synthetic delivery stands for (scenes.py's default entity). */
export const SYNTHETIC_SCENE = 'DS1035-1057DA023';

type Corners = Readonly<Record<'nw' | 'ne' | 'se' | 'sw', { readonly lat: number; readonly lng: number }>>;

/**
 * The synthetic frame's centre, and the city the pipeline's own tests use around it (5 km by 4 km in Web Mercator:
 * `city_bounds` of `pipeline/tests/fakes/world.py`), which the frame covers: the corner guess needs the city's window on
 * the frame.
 */
export const FRAME_CENTRE = { lat: 44.43, lng: 26.1 } as const;
export const FRAME_CITY = { west: 26.077542, south: 44.417169, east: 26.122458, north: 44.442828 } as const;

/** M8: the second frame of `scenes.py --join`, side by side with {@link SYNTHETIC_SCENE}; the fake USGS's catalogue has no such frame. */
export const SYNTHETIC_NEIGHBOUR = 'DS1035-1057DA024';

/**
 * Writes the synthetic scene into `dir` (the folder the mock APIs then answer from); its corners as USGS's metadata would
 * list them (`truth.json`: deliberately a few hundred metres off, as real metadata is).
 */
export function generateScene(dir: string): Corners {
    const result = spawnSync(PIPELINE_PYTHON, ['pipeline/tests/synthetic/scenes.py', '--out', dir, '--seed', '7'], {
        cwd: REPO_ROOT,
        env: { ...process.env, PYTHONPATH: resolve(REPO_ROOT, 'pipeline/src') },
        encoding: 'utf8',
        timeout: 120_000,
    });
    expect(result.status, `scenes.py: ${result.stderr}`).toBe(0);
    return (JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as { corners: Corners }).corners;
}

/** Writes the two frames of one date into `dir/<entity>/` (M8); each one's corners, as USGS's metadata would list them. */
export function generateJoinScenes(dir: string): Readonly<Record<string, Corners>> {
    const result = spawnSync(PIPELINE_PYTHON, ['pipeline/tests/synthetic/scenes.py', '--out', dir, '--seed', '7', '--join'], {
        cwd: REPO_ROOT,
        env: { ...process.env, PYTHONPATH: resolve(REPO_ROOT, 'pipeline/src') },
        encoding: 'utf8',
        timeout: 240_000,
    });
    expect(result.status, `scenes.py: ${result.stderr}`).toBe(0);
    const cornersOf = (entity: string): Corners =>
        (JSON.parse(readFileSync(join(dir, entity, 'truth.json'), 'utf8')) as { corners: Corners }).corners;
    return { [SYNTHETIC_SCENE]: cornersOf(SYNTHETIC_SCENE), [SYNTHETIC_NEIGHBOUR]: cornersOf(SYNTHETIC_NEIGHBOUR) };
}
