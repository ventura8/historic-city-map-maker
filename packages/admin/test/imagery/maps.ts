// Admin maps for the Imagery and georeferencer tests: real admin map handles over the fake `mapboxgl` (so the canvas
// pictures reach `nativeMap`), with the drawing tools the test chooses, behind a factory that answers when told.
import { createLogger } from '@hcm/shared';
import { FakeMapboxGl, type FakeMapboxMap } from '@hcm/test-support/fake-map';
import type { FakeMapDraw } from '@hcm/test-support/fake-map-draw';

import { createAdminMapFactory, type AdminMapFactory, type AdminMapHandle, type AdminMapResult } from '../../src/map/factory.js';
import { fakeEnv, type FakeFrames } from '../map/support.js';

export interface MapboxHandle {
    readonly handle: AdminMapHandle;
    readonly native: FakeMapboxMap;
}

/** A mounted admin map over the fake `mapboxgl`; `draw` replaces its drawing tools. */
export async function mapboxHandle(draw: FakeMapDraw | null = null, frames?: FakeFrames): Promise<MapboxHandle> {
    const gl = new FakeMapboxGl();
    const factory = createAdminMapFactory({
        gl: () => Promise.resolve(gl),
        token: () => Promise.resolve('pk.admin'),
        terraDraw: null,
        reducedMotion: () => true,
        env: fakeEnv(frames),
        log: createLogger('imagery-map-test'),
    });
    const creating = factory.create({} as HTMLElement, {
        bounds: [
            [25.9, 44.3],
            [26.3, 44.6],
        ],
        view: { center: [26.1, 44.45], zoom: 12, bearing: 0 },
        locale: 'ro',
    });
    for (let round = 0; round < 20 && gl.maps.length === 0; round += 1) {
        await Promise.resolve();
    }
    gl.map.fire('load');
    const result = await creating;
    if (!result.ok) {
        throw new Error(result.reason);
    }
    const handle: AdminMapHandle =
        draw === null
            ? result.map
            : {
                  ...result.map,
                  preview: result.map.preview,
                  port: result.map.port,
                  draw: () => Promise.resolve(draw),
                  destroy: () => {
                      result.map.destroy();
                  },
              };
    return { handle, native: gl.map };
}

/** A factory whose maps are the given results, in order; `created` counts the asks. */
export function factoryOf(results: readonly AdminMapResult[]): AdminMapFactory & { readonly created: number } {
    const queue = [...results];
    let created = 0;
    return {
        get created() {
            return created;
        },
        create: () => {
            created += 1;
            const result = queue.shift();
            return result === undefined ? Promise.reject(new Error('no more maps')) : Promise.resolve(result);
        },
    };
}

export function host(): HTMLElement {
    return {} as HTMLElement;
}
