/**
 * The upstream API fixtures of `@hcm/test-support/api-fixtures` (docs/research/M2-interfaces.md §7): the catalogue lists
 * every JSON file, every fixture loads with its placeholders filled, no file holds a value shaped like a real
 * credential, and `fixtureResponse` builds the `Response` an adapter reads.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FIXTURE_NAMES, FIXTURE_VALUES, fixture, fixtureBody, fixtureResponse } from '@hcm/test-support/api-fixtures';
import { describe, expect, it } from 'vitest';

const FOLDER = fileURLToPath(new URL('../../../packages/test-support/src/api-fixtures/', import.meta.url));

function fixtureFiles(): string[] {
    return readdirSync(FOLDER, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.json') && name !== 'values.json')
        .map((name) => name.slice(0, -'.json'.length))
        .sort((a, b) => a.localeCompare(b));
}

describe('the fixture catalogue', () => {
    it('happyPath_theCatalogueListsEveryFixtureFile', () => {
        expect([...FIXTURE_NAMES]).toEqual(fixtureFiles());
    });

    it('happyPath_everyFixtureLoadsWithItsPlaceholdersFilled', () => {
        const problems = FIXTURE_NAMES.filter((name) => {
            const loaded = fixture(name);
            return !/^(GET|POST|PUT|PATCH|DELETE|any) /.test(loaded.call) || /\{\{\w+\}\}/.test(JSON.stringify(loaded));
        });

        expect(problems).toEqual([]);
    });

    it('badPath_noFixtureFileHoldsACredentialShapedValue', () => {
        const shapes = [/AIza[\w-]{35}/, /ya29\.[\w-]+/, /[ps]k\.eyJ/, /-----BEGIN/];
        const leaking = fixtureFiles().filter((name) => {
            const text = readFileSync(`${FOLDER}${name}.json`, 'utf8');
            return shapes.some((shape) => shape.test(text));
        });

        expect(leaking).toEqual([]);
    });

    it('happyPath_theAssembledApiKeyHasAGoogleKeyShapeOnlyAtRunTime', () => {
        expect(FIXTURE_VALUES['apiKey']).toMatch(/^AIza[\w-]{35}$/);
        expect(fixtureBody('firebase-management/web-app-config.analytics')).toMatchObject({
            apiKey: FIXTURE_VALUES['apiKey'],
            measurementId: 'G-E2E0000000',
        });
    });
});

describe('fixture values', () => {
    it('happyPath_aCallerValueOverridesTheDefault', () => {
        const body = fixtureBody('secret-manager/secret.get', { projectNumber: '999', secretId: 'usgs-username' });

        expect(body).toMatchObject({ name: 'projects/999/secrets/usgs-username' });
    });

    it('happyPath_aJsonFixtureDefaultsItsContentType', () => {
        expect(fixture('mapbox/tokens.retrieve.invalid')).toMatchObject({
            status: 401,
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: { code: 'TokenInvalid' },
        });
    });

    it('badPath_aFixtureWithoutJsonBodyHasNoFixtureBody', () => {
        expect(() => fixtureBody('usgs/maintenance.html-503')).toThrow('has no JSON body');
    });
});

describe('fixtureResponse', () => {
    it('happyPath_aTextFixtureKeepsItsHtmlAndContentType', async () => {
        const response = fixtureResponse('usgs/login-token.html-403');

        expect([response.status, response.headers.get('content-type')]).toEqual([403, 'text/html; charset=iso-8859-1']);
        await expect(response.text()).resolves.toContain('<title>403 Forbidden</title>');
    });

    it('happyPath_mergeStatusAndHeadersPatchTheFixture', async () => {
        const response = fixtureResponse('mapbox/tokens.retrieve.secret', {
            merge: { code: 'TokenExpired' },
            status: 401,
            headers: { 'x-test': 'yes' },
        });

        expect([response.status, response.headers.get('x-test')]).toEqual([401, 'yes']);
        await expect(response.json()).resolves.toEqual({
            code: 'TokenExpired',
            token: { usage: 'sk', user: 'e2e-mapbox', authorization: 'cle2e00token00000000000001' },
        });
    });

    it('happyPath_aReplacedBodyWinsOverTheFixture', async () => {
        await expect(fixtureResponse('usgs/maintenance.html-503', { body: { replaced: true } }).json()).resolves.toEqual({
            replaced: true,
        });
    });

    it('happyPath_a204HasNoBody', async () => {
        const response = fixtureResponse('mapbox/tokens.delete.ok');

        expect(response.status).toBe(204);
        await expect(response.text()).resolves.toBe('');
    });

    it('happyPath_retryAfterTravelsWithARateLimit', () => {
        expect(fixtureResponse('google/error.rate-limited').headers.get('retry-after')).toBe('30');
    });
});
