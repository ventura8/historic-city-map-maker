/**
 * The editor areas behind one seam (`docs/research/M2c-interfaces.md` §2.1): each area is a DOM-free store of its own
 * module (`packages/admin/src/<area>/`), created when its page first opens and destroyed on sign-out; its Lit page reads
 * it through `AdminAppPort.content` (`@hcm/ui/admin`, `content-port.ts`). Area state never enters `AdminState`: an area
 * re-renders its own page only.
 *
 * `ContentModules` is derived from the pages' `ContentPort` (`@hcm/ui/admin`): an area joins by adding its member to
 * `ContentPort`, inside its own marked section there (§11.2); nothing is listed here.
 */
import type { AreaPort, ContentPort } from '@hcm/ui/admin';

import type { Unsubscribe } from '../app/ports.js';
import type { ContentServices } from './services.js';

/**
 * The areas; `home` is the dashboard (ops-screens, the M2c brief's "dashboard home"); `imagery` and `georef` are M3's
 * (admin-imagery, `docs/research/M3-interfaces.md` §10).
 */
export const CONTENT_AREAS = [
    'photos',
    'pois',
    'layers',
    'settings',
    'admins',
    'history',
    'jobs',
    'crashes',
    'home',
    'imagery',
    'georef',
    /** The tile-import wizard (`docs/research/M20-import-local.md` §19.11): an archive series' sheets laid out by the owner. */
    'help',
    /** M4 (`docs/research/M4-interfaces.md` §5.5): the admin's notifications and push settings. */
    'inbox',
    /** M5 (`docs/research/M5-interfaces.md` §1.6): the project owner's New city flow. */
    'cities',
    /** M13 (`docs/research/M13-roles.md` §8): the review queue and the Contribute page. */
    'review',
    'contribute',
    /** M17 (`docs/research/M17-stories.md` §6): the city's stories. */
    'stories',
] as const;

export type ContentArea = (typeof CONTENT_AREAS)[number];

/** One area's store: created when its page first opens, kept until sign-out. */
export interface AreaStore<State, Intents> {
    readonly state: State;
    subscribe(listener: (state: State) => void): Unsubscribe;
    readonly intents: Intents;
    /** The page shows (the route's params select the item): attach the Firestore listeners. */
    open(params: readonly string[]): void;
    /** The page is gone: detach every listener (a draft is never left behind: the unsaved guard ran first). */
    close(): void;
    /** Whether leaving now would lose an edit. */
    hasUnsavedChanges(): boolean;
    /**
     * Work under way that a reload would end, such as an upload still being sent (the M18 self-reload waits for it); not an
     * edit, so the unsaved guard does not ask about it. None: nothing runs.
     */
    busy?(): boolean;
    /** Sign-out: detach everything and forget every draft. */
    destroy(): void;
}

export interface AreaModule<State, Intents> {
    readonly area: ContentArea;
    create(services: ContentServices): AreaStore<State, Intents>;
}

/** The module of an area whose page reads the port `Port`. */
type ModuleOf<Port> = Port extends AreaPort<infer State, infer Intents> ? AreaModule<State, Intents> : never;

/**
 * One optional module per area (`AdminDeps.content.modules`), derived from the pages' `ContentPort` of `@hcm/ui/admin`:
 * an area joins by adding its member to `ContentPort` (its own section there). Its real store must satisfy the port, which
 * `packages/admin/test/app/admin-port.test.ts` and the area's own port test check. Derived, not listed, so this file
 * imports no area module: each area imports `AreaModule` from here, and a list here would close a circle
 * (dependency-cruiser `no-circular`).
 */
export type ContentModules = { readonly [Area in keyof ContentPort]?: ModuleOf<NonNullable<ContentPort[Area]>> };

/** The store a module creates. */
type StoreOf<M> = M extends AreaModule<infer State, infer Intents> ? AreaStore<State, Intents> : never;

/** Every area's store as the pages read it: created on first read, null when the area has no module. */
export type ContentStores = { readonly [Area in keyof ContentModules]-?: StoreOf<NonNullable<ContentModules[Area]>> | null };
