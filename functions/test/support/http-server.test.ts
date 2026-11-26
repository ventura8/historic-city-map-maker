/**
 * The fake upstreams over HTTP (`@hcm/test-support/fakes/http`): forwarded requests `/h/<host><path>`, one world per
 * `x-hcm-test` partition, and the `/__upstream/…` control endpoints the Playwright admin tier drives. Loopback only.
 */
import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { createUpstreamExtension, startUpstreamServer, UPSTREAM_TEST_HEADER, type UpstreamServer } from '@hcm/test-support/fakes/http';
import { afterEach, describe, expect, it } from 'vitest';

let server: UpstreamServer | undefined;

afterEach(async () => {
    await server?.close();
    server = undefined;
});

async function started(setup?: Parameters<typeof startUpstreamServer>[0]): Promise<UpstreamServer> {
    server = await startUpstreamServer(setup);
    return server;
}

describe('startUpstreamServer', () => {
    it('happyPath_aForwardedRequestReachesTheFakesAndIsRecordedInItsPartition', async () => {
        const upstream = await started();

        const response = await fetch(`${upstream.origin}/h/api.mapbox.com/tokens/v2?access_token=${MAPBOX_TOKENS.bootstrap}`, {
            headers: { [UPSTREAM_TEST_HEADER]: 'test-a' },
        });
        const calls = await (await fetch(`${upstream.origin}/__upstream/calls?test=test-a&operation=mapbox`)).json();
        const other = await (await fetch(`${upstream.origin}/__upstream/calls?test=test-b`)).json();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ code: 'TokenValid' });
        expect(calls).toEqual([expect.objectContaining({ operation: 'mapbox.tokens.retrieve', status: 200 })]);
        expect(other).toEqual([]);
    });

    it('happyPath_aScenarioChangesOnlyItsOwnPartition', async () => {
        const upstream = await started();
        const login = (test: string) =>
            fetch(`${upstream.origin}/h/m2m.cr.usgs.gov/api/api/json/stable/login-token`, {
                method: 'POST',
                headers: { [UPSTREAM_TEST_HEADER]: test, 'content-type': 'application/json' },
                body: JSON.stringify({ username: USGS_CREDENTIALS.approved.username, token: USGS_CREDENTIALS.approved.applicationToken }),
            });

        const applied = await fetch(`${upstream.origin}/__upstream/fail?test=offline`, {
            method: 'POST',
            body: JSON.stringify({ service: 'usgs', mode: 'maintenance' }),
        });

        expect(applied.status).toBe(204);
        expect((await login('offline')).status).toBe(503);
        expect((await login('online')).status).toBe(200);
        expect(
            (
                await fetch(`${upstream.origin}/__upstream/scenario?test=online`, {
                    method: 'POST',
                    body: JSON.stringify({ name: 'usgs.tokenExpired' }),
                })
            ).status,
        ).toBe(204);
        const expired = await login('online');
        expect([expired.status, expired.headers.get('content-type')]).toEqual([403, 'text/html; charset=iso-8859-1']);
    });

    it('badPath_anUnknownScenarioOrModeIsA400WithTheReason', async () => {
        const upstream = await started();

        const scenario = await fetch(`${upstream.origin}/__upstream/scenario`, { method: 'POST', body: JSON.stringify({ name: 'nope' }) });
        const fail = await fetch(`${upstream.origin}/__upstream/fail`, { method: 'POST', body: 'not json' });

        expect(scenario.status).toBe(400);
        await expect(scenario.json()).resolves.toEqual({ message: 'unknown upstream scenario nope' });
        expect(fail.status).toBe(400);
    });

    it('happyPath_snapshotScenariosResetAndHealth', async () => {
        const upstream = await started({
            setup: (fakes) => {
                fakes.scenario('error-reporting.twoGroups');
            },
        });

        const snapshot = (await (await fetch(`${upstream.origin}/__upstream/snapshot?test=t1`)).json()) as Record<string, unknown>;
        const names = (await (await fetch(`${upstream.origin}/__upstream/scenarios`)).json()) as string[];
        await fetch(`${upstream.origin}/h/nominatim.openstreetmap.org/reverse?lat=44.4&lon=26.1`, {
            headers: { [UPSTREAM_TEST_HEADER]: 't1' },
        });
        const reset = await fetch(`${upstream.origin}/__upstream/reset?test=t1`, { method: 'POST' });
        const afterReset = await (await fetch(`${upstream.origin}/__upstream/calls?test=t1`)).json();
        await fetch(`${upstream.origin}/__upstream/reset`, { method: 'POST' });

        expect(JSON.stringify(snapshot['error-reporting'])).toContain('CNe2e0group0001');
        expect(names).toEqual(
            expect.arrayContaining(['google.provisioned', 'usgs.m2mApproved', 'mapbox.upgraded', 'cloud-billing.enabled']),
        );
        expect(reset.status).toBe(204);
        expect(afterReset).toEqual([]);
        expect(await (await fetch(`${upstream.origin}/__health`)).text()).toBe('ok');
    });

    it('badPath_anUnknownHostPathOrEndpointIsNotMocked', async () => {
        const upstream = await started();

        const unknownHost = await fetch(`${upstream.origin}/h/example.test/anything`);
        const unknownControl = await fetch(`${upstream.origin}/__upstream/nothing`);
        const bare = await fetch(`${upstream.origin}/h/api.mapbox.com`);

        expect([unknownHost.status, unknownControl.status, bare.status]).toEqual([404, 404, 404]);
        await expect(unknownHost.text()).resolves.toBe('not mocked');
    });

    it('happyPath_upstreamHeadersTravelBack', async () => {
        const upstream = await started({
            setup: (fakes) => {
                fakes.fail('mapbox', 'rateLimited');
            },
        });

        const response = await fetch(`${upstream.origin}/h/api.mapbox.com/tokens/v2?access_token=${MAPBOX_TOKENS.bootstrap}`);

        expect([response.status, response.headers.get('retry-after'), response.headers.get('content-type')]).toEqual([
            429,
            '60',
            'application/json; charset=utf-8',
        ]);
    });
});

describe('createUpstreamExtension', () => {
    it('happyPath_answersWhatTheFakesKnowAndLeavesTheRestToTheHost', async () => {
        const extension = createUpstreamExtension();
        const request = { method: 'GET', host: 'api.mapbox.com', search: '', headers: {}, body: '', test: 'x' };

        const known = await extension.answer({ ...request, path: '/tokens/v2', search: `?access_token=${MAPBOX_TOKENS.bootstrap}` });
        const unknown = await extension.answer({ ...request, path: '/v4/e2e.json' });
        const control = await extension.control({ method: 'GET', path: '/__calls', query: new URLSearchParams(), body: '' });

        expect(known).toMatchObject({ status: 200, type: 'application/json; charset=utf-8' });
        expect(new TextDecoder().decode(known?.body)).toContain('TokenValid');
        expect(unknown).toBeUndefined();
        expect(control).toBeUndefined();
        expect(extension.partitions.get('x').calls).toHaveLength(1);
    });

    it('happyPath_aMultiValueHeaderIsKept', async () => {
        const extension = createUpstreamExtension();

        const answered = await extension.answer({
            method: 'GET',
            host: 'cloudbilling.googleapis.com',
            path: '/v1/billingAccounts',
            search: '',
            headers: { authorization: 'Bearer e2e', 'x-multi': ['a', 'b'], 'x-empty': undefined },
            body: '',
            test: '',
        });

        expect(answered?.status).toBe(200);
    });
});
