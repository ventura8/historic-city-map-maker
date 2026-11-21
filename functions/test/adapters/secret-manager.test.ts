/**
 * The Secret Manager adapter against the fake Secret Manager of `@hcm/test-support/fakes`: values read at runtime with
 * a cache that a new `secretsRev` invalidates, a write that adds a version and destroys the older ones, and failures
 * that never carry a value.
 */
import { createLogger } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { createUpstreamFakes, type UpstreamFakes } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import {
    SECRET_MANAGER_API,
    createSecretManagerStore,
    secretsRevision,
    type SecretManagerOptions,
} from '../../src/adapters/secret-manager.js';
import type { Clock } from '../../src/ports/clock.js';
import { UpstreamError } from '../../src/ports/errors.js';

const TOKEN = 'e2e-service-account-token';
const SECRETS = `${SECRET_MANAGER_API}/projects/demo-hcm/secrets`;

function urlOf(input: Parameters<typeof fetch>[0]): string {
    return input instanceof Request ? input.url : input.toString();
}

class ManualClock implements Clock {
    millis = Date.UTC(2026, 9, 12, 8, 30);

    now(): Date {
        return new Date(this.millis);
    }
}

interface World {
    readonly upstream: UpstreamFakes;
    readonly clock: ManualClock;
    readonly records: ReturnType<typeof createRecordingSink>['records'];
    readonly store: ReturnType<typeof createSecretManagerStore>;
    revision: number | undefined;
}

interface WorldOptions extends Partial<SecretManagerOptions> {
    readonly provisioned?: boolean;
    /** Wraps the fake upstream's fetch (to break one call). */
    readonly wrap?: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch;
}

function world({ provisioned, wrap, ...options }: WorldOptions = {}): World {
    const upstream = createUpstreamFakes();
    if (provisioned !== false) {
        upstream.scenario('secret-manager.provisioned');
    }
    const clock = new ManualClock();
    const recording = createRecordingSink();
    const state: World = {
        upstream,
        clock,
        records: recording.records,
        revision: undefined,
        store: createSecretManagerStore({
            projectId: 'demo-hcm',
            tokens: { accessToken: () => Promise.resolve(TOKEN) },
            fetch: wrap === undefined ? upstream.fetch : wrap(upstream.fetch),
            clock,
            log: createLogger('functions', { sink: recording.sink }),
            ttlMs: 300_000,
            revision: () => Promise.resolve(state.revision),
            ...options,
        }),
    };
    return state;
}

describe('read', () => {
    it('happyPath_readsTheLatestVersionWithTheServiceAccountToken', async () => {
        const { upstream, store } = world();
        await store.write('mapbox-sk-tiles', 'sk.e2e-tiles-value');

        await expect(store.read('mapbox-sk-tiles')).resolves.toBe('sk.e2e-tiles-value');
        expect(upstream.callsTo('secret-manager.versions.access').at(-1)).toMatchObject({
            method: 'GET',
            url: `${SECRETS}/mapbox-sk-tiles/versions/latest:access`,
            headers: { authorization: `Bearer ${TOKEN}` },
        });
    });

    it('happyPath_aSecretWithoutAVersionReadsAsUnset', async () => {
        await expect(world().store.read('usgs-username')).resolves.toBeUndefined();
    });

    it('happyPath_aSecretThatDoesNotExistReadsAsUnset', async () => {
        await expect(world({ provisioned: false }).store.read('usgs-username')).resolves.toBeUndefined();
    });

    it('happyPath_theValueIsCachedUntilTheTtlExpires', async () => {
        const { upstream, store, clock } = world();
        await store.write('usgs-app-token', 'e2e-first');
        await store.read('usgs-app-token');
        // Another instance's write, which this instance does not see until its cache expires.
        upstream.state.secrets.projects.get('demo-hcm')?.get('usgs-app-token')?.push({ number: 9, value: 'e2e-second', state: 'ENABLED' });
        const accesses = upstream.callsTo('secret-manager.versions.access').length;

        clock.millis += 299_999;
        const cached = await store.read('usgs-app-token');
        clock.millis += 1;
        const fresh = await store.read('usgs-app-token');

        expect([cached, fresh]).toEqual(['e2e-first', 'e2e-second']);
        expect(upstream.callsTo('secret-manager.versions.access')).toHaveLength(accesses + 1);
    });

    it('happyPath_aNewSecretsRevisionDropsTheCachedValueAtOnce', async () => {
        const state = world();
        await state.store.write('mapbox-sk-bootstrap', 'sk.e2e-old');
        state.revision = 1;
        await state.store.read('mapbox-sk-bootstrap');
        state.upstream.state.secrets.projects
            .get('demo-hcm')
            ?.get('mapbox-sk-bootstrap')
            ?.push({ number: 9, value: 'sk.e2e-new', state: 'ENABLED' });

        const cached = await state.store.read('mapbox-sk-bootstrap');
        state.revision = 2;
        const fresh = await state.store.read('mapbox-sk-bootstrap');

        expect([cached, fresh]).toEqual(['sk.e2e-old', 'sk.e2e-new']);
    });

    it('happyPath_invalidateForcesAFreshRead', async () => {
        const { upstream, store } = world();
        await store.write('mapbox-sk-tiles', 'sk.e2e-a');
        await store.read('mapbox-sk-tiles');

        store.invalidate();
        await store.read('mapbox-sk-tiles');

        expect(upstream.callsTo('secret-manager.versions.access')).toHaveLength(2);
    });

    it('badPath_aRefusedReadIsForbiddenWithoutAValue', async () => {
        const { upstream, store } = world();
        upstream.fail('secret-manager', 'forbidden');

        await expect(store.read('mapbox-sk-tiles')).rejects.toMatchObject({ service: 'secret-manager', failure: 'forbidden', status: 403 });
    });

    it('badPath_aDisabledApiIsNamed', async () => {
        const { upstream, store } = world();
        upstream.fail('secret-manager', 'apiDisabled');

        await expect(store.read('mapbox-sk-tiles')).rejects.toMatchObject({ failure: 'forbidden', api: 'secretmanager.googleapis.com' });
    });

    it('badPath_anAnswerWithoutAPayloadIsInvalid', async () => {
        const { store } = world({
            fetch: () => Promise.resolve(new Response(JSON.stringify({ name: 'projects/1/secrets/x/versions/1' }))),
        });

        await expect(store.read('mapbox-sk-tiles')).rejects.toEqual(new UpstreamError('secret-manager', 'invalid'));
    });
});

