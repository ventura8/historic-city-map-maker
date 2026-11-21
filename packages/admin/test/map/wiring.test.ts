import { createLogger, FIRESTORE_PATHS } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { FakeMapboxGl } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import { adminMapFactoryOf, adminTokenOf, cityTokenOf, type AdminMapScope } from '../../src/map/wiring.js';

function log(): { readonly log: ReturnType<typeof createLogger>; readonly warnings: () => readonly string[] } {
    const sink = createRecordingSink();
    return { log: createLogger('wiring-test', { sink: sink.sink }), warnings: () => sink.records.map((record) => record.message) };
}

/** A page whose `mapboxgl` is already there (the loader adds no script then). */
function scope(reducedMotion: boolean | null): AdminMapScope {
    const gl = new FakeMapboxGl({ supported: true });
    return {
        mapboxgl: gl,
        document: { createElement: () => ({}), head: { append: () => undefined } } as unknown as AdminMapScope['document'],
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => undefined,
        ...(reducedMotion === null ? {} : { matchMedia: () => ({ matches: reducedMotion }) }),
    } as unknown as AdminMapScope;
}

describe('the admin map wiring', () => {
    it('happyPath_theAdminTokenIsReadFromSetupStatus', async () => {
        const reads: string[] = [];
        const { log: logger } = log();

        const token = await adminTokenOf((path) => {
            reads.push(path);
            return Promise.resolve({ mapbox: { adminToken: 'pk.admin-token' } });
        }, logger);

        expect(token).toBe('pk.admin-token');
        expect(reads).toEqual([FIRESTORE_PATHS.setupStatus]);
    });

    it('badPath_aMissingSecretOrUnreadableTokenIsNone', async () => {
        const { log: logger, warnings } = log();

        expect(await adminTokenOf(() => Promise.resolve(null), logger)).toBeNull();
        expect(await adminTokenOf(() => Promise.resolve({ mapbox: 'x' }), logger)).toBeNull();
        expect(await adminTokenOf(() => Promise.resolve({ mapbox: { adminToken: 'sk.secret' } }), logger)).toBeNull();
        expect(await adminTokenOf(() => Promise.reject(new Error('permission-denied')), logger)).toBeNull();
        expect(warnings()).toEqual(['setup status unreadable: no admin map']);
    });

    it('happyPath_theFactoryUsesThePagesMapboxAndReducedMotion', async () => {
        const page = scope(true);
        const { log: logger } = log();
        const factory = adminMapFactoryOf({
            scope: page,
            readDoc: () => Promise.resolve({ mapbox: { adminToken: 'pk.t' } }),
            terraDraw: null,
            log: logger,
        });

        const creating = factory.create({} as HTMLElement, {
            bounds: [
                [26, 44.3],
                [26.3, 44.55],
            ],
            view: { center: [26.1, 44.43], zoom: 13, bearing: 0 },
            locale: 'en',
        });
        const gl = page.mapboxgl as FakeMapboxGl;
        for (let round = 0; round < 20 && gl.maps.length === 0; round += 1) {
            await Promise.resolve();
        }
        gl.map.fire('load');
        const result = await creating;

        expect(result.ok).toBe(true);
        if (result.ok) {
            result.map.port.flyTo({ zoom: 15 });
        }
        expect(gl.map.callsOf('jumpTo')).toEqual([[{ zoom: 15 }]]);
        expect(gl.map.options.accessToken).toBe('pk.t');
    });

    it('happyPath_theE2eBuildsFixedTokenIsUsedWithoutReadingSetupStatus', async () => {
        const page = scope(false);
        const reads: string[] = [];
        const { log: logger } = log();
        const readDoc = (path: string): Promise<null> => {
            reads.push(path);
            return Promise.resolve(null);
        };
        const fixed = adminMapFactoryOf({ scope: page, readDoc, terraDraw: null, log: logger, fixedToken: 'pk.e2e-fixed' });
        const secret = adminMapFactoryOf({ scope: page, readDoc, terraDraw: null, log: logger, fixedToken: 'sk.secret' });
        const none = adminMapFactoryOf({ scope: page, readDoc, terraDraw: null, log: logger, fixedToken: null });
        const options = {
            bounds: [
                [26, 44.3],
                [26.3, 44.55],
            ] as const,
            view: { center: [26.1, 44.43] as const, zoom: 13, bearing: 0 },
            locale: 'ro' as const,
        };

        const creating = fixed.create({} as HTMLElement, options);
        const gl = page.mapboxgl as FakeMapboxGl;
        for (let round = 0; round < 20 && gl.maps.length === 0; round += 1) {
            await Promise.resolve();
        }
        gl.map.fire('load');

        expect((await creating).ok).toBe(true);
        expect(gl.map.options.accessToken).toBe('pk.e2e-fixed');
        expect(reads).toEqual([]);
        // A value that is not a public token, or none at all, is no token: setup/status is not read either.
        expect(await secret.create({} as HTMLElement, options)).toEqual({ ok: false, reason: 'no-token' });
        expect(await none.create({} as HTMLElement, options)).toEqual({ ok: false, reason: 'no-token' });
        expect(reads).toEqual([]);
    });

    it('badPath_aPageWithoutMatchMediaAnimates', async () => {
        const page = scope(null);
        const { log: logger } = log();
        const factory = adminMapFactoryOf({ scope: page, readDoc: () => Promise.resolve(null), terraDraw: null, log: logger });

        const result = await factory.create({} as HTMLElement, {
            bounds: [
                [26, 44.3],
                [26.3, 44.55],
            ],
            view: { center: [26.1, 44.43], zoom: 13, bearing: 0 },
            locale: 'ro',
        });

        expect(result).toEqual({ ok: false, reason: 'no-token' });
    });
});

describe('M13: a role that cannot read Setup (docs/research/M13-roles.md §8)', () => {
    const denied = (path: string): Promise<Readonly<Record<string, unknown>> | null> => {
        if (path === FIRESTORE_PATHS.setupStatus) {
            return Promise.reject(new Error('permission-denied'));
        }
        return Promise.resolve(path === FIRESTORE_PATHS.city('cluj') ? { mapbox: { publicToken: 'pk.city-token' } } : null);
    };
    const created = (readDoc: typeof denied, cityId?: string) => {
        const factory = adminMapFactoryOf({ scope: scope(null), readDoc, terraDraw: null, log: log().log });
        const options = {
            bounds: [
                [25, 44],
                [27, 45],
            ],
            view: { center: [26, 44.5], zoom: 12, bearing: 0 },
            locale: 'ro',
        } as const;
        return factory.create({} as HTMLElement, { ...options, ...(cityId === undefined ? {} : { cityId }) });
    };

    it('happyPath_theCitysPublicTokenServes', async () => {
        await expect(cityTokenOf(denied, 'cluj')).resolves.toBe('pk.city-token');
    });

    it('badPath_noCityNoToken', async () => {
        await expect(created(denied)).resolves.toEqual({ ok: false, reason: 'no-token' });
        await expect(cityTokenOf(denied, undefined)).resolves.toBeNull();
    });

    it('badPath_aCityWithNoTokenOrARefusedRead', async () => {
        await expect(created(denied, 'bucharest')).resolves.toEqual({ ok: false, reason: 'no-token' });
        await expect(created(() => Promise.reject(new Error('denied')), 'cluj')).resolves.toEqual({ ok: false, reason: 'no-token' });
    });
});
