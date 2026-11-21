import { describe, expect, it } from 'vitest';

import type { AreaModule, AreaStore } from '../../src/content/areas.js';
import { ContentRegistry } from '../../src/content/registry.js';
import { contentWorld } from './world.js';

interface Probe {
    created: number;
    destroyed: number;
    unsaved: boolean;
}

function probeModule(probe: Probe): AreaModule<{ readonly n: number }, { readonly ping: () => string }> {
    return {
        area: 'jobs',
        create: () => {
            probe.created += 1;
            const store: AreaStore<{ readonly n: number }, { readonly ping: () => string }> = {
                state: { n: 1 },
                subscribe: () => () => undefined,
                intents: { ping: () => 'pong' },
                open: () => undefined,
                close: () => undefined,
                hasUnsavedChanges: () => probe.unsaved,
                destroy: () => {
                    probe.destroyed += 1;
                },
            };
            return store;
        },
    };
}

describe('ContentRegistry', () => {
    it('happyPath_createsAStoreOnFirstReadKeepsItAndDestroysEveryStoreOnSignOut', () => {
        const probe: Probe = { created: 0, destroyed: 0, unsaved: false };
        const { services } = contentWorld();
        const registry = new ContentRegistry({ jobs: probeModule(probe) as never }, () => services);

        const first = registry.stores.jobs;
        const second = registry.stores.jobs;
        probe.unsaved = true;
        const unsaved = registry.hasUnsavedChanges();
        registry.destroyAll();
        const third = registry.stores.jobs;

        expect(first).toBe(second);
        expect(third).not.toBe(first);
        expect([probe.created, probe.destroyed, unsaved]).toEqual([2, 1, true]);
        expect(Object.keys(registry.stores)).toContain('photos');
    });

    // Review of M18 item 1: an area without `busy` runs nothing a reload would end; one that reports it holds the reload.
    it('happyPath_busyAsksOnlyTheAreasThatRunWork', () => {
        const { services } = contentWorld();
        const quiet = new ContentRegistry({ jobs: probeModule({ created: 0, destroyed: 0, unsaved: false }) as never }, () => services);
        const running = new ContentRegistry(
            {
                imagery: {
                    area: 'imagery',
                    create: () => ({ ...probeModule({ created: 0, destroyed: 0, unsaved: false }).create(services), busy: () => true }),
                } as never,
            },
            () => services,
        );

        const before = [quiet.busy(), running.busy()];
        expect([quiet.stores.jobs, running.stores.imagery]).not.toContain(null);

        expect([...before, quiet.busy(), running.busy()]).toEqual([false, false, false, true]);
    });

    it('badPath_anAreaWithoutAModuleHasNoStoreAndNothingIsUnsaved', () => {
        const registry = new ContentRegistry({}, () => {
            throw new Error('never asked');
        });

        expect([registry.stores.history, registry.stores.home, registry.hasUnsavedChanges()]).toEqual([null, null, false]);
    });
});
