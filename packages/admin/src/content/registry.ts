/**
 * The areas' stores (`docs/research/M2c-interfaces.md` §2.1): each is created from its module the first time its page
 * reads it, and every store is destroyed on sign-out. The shell asks them all before leaving an unsaved edit (§2.4).
 */
import type { ThemeTokenSet } from '@hcm/ui/dynamic-color';

import { CONTENT_AREAS, type AreaStore, type ContentArea, type ContentModules, type ContentStores } from './areas.js';
import type { AreaServiceParts, ContentServices, ContentStore } from './services.js';

/** What the entry gives `mount` for the editors (`AdminDeps.content`). */
export interface ContentDeps {
    readonly modules: ContentModules;
    /** Firestore for the editors (`../firebase/content.ts`). */
    readonly store: ContentStore;
    /** `themeFromSeed` of `@hcm/ui/dynamic-color`. */
    readonly theme: (seed: string) => ThemeTokenSet;
    /** The areas' own services (`../app/content-wiring.ts`). */
    readonly areas: AreaServiceParts;
    /** The `e2e` build's `?city=` (CR-M2c-7); otherwise the project's first city. */
    readonly cityId: string | null;
}

type AnyStore = AreaStore<unknown, unknown>;

/** Every member of `ContentModules` is named after its area (the getters below are made from `CONTENT_AREAS`). */
const MODULES_NAMED_BY_AREA: [keyof ContentModules] extends [ContentArea] ? true : false = true;

export class ContentRegistry {
    readonly #modules: ContentModules;
    readonly #services: () => ContentServices;
    readonly #created = new Map<ContentArea, AnyStore>();
    /** What `AdminApp.content` hands the pages. */
    readonly stores: ContentStores;

    constructor(modules: ContentModules, services: () => ContentServices) {
        this.#modules = modules;
        this.#services = services;
        const stores: Partial<Record<ContentArea, AnyStore | null>> = {};
        for (const area of CONTENT_AREAS) {
            Object.defineProperty(stores, area, { enumerable: MODULES_NAMED_BY_AREA, get: () => this.#store(area) });
        }
        this.stores = stores as unknown as ContentStores;
    }

    /** Whether any area holds an edit that leaving would lose. */
    hasUnsavedChanges(): boolean {
        return [...this.#created.values()].some((store) => store.hasUnsavedChanges());
    }

    /** Whether any area runs work that a reload would end (an upload still being sent). */
    busy(): boolean {
        return [...this.#created.values()].some((store) => store.busy?.() === true);
    }

    /** Sign-out: every store detaches and forgets its drafts; the next page visit creates it again. */
    destroyAll(): void {
        for (const store of this.#created.values()) {
            store.destroy();
        }
        this.#created.clear();
    }

    #store(area: ContentArea): AnyStore | null {
        const existing = this.#created.get(area);
        if (existing !== undefined) {
            return existing;
        }
        const module = (this.#modules as Partial<Record<ContentArea, { create(services: ContentServices): AnyStore }>>)[area];
        if (module === undefined) {
            return null;
        }
        const store = module.create(this.#services());
        this.#created.set(area, store);
        return store;
    }
}
