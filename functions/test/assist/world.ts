/**
 * The assists' and notifications' test world (`docs/research/M4-interfaces.md` §4, §5): the fn-content fakes
 * (`../publish/fakes.ts`: an in-memory `DocumentStore` that validates like the adapter, a movable clock, the recording
 * task queue, `u-admin` as the admin) plus the three M4 adapters over one world of fake upstreams
 * (`../support/m4-upstreams.ts`), and a city seeded through its schema. Every value is a generated test value.
 */
import {
    FIRESTORE_PATHS,
    adminDocSchema,
    cityDocSchema,
    opsGuardDocSchema,
    timestampFromDate,
    type AdminDoc,
    type CityDoc,
} from '@hcm/shared';
import type { UpstreamFakes } from '@hcm/test-support/fakes';

import type { Geocoder } from '../../src/ports/geocoder.js';
import type { PushSender } from '../../src/ports/push-sender.js';
import type { Translator } from '../../src/ports/translator.js';
import { contentDeps, type ContentDeps } from '../publish/fakes.js';
import { fakeAdmins } from '../support/fakes.js';
import { m4Upstreams } from '../support/m4-upstreams.js';

export const CITY = 'assist-city';
const T0 = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));

export interface M4Deps extends ContentDeps {
    readonly upstream: UpstreamFakes;
    readonly geocoder: Geocoder;
    readonly translator: Translator;
    readonly push: PushSender;
}

/** `u-admin` and `u-second` are admins (the callables' access rule); the documents of `admins/*` are seeded apart. */
export function m4Deps(now = '2026-10-24T08:30:00.000Z'): M4Deps {
    const { fakes, geocoder, translator, push } = m4Upstreams();
    return { ...contentDeps(now), admins: fakeAdmins(['u-admin', 'u-second']), upstream: fakes, geocoder, translator, push };
}

function city(overrides: Partial<CityDoc> = {}): CityDoc {
    return {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.95, south: 44.33, east: 26.25, north: 44.55 },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: T0,
        ...overrides,
    };
}

export async function seedCity(deps: M4Deps, overrides: Partial<CityDoc> = {}): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.city(CITY), cityDocSchema, city(overrides));
}

export async function seedGuard(deps: M4Deps, state: 'green' | 'red'): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, { state, updatedBy: 'system:ops', updatedAt: T0 });
}

export async function seedAdmin(deps: M4Deps, uid: string, overrides: Partial<AdminDoc> = {}): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, {
        role: 'admin',
        // M5: an admin of the world's city (a city's notifications reach its own admins only).
        cities: { [CITY]: 'editor' },
        createdAt: T0,
        updatedBy: 'system:admins',
        updatedAt: T0,
        ...overrides,
    });
}
