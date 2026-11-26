/**
 * The city the editor areas work on (`packages/admin/src/app/content-services.ts`, M5-interfaces §1.5; behaviour A49):
 * the shell's current city once `admin.session` decided it, else the `e2e` build's own, else the project's first.
 */
import { FakeContentStore } from '@hcm/test-support/fake-content-store';
import { describe, expect, it } from 'vitest';

import { contentServices, type ContentShell } from '../../src/app/content-services.js';
import { FakeCallables, FakeClock, MemoryStore, shellStateAccess, testLog } from './fakes.js';

function shellOf(cityId: string | null, e2eCity: string | null, cities: readonly string[]): ContentShell {
    return {
        content: {
            modules: {},
            store: new FakeContentStore(),
            theme: () => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} }),
            areas: {} as ContentShell['content']['areas'],
            cityId: e2eCity,
        },
        cities,
        callables: new FakeCallables(),
        clock: new FakeClock(),
        local: new MemoryStore(),
        log: testLog().log,
        shell: shellStateAccess({ cityId }),
        denied: () => undefined,
    };
}

describe('the city the areas edit', () => {
    it.each([
        ['the shell has chosen one', 'cluj', 'e2e-city', ['bucharest'], 'cluj'],
        ['the shell has not chosen yet, in the e2e build', null, 'e2e-city', ['bucharest'], 'e2e-city'],
        ['the shell has not chosen yet', null, null, ['bucharest', 'cluj'], 'bucharest'],
    ] as const)('happyPath_%s', (_name, chosen, e2eCity, cities, expected) => {
        expect(contentServices(shellOf(chosen, e2eCity, cities)).cityId).toBe(expected);
    });

    it('badPath_aProjectWithoutCitiesEditsNone', () => {
        expect(contentServices(shellOf(null, null, [])).cityId).toBe('');
    });
});

describe('M13: the open city, told to what needs it', () => {
    function shellWith(maps: unknown): ContentShell {
        const base = shellOf('cluj', null, ['bucharest']);
        return { ...base, content: { ...base.content, areas: { maps } as ContentShell['content']['areas'] } };
    }

    it('happyPath_theRoleInTheOpenCity', () => {
        const base = shellOf('cluj', null, []);
        const shell = {
            ...base,
            shell: shellStateAccess({ cityId: 'cluj', cities: [{ id: 'cluj', role: 'moderator', name: { ro: 'Cluj' } }] }),
        };
        expect(contentServices(shell).cityRole()).toBe('moderator');
    });

    it('badPath_noRoleInACityNotListed', () => {
        expect(contentServices(shellOf('cluj', null, [])).cityRole()).toBeNull();
    });

    it('happyPath_theMapIsToldTheCity', async () => {
        const asked: unknown[] = [];
        const maps = {
            create: (_container: HTMLElement, options: unknown) => {
                asked.push(options);
                return Promise.resolve({ ok: false, reason: 'failed' });
            },
        };
        const services = contentServices(shellWith(maps));
        await services.maps?.create({} as HTMLElement, {
            bounds: [
                [0, 0],
                [1, 1],
            ],
            view: { center: [0, 0], zoom: 1, bearing: 0 },
            locale: 'ro',
        });
        expect(asked).toEqual([expect.objectContaining({ cityId: 'cluj' })]);
    });

    it('badPath_noMapWithoutAFactory', () => {
        expect(contentServices(shellWith(null)).maps).toBeNull();
        expect(contentServices(shellWith(undefined)).maps).toBeUndefined();
    });
});
