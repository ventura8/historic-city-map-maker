import type { Locale } from '@hcm/shared';
import type { BrowserContext } from '@playwright/test';

import { E2E_TOKEN } from '../../fixtures/world.js';
import { ADMIN_URL } from '../world.js';
import { contentIdsOf, type ContentIds } from './content-ids.js';
import type { EmulatorWorld, SignedInAccount } from './emulators.js';
import { signInContext } from './session.js';

/**
 * A content world (docs/research/M2c-interfaces.md §12.3, CR-M2c-7): one test's own city and its own Google account, an
 * admin of the map, so the editors' specs and the admin tour run in parallel beside the locked admin tests, whose reset
 * keeps it (`content-ids.ts`). Its address names the city (`?city=`) and the admin map's token (`?mapToken=`, the e2e
 * token the mock Mapbox accepts) for the `e2e` build's kit: the singleton `setup/status`, which the locked Setup specs
 * rewrite, is never needed. Everything is written past the rules, as the server or an earlier session would have.
 */

/**
 * When a content world's admin joined: a fixed time, never the wall clock, and a day after the locked specs' personas
 * (their seed time), so the Admins page, which lists the oldest admins first, shows the personas whatever content worlds
 * run meanwhile.
 */
const JOINED = new Date('2026-10-02T09:00:00Z');

/** The city of `infra/project.json` the admin edits without `?city=` (the locked admin specs'). */
export const PROJECT_CITY = 'bucharest';

/** What the areas' seed helpers write into: the emulators, a city and the admin who wrote it. */
export interface CityWorld {
    readonly emulators: EmulatorWorld;
    readonly city: string;
    readonly uid: string;
}

/** The project's own city, for a locked admin spec signed in as `uid`. */
export function projectCity(emulators: EmulatorWorld, uid: string): CityWorld {
    return { emulators, city: PROJECT_CITY, uid };
}

export class ContentWorld implements CityWorld {
    readonly emulators: EmulatorWorld;
    readonly ids: ContentIds;
    readonly account: SignedInAccount;

    private constructor(emulators: EmulatorWorld, ids: ContentIds, account: SignedInAccount) {
        this.emulators = emulators;
        this.ids = ids;
        this.account = account;
    }

    /**
     * A new world of the test `testId`: a city nobody wrote yet, its account signed in, recorded as an admin of the map
     * (`admins/<uid>` and the `admin` claim, as `admin.join` leaves them) and signed in again, so its ID token carries the
     * claim.
     */
    static async prepare(emulators: EmulatorWorld, testId: string): Promise<ContentWorld> {
        const ids = contentIdsOf(testId);
        const first = await emulators.signInAs(ids);
        const stamp = { updatedBy: first.uid, updatedAt: JOINED };
        await emulators.setDocument(`admins/${first.uid}`, {
            role: 'admin',
            // M5 (docs/research/M5-interfaces.md §8, CR-M5-3): the owner of the world's own city, and of no other.
            cities: { [ids.city]: 'owner' },
            email: first.email,
            invitedBy: first.uid,
            createdAt: JOINED,
            ...stamp,
        });
        await emulators.setClaims(first.uid, { admin: true });
        return new ContentWorld(emulators, ids, await emulators.signInAs(ids));
    }

    /** The city this world edits (`w-<10 hex>`). */
    get city(): string {
        return this.ids.city;
    }

    get uid(): string {
        return this.account.uid;
    }

    /** `cities/<city>`, or a path below it (`photos/p1`). */
    path(below?: string): string {
        return below === undefined ? `cities/${this.city}` : `cities/${this.city}/${below}`;
    }

    /** A document of the city (`photos/p1`; the city itself without a path), or undefined. */
    document(below?: string): Promise<Record<string, unknown> | undefined> {
        return this.emulators.document(this.path(below));
    }

    /** Every document of a collection of the city (`photos`), by id. */
    collection(below: string): Promise<Record<string, Record<string, unknown>>> {
        return this.emulators.collection(this.path(below));
    }

    /** Writes a whole document of the city, past the rules. */
    setDocument(below: string | undefined, data: Readonly<Record<string, unknown>>): Promise<void> {
        return this.emulators.setDocument(this.path(below), data);
    }

    /**
     * The admin's address for this world in `lang` at `route` (`photos/p1`), absolute (the tour's projects serve the
     * site): the city, the map's token (`map` false: none, and the page shows the unavailable map), and the language.
     */
    address(lang: Locale, route?: string, options: { readonly map?: boolean } = {}): string {
        // `none`: no map, whatever `setup/status` holds (a locked Setup spec may have written a token there meanwhile).
        const query = new URLSearchParams({ lang, city: this.city, mapToken: options.map === false ? 'none' : E2E_TOKEN });
        const hash = route === undefined ? '' : `#/${route}`;
        return `${ADMIN_URL}?${query.toString()}${hash}`;
    }

    /** Every admin tab of `context` opens signed in as this world's account (the token's expiry is the browser's wall clock). */
    async signIn(context: BrowserContext): Promise<void> {
        await signInContext(context, this.account, Date.now());
    }

    /**
     * Ends the world: its `admins` document goes, so the locked specs' Admins page lists only the worlds of the tests still
     * running, and so does its city's document, so the functions' project-wide walks over the `cities` collection (the
     * pipeline's running places, the Mapbox tileset limit, the tick) see only those worlds too (`docs/LESSONS.md` 169).
     * What lies below the city, its account and its Storage files stay for the reports (a run's emulators start empty).
     */
    async retire(): Promise<void> {
        await this.emulators.deleteDocument(`admins/${this.uid}`);
        await this.emulators.deleteDocument(this.path());
    }
}
