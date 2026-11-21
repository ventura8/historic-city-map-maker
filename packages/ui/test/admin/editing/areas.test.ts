import { describe, expect, it } from 'vitest';

import type { AreaElements } from '../../../src/admin/areas/area.js';

/** Each area's entry, as the admin's lazy chunks import them (DECISIONS-for-review.md §34b). */
const AREAS: Readonly<Record<string, () => Promise<{ readonly AREA_ELEMENTS: AreaElements }>>> = {
    photos: () => import('../../../src/admin/areas/photos.js'),
    pois: () => import('../../../src/admin/areas/pois.js'),
    layers: () => import('../../../src/admin/areas/layers.js'),
    settings: () => import('../../../src/admin/areas/settings.js'),
    home: () => import('../../../src/admin/areas/home.js'),
    admins: () => import('../../../src/admin/areas/admins.js'),
    history: () => import('../../../src/admin/areas/history.js'),
    jobs: () => import('../../../src/admin/areas/jobs.js'),
    crashes: () => import('../../../src/admin/areas/crashes.js'),
    // M4 (docs/research/M4-interfaces.md §5.5): the inbox.
    inbox: () => import('../../../src/admin/areas/inbox.js'),
};

describe('the areas entries', () => {
    it.each(Object.entries(AREAS))('happyPath_ %s registers its page under its tag, once', async (area, load) => {
        const { AREA_ELEMENTS } = await load();
        const defined = new Map<string, CustomElementConstructor>();
        const registry = {
            get: (tag: string) => defined.get(tag),
            define: (tag: string, element: CustomElementConstructor) => defined.set(tag, element),
        } as unknown as CustomElementRegistry;

        AREA_ELEMENTS.define(registry);
        AREA_ELEMENTS.define(registry);

        expect(AREA_ELEMENTS.tag).toBe(`hcm-${area === 'crashes' ? 'crashes-list' : area}-page`);
        expect(defined.has(AREA_ELEMENTS.tag)).toBe(true);
    });

    // The settings chunk showed an empty box where its map should be: the page rendered <hcm-admin-map>, which only the
    // layers, places and photos chunks defined (DECISIONS-for-review.md §42a).
    it.each(['layers', 'settings', 'pois', 'photos'])(
        'badPath_ %s defines the admin map it renders, whatever chunk came first',
        async (area) => {
            const load = AREAS[area];
            const defined = new Set<string>();
            const registry = {
                get: () => undefined,
                define: (tag: string) => defined.add(tag),
            } as unknown as CustomElementRegistry;

            (await load?.())?.AREA_ELEMENTS.define(registry);

            expect([...defined]).toContain('hcm-admin-map');
        },
    );
});
