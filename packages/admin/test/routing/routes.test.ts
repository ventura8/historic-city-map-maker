import { describe, expect, it } from 'vitest';

import { ADMIN_ROUTE_SPECS, ADMIN_ROUTES, adminRouteHash, DEFAULT_ADMIN_ROUTE, parseAdminRoute } from '../../src/routing/routes.js';

describe('ADMIN_ROUTE_SPECS', () => {
    it('happyPath_onlySetupWorksWithoutTheServer', () => {
        expect(ADMIN_ROUTES.filter((id) => !ADMIN_ROUTE_SPECS[id].needsBackend)).toEqual(['setup']);
        expect(DEFAULT_ADMIN_ROUTE).toEqual({ id: 'setup', params: [] });
    });

    it('happyPath_theCompactBarHoldsFourDestinationsPlusMore', () => {
        expect(ADMIN_ROUTES.filter((id) => ADMIN_ROUTE_SPECS[id].inCompactBar)).toEqual(['setup', 'photos', 'pois', 'layers']);
    });
});

describe('parseAdminRoute', () => {
    it.each([
        ['#/setup', { id: 'setup', params: [] }],
        ['#setup', { id: 'setup', params: [] }],
        ['#/setup/usgs', { id: 'setup', params: ['usgs'] }],
        ['#/photos/coltul-strada-fonteriei', { id: 'photos', params: ['coltul-strada-fonteriei'] }],
        ['#/history/photo/arionoaia-1980', { id: 'history', params: ['photo', 'arionoaia-1980'] }],
        ['#/home', { id: 'home', params: [] }],
    ])('happyPath_%s', (hash, route) => {
        expect(parseAdminRoute(hash)).toEqual(route);
    });

    it.each([
        ['an empty hash', ''],
        ['the root', '#/'],
        ['an unknown route', '#/billing'],
        ['a route of another case', '#/Setup'],
        ['three segments', '#/history/photo/a/b'],
        ['a segment with a dot', '#/photos/../setup'],
        ['an empty segment', '#/photos//'],
        ['a query', '#/photos?id=1'],
    ])('badPath_%s_isNotARoute', (_name, hash) => {
        expect(parseAdminRoute(hash)).toBeNull();
    });
});

describe('adminRouteHash', () => {
    it('happyPath_isTheInverseOfParsing', () => {
        const hashes = ['#/setup', '#/admins', '#/history/poi/gara-obor'];

        expect(hashes.map((hash) => adminRouteHash(parseAdminRoute(hash) ?? DEFAULT_ADMIN_ROUTE))).toEqual(hashes);
    });
});
