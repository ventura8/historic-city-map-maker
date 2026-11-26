/**
 * The side-loaded full-size view (docs/ENGINE_API.md → *Side-loaded parts*): `mount` hands the viewer a loader that adds
 * `engine.extras.js` from the engine's folder (or `config.engineBase`), with its integrity.
 */
import { describe, expect, it, vi } from 'vitest';

import { EXTRAS_PART_FILE, EXTRAS_PART_INTEGRITY } from '../src/extras-part.js';
import { mount } from '../src/mount.js';
import { FakeContainer, config, testEnvironment } from './mount-support.js';

describe('the full-size view', () => {
    it('happyPath_theViewerLoadsItFromTheConfiguredBase', async () => {
        const world = testEnvironment();
        const loadExtras = vi.fn(() => Promise.resolve());

        mount(new FakeContainer().element, config({ engineBase: 'https://cdn.example.org/hcm/' }), { ...world.env, loadExtras });
        await world.viewer.element.services.loadExtras?.();

        expect(loadExtras).toHaveBeenCalledWith('https://cdn.example.org/hcm/');
    });

    it('badPath_withoutALoaderTheViewerKeepsItsOwnServices', () => {
        const world = testEnvironment();
        const before = world.viewer.element.services;

        mount(new FakeContainer().element, config(), world.env);

        expect(world.viewer.element.services).toBe(before);
    });

    it('happyPath_theSourcesNameThePartWithoutIntegrity', () => {
        expect([EXTRAS_PART_FILE, EXTRAS_PART_INTEGRITY]).toEqual(['engine.extras.js', '']);
    });
});