describe('write', () => {
    it('happyPath_addsAVersionAndDestroysTheOlderOnes', async () => {
        const { upstream, store } = world();
        await store.write('mapbox-sk-bootstrap', 'sk.e2e-first');
        await store.write('mapbox-sk-bootstrap', 'sk.e2e-second');

        await expect(store.write('mapbox-sk-bootstrap', 'sk.e2e-third')).resolves.toBe(
            'projects/123456789012/secrets/mapbox-sk-bootstrap/versions/3',
        );

        const versions = upstream.state.secrets.projects.get('demo-hcm')?.get('mapbox-sk-bootstrap');
        expect(versions?.map((version) => version.state)).toEqual(['DESTROYED', 'DESTROYED', 'ENABLED']);
        expect(upstream.secretValue('mapbox-sk-bootstrap')).toBe('sk.e2e-third');
        expect(upstream.callsTo('secret-manager.versions.list').at(-1)?.url).toBe(
            `${SECRETS}/mapbox-sk-bootstrap/versions?filter=state%3AENABLED&pageSize=100`,
        );
    });

    it('happyPath_aWriteDropsTheCachedValue', async () => {
        const { store } = world();
        await store.write('usgs-username', 'e2e-ok');
        await store.read('usgs-username');

        await store.write('usgs-username', 'e2e-m2m-pending');

        await expect(store.read('usgs-username')).resolves.toBe('e2e-m2m-pending');
    });

    it('badPath_aVersionThatCannotBeDestroyedIsLoggedAndTheWriteStillSucceeds', async () => {
        const refuseDestroy =
            (fetch: typeof globalThis.fetch): typeof globalThis.fetch =>
            (input, init) =>
                urlOf(input).endsWith(':destroy')
                    ? Promise.resolve(new Response('{"error":{"code":403}}', { status: 403 }))
                    : fetch(input, init);
        const { store, records, upstream } = world({ wrap: refuseDestroy });
        await store.write('usgs-app-token', 'e2e-first');

        await expect(store.write('usgs-app-token', 'e2e-second')).resolves.toMatch(/versions\/2$/);
        expect(upstream.secretValue('usgs-app-token')).toBe('e2e-second');
        expect(records).toEqual([
            {
                level: 'warn',
                scope: 'functions',
                message: 'older secret versions were not destroyed',
                data: { name: 'usgs-app-token', error: 'GoogleApiError: secret-manager call failed: forbidden (HTTP 403)' },
            },
        ]);
        expect(JSON.stringify(records)).not.toContain('e2e-first');
    });

    it('happyPath_versionNamesThatAreNotSecretManagerVersionsAreLeftAlone', async () => {
        const answers = [
            { name: 'projects/1/secrets/usgs-username/versions/2' },
            {
                versions: [
                    { name: 'projects/1/secrets/usgs-username/versions/1/../../other' },
                    { state: 'ENABLED' },
                    { name: 'projects/1/secrets/usgs-username/versions/2' },
                ],
            },
        ];
        const urls: string[] = [];
        const { store } = world({
            fetch: (input) => {
                urls.push(urlOf(input));
                return Promise.resolve(new Response(JSON.stringify(answers.shift())));
            },
        });

        await store.write('usgs-username', 'e2e-ok');

        expect(urls).toHaveLength(2);
    });

    it('badPath_aMissingSecretCannotBeWritten', async () => {
        await expect(world({ provisioned: false }).store.write('usgs-app-token', 'e2e-x')).rejects.toMatchObject({
            service: 'secret-manager',
            failure: 'notFound',
        });
    });

    it('badPath_anAddVersionAnswerWithoutANameIsInvalid', async () => {
        const { store } = world({ fetch: () => Promise.resolve(new Response('{"state":"ENABLED"}')) });

        await expect(store.write('usgs-app-token', 'e2e-x')).rejects.toEqual(new UpstreamError('secret-manager', 'invalid'));
    });
});

describe('secretsRevision', () => {
    it.each([
        [{ secretsRev: 4 }, 4],
        [{ secretsRev: '4' }, undefined],
        [undefined, undefined],
    ])('happyPath_readsTheRevisionOf_%j', async (record, revision) => {
        await expect(secretsRevision({ readStatus: () => Promise.resolve(record) })()).resolves.toBe(revision);
    });
});
