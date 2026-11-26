// The editor areas' test world: `ContentServices` over the shared `FakeContentStore`, the shell's fake clock, storage
// and callables, a recording snackbar and a counter of refused reads (the shell's `admin.session` probe).
import { FakeContentStore } from '@hcm/test-support/fake-content-store';

import type { ThemeTokens } from '@hcm/shared';

import type { AreaServiceParts, ContentNotice, ContentServices, ContentStore } from '../../src/content/services.js';
import { FakeCallables, FakeClock, MemoryStore, testLog } from '../app/fakes.js';

export const CITY = 'bucharest';

/**
 * The areas' own services (`AreaServiceParts`: the photos' uploads, the pois' maps) left out: the ops areas use none of
 * them; a test of an area that does passes its fakes in `contentWorld`'s overrides.
 */
export const NO_AREA_SERVICES = {} as AreaServiceParts;

export interface ContentWorld {
    readonly services: ContentServices;
    readonly store: FakeContentStore;
    readonly callables: FakeCallables;
    readonly clock: FakeClock;
    readonly notices: ContentNotice[];
    readonly denials: { count: number };
    /** Every theme the areas asked the shell to preview (null: the preview ended). */
    readonly previews: (ThemeTokens | null)[];
    /** How often an area asked the shell for the admins' names (a conflict appeared). */
    readonly peopleAsked: { count: number };
}

/** The fake store, as the port it stands for (a compile-time check that the test kit's fake satisfies it). */
export function asContentStore(store: FakeContentStore): ContentStore {
    return store;
}

export function contentWorld(overrides: Partial<ContentServices> = {}): ContentWorld {
    const store = new FakeContentStore();
    const callables = new FakeCallables();
    const clock = new FakeClock();
    const notices: ContentNotice[] = [];
    const denials = { count: 0 };
    const previews: (ThemeTokens | null)[] = [];
    const peopleAsked = { count: 0 };
    const services: ContentServices = {
        ...NO_AREA_SERVICES,
        cityId: CITY,
        adminCityIds: () => [],
        store: asContentStore(store),
        callables,
        theme: () => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} }),
        clock,
        local: new MemoryStore(),
        log: testLog().log,
        user: () => ({ uid: 'admin-uid', name: 'Ana' }),
        locale: () => 'ro',
        cityRole: () => 'owner',
        notify: (notice) => {
            notices.push(notice);
        },
        denied: () => {
            denials.count += 1;
        },
        previewTheme: (tokens) => {
            previews.push(tokens);
        },
        people: () => {
            peopleAsked.count += 1;
        },
        readOnly: () => false,
        ...overrides,
    };
    return { services, store, callables, clock, notices, denials, previews, peopleAsked };
}

/** A Firestore timestamp of the ISO time. */
export function at(iso: string): { readonly seconds: number; readonly nanoseconds: number } {
    const ms = Date.parse(iso);
    return { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000 };
}

/** The item at `index`; a missing one fails the test loudly. */
export function nth<T>(items: readonly T[] | undefined, index = 0): T {
    const found = items?.[index];
    if (found === undefined) {
        throw new Error(`no item ${String(index)}`);
    }
    return found;
}
