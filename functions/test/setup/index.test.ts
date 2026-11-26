/**
 * The `setup.*` callables end to end through their v2 `.run()` entry point (M2-interfaces §3.0, §3.3): the registry's
 * access rule, request validation, the handler over the fake upstreams, and the response validated against its schema
 * (a response the schema refuses would be answered `apiError.internal`), with failures as `HttpsError(status, code,
 * details)`.
 */
import { CALLABLES, apiErrorDetailsSchema } from '@hcm/shared';
import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { HttpsError } from 'firebase-functions/https';
import { describe, expect, it } from 'vitest';

import { defineSetupFunctions } from '../../src/setup/index.js';
import { CITY, adminToken, callableRequest, createWorld, rejection, type World } from './world.js';

function functionsOf(world: World) {
    return defineSetupFunctions(() => world.deps);
}

async function httpsFailure(promise: Promise<unknown>): Promise<{ readonly status: string; readonly details: unknown }> {
    const error = await rejection(promise);
    if (!(error instanceof HttpsError)) {
        throw error;
    }
    return { status: error.code, details: apiErrorDetailsSchema.parse(error.details) };
}

describe('setup callables', () => {
    it('happyPath_exportsTheRegistrysSetupCallables', () => {
        const registered = Object.entries(CALLABLES)
            .filter(([, spec]) => spec.owner === 'fn-setup')
            .map(([name]) => name.replace('setup.', ''));

        expect(Object.keys(functionsOf(createWorld())).toSorted((a, b) => a.localeCompare(b))).toEqual(
            registered.toSorted((a, b) => a.localeCompare(b)),
        );
    });

    it('happyPath_eachDeploysInUsCentral1WithItsInstanceCap', () => {
        const callables = functionsOf(createWorld());

        expect(Object.values(callables).map((callable) => callable.__endpoint)).toEqual(
            Object.values(callables).map(
                () =>
                    expect.objectContaining({
                        platform: 'gcfv2',
                        region: ['us-central1'],
                        maxInstances: 3,
                        callableTrigger: {},
                    }) as unknown,
            ),
        );
    });

    it('happyPath_theWholeSetupFlowAnswersWhatTheRegistrySays', async () => {
        const world = createWorld({ city: false });
        world.upstream.scenario('firebase-management.analyticsLinked');
        const setup = functionsOf(world);
        const city = { name: { ro: 'București', en: 'Bucharest' }, bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 } };

        await expect(setup.createCity.run(callableRequest({ cityId: CITY, city }))).resolves.toEqual({ created: true });
        await expect(setup.createCity.run(callableRequest({ cityId: CITY, city }))).resolves.toEqual({ created: false });
        await expect(setup.recordCloud.run(callableRequest({ billing: { state: 'ok' } }))).resolves.toMatchObject({
            status: { billing: { state: 'ok' } },
        });
        await expect(
            setup.saveMapbox.run(callableRequest({ cityId: CITY, secretToken: ` ${MAPBOX_TOKENS.bootstrap} ` })),
        ).resolves.toMatchObject({
            mapbox: { state: 'ok' },
        });
        await expect(setup.saveUsgs.run(callableRequest({ ...USGS_CREDENTIALS.approved, expiresOn: '2027-01-31' }))).resolves.toMatchObject(
            {
                usgs: { state: 'ok', role: 'download' },
            },
        );
        await expect(setup.rotatePublicToken.run(callableRequest({ cityId: CITY, audience: 'viewer' }))).resolves.toMatchObject({
            manifestQueued: true,
        });
        await expect(setup.analyticsConfig.run(callableRequest({ cityId: CITY }))).resolves.toMatchObject({ analytics: { state: 'ok' } });
        await expect(setup.selfTest.run(callableRequest({}))).resolves.toMatchObject({ status: { secretsRev: 2 } });
        await expect(setup.status.run(callableRequest({}))).resolves.toMatchObject({
            mapbox: { state: 'ok' },
            usgs: { state: 'ok' },
            ready: false,
        });
        expect(world.upstream.secretValue('mapbox-sk-bootstrap')).toBe(MAPBOX_TOKENS.bootstrap);
    });

    it('badPath_anAnonymousCallerIsUnauthenticated', async () => {
        await expect(httpsFailure(functionsOf(createWorld()).status.run(callableRequest({}, null)))).resolves.toEqual({
            status: 'unauthenticated',
            details: { code: 'apiError.unauthenticated' },
        });
    });

    it('badPath_aSignedInNonAdminIsRefused', async () => {
        const stranger = { uid: 'u-stranger', token: adminToken({ admin: undefined }) };

        await expect(
            httpsFailure(functionsOf(createWorld()).saveUsgs.run(callableRequest(USGS_CREDENTIALS.approved, stranger))),
        ).resolves.toEqual({
            status: 'permission-denied',
            details: { code: 'apiError.notAdmin' },
        });
    });

    it('badPath_anInvalidRequestListsItsFields', async () => {
        const world = createWorld();

        await expect(
            httpsFailure(functionsOf(world).saveMapbox.run(callableRequest({ cityId: 'Not A City', secretToken: '' }))),
        ).resolves.toMatchObject({
            status: 'invalid-argument',
            details: { code: 'apiError.invalidRequest', params: { count: '2' } },
        });
        expect(world.upstream.calls).toEqual([]);
    });

    it('badPath_aHandlerFailureArrivesAsItsCode', async () => {
        const world = createWorld();

        await expect(
            httpsFailure(functionsOf(world).saveMapbox.run(callableRequest({ cityId: CITY, secretToken: MAPBOX_TOKENS.defaultPublic }))),
        ).resolves.toEqual({
            status: 'invalid-argument',
            details: { code: 'apiError.mapbox.publicToken' },
        });
        expect(world.logged()).not.toContain(MAPBOX_TOKENS.defaultPublic);
    });

    it('badPath_anUnmappedUpstreamFailureIsLoggedAndGeneric', async () => {
        const world = createWorld();
        world.intercept = (_method, url) =>
            url.pathname.endsWith('/login-token') ? new Response('{"errorCode":"VERSION_UNKNOWN"}', { status: 500 }) : undefined;

        await expect(httpsFailure(functionsOf(world).saveUsgs.run(callableRequest(USGS_CREDENTIALS.approved)))).resolves.toEqual({
            status: 'internal',
            details: { code: 'apiError.internal' },
        });
        expect(world.records.at(-1)).toMatchObject({ level: 'error', scope: 'functions:setup.saveUsgs', message: 'callable failed' });
        expect(world.logged()).not.toContain(USGS_CREDENTIALS.approved.applicationToken);
    });
});
