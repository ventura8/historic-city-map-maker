/** The M5 callables' requests and answers (docs/research/M5-interfaces.md §1.6 to §1.8, §5.3). */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
    cityAdminsListRequestSchema,
    cityAdminsListResponseSchema,
    cityInviteRequestSchema,
    cityRevokeRequestSchema,
    citySetRoleRequestSchema,
    citySetRoleResponseSchema,
    citiesCreateRequestSchema,
    citiesCreateResponseSchema,
    citiesSetLimitsRequestSchema,
    citiesSetLimitsResponseSchema,
    sessionCitiesSchema,
} from '../../src/api/cities.js';
import {
    EXPORT_QUEUE,
    exportDownloadRequestSchema,
    exportDownloadResponseSchema,
    exportStartRequestSchema,
    exportStartResponseSchema,
    exportTaskSchema,
} from '../../src/api/city-export.js';
import { DEFAULT_NEW_CITY_LIMITS, MAX_CITIES } from '../../src/schemas/cities.js';
import { validate } from '../../src/schemas/validation.js';
import { tokens } from '../fixtures/manifest.js';

const ISO = '2026-11-02T10:00:00.000Z';
const SHA = 'ab12cd34'.repeat(8);
const theme = {
    seedColor: '#3D6B8C',
    tokens: { light: tokens(), dark: tokens(), highContrastLight: tokens(), highContrastDark: tokens() },
};
const create = {
    cityId: 'cluj',
    name: { ro: 'Cluj-Napoca', en: 'Cluj-Napoca' },
    bounds: { west: 23.5, south: 46.72, east: 23.7, north: 46.82 },
    theme,
};

describe('cities.create', () => {
    it('happyPath_aNameARectangleAndASeed', () => {
        expect(validate(citiesCreateRequestSchema, create).ok).toBe(true);
        expect(validate(citiesCreateRequestSchema, { ...create, name: { ro: 'Bacău' } }).ok).toBe(true);
        expect(validate(citiesCreateResponseSchema, { created: true, cityId: 'cluj' }).ok).toBe(true);
    });

    it.each([
        ['a reserved id', { cityId: 'engine' }, 'validation.value'],
        ['an id with capitals', { cityId: 'Cluj' }, 'validation.format'],
        ['a rectangle wider than two degrees', { bounds: { west: 21, south: 46, east: 23.5, north: 47 } }, 'validation.tooBig'],
        ['a rectangle smaller than a street', { bounds: { west: 23.6, south: 46.77, east: 23.605, north: 46.78 } }, 'validation.tooSmall'],
        ['an inverted rectangle', { bounds: { west: 23.7, south: 46.72, east: 23.5, north: 46.82 } }, 'validation.bounds'],
        ['no Romanian name', { name: { en: 'Cluj' } }, 'validation.required'],
        ['a start view sent by the browser', { zoom: 12 }, 'validation.unknownKey'],
    ])('badPath_%s_isRefusedWith_%s', (_name, change, code) => {
        const result = validate(citiesCreateRequestSchema, { ...create, ...change });

        expect(result.ok).toBe(false);
        expect(result.ok ? [] : result.issues.map((issue) => issue.code)).toContain(code);
    });
});

describe('cities.setLimits and the session cities', () => {
    it('happyPath_aCitysShare', () => {
        const request = { cityId: 'cluj', limits: DEFAULT_NEW_CITY_LIMITS };

        expect(validate(citiesSetLimitsRequestSchema, request).ok).toBe(true);
        expect(validate(citiesSetLimitsResponseSchema, { limits: DEFAULT_NEW_CITY_LIMITS }).ok).toBe(true);
    });

    it('badPath_aShareOverTheProjectsCapIsRefused', () => {
        expect(
            validate(citiesSetLimitsRequestSchema, { cityId: 'cluj', limits: { ...DEFAULT_NEW_CITY_LIMITS, rasterJobsPerDay: 50 } }).ok,
        ).toBe(false);
    });

    it('happyPath_theSwitcherGetsEachCityWithItsRoleAndName', () => {
        const cities = [
            { id: 'bucharest', role: 'owner', name: { ro: 'București dispărut', en: 'Lost Bucharest' } },
            { id: 'cluj', role: 'editor', name: { ro: 'Cluj' } },
        ];

        expect(validate(sessionCitiesSchema, cities).ok).toBe(true);
    });

    it('badPath_moreCitiesThanAProjectHasAreRefused', () => {
        const city = { id: 'cluj', role: 'editor', name: { ro: 'Cluj' } };

        expect(
            validate(
                sessionCitiesSchema,
                Array.from({ length: MAX_CITIES + 1 }, () => city),
            ).ok,
        ).toBe(false);
    });
});

describe('the per-city admin callables', () => {
    it('happyPath_inviteRevokeSetRoleAndListInOneCity', () => {
        expect(validate(cityInviteRequestSchema, { cityId: 'cluj', email: 'editor@example.org', role: 'editor' }).ok).toBe(true);
        expect(validate(cityRevokeRequestSchema, { kind: 'admin', cityId: 'cluj', uid: 'uid-2' }).ok).toBe(true);
        expect(validate(cityRevokeRequestSchema, { kind: 'invite', cityId: 'cluj', inviteId: SHA }).ok).toBe(true);
        expect(validate(citySetRoleRequestSchema, { cityId: 'cluj', uid: 'uid-2', role: 'owner' }).ok).toBe(true);
        expect(validate(citySetRoleResponseSchema, { role: 'owner' }).ok).toBe(true);
        expect(validate(cityAdminsListRequestSchema, { cityId: 'cluj' }).ok).toBe(true);
        expect(
            validate(cityAdminsListResponseSchema, {
                admins: [{ uid: 'uid-1', role: 'owner', projectOwner: true, displayName: 'Ana', createdAt: ISO, self: true }],
                invites: [{ inviteId: SHA, role: 'editor', invitedBy: 'uid-1', createdAt: ISO, expiresAt: ISO }],
            }).ok,
        ).toBe(true);
    });

    it.each<readonly [string, z.ZodType, unknown]>([
        ['an invitation without a city', cityInviteRequestSchema, { email: 'a@example.org', role: 'editor' }],
        ['an invitation to a project role', cityInviteRequestSchema, { cityId: 'cluj', email: 'a@example.org', role: 'admin' }],
        ['a revoke without a city', cityRevokeRequestSchema, { kind: 'admin', uid: 'uid-2' }],
        ['an unknown role', citySetRoleRequestSchema, { cityId: 'cluj', uid: 'uid-2', role: 'viewer' }],
    ])('badPath_%s_isRefused', (_name, schema, request) => {
        expect(validate(schema, request).ok).toBe(false);
    });
});

describe('the export callables', () => {
    it('happyPath_startDownloadAndTheTask', () => {
        expect(EXPORT_QUEUE).toBe('export-build');
        expect(validate(exportStartRequestSchema, { cityId: 'bucharest', rasters: true }).ok).toBe(true);
        expect(validate(exportStartResponseSchema, { exportId: 'e1761400000000-ab12cd' }).ok).toBe(true);
        expect(validate(exportDownloadRequestSchema, { cityId: 'bucharest', exportId: 'e1761400000000-ab12cd' }).ok).toBe(true);
        expect(
            validate(exportDownloadResponseSchema, {
                url: 'https://storage.googleapis.com/demo-hcm.firebasestorage.app/exports/bucharest/e1.zip?X-Goog-Signature=00',
                expiresAt: ISO,
                fileName: 'bucharest-2026-11-02.zip',
            }).ok,
        ).toBe(true);
        expect(validate(exportTaskSchema, { cityId: 'bucharest', exportId: 'e1761400000000-ab12cd' }).ok).toBe(true);
    });

    it.each<readonly [string, z.ZodType, unknown]>([
        ['a start without the scans choice', exportStartRequestSchema, { cityId: 'bucharest' }],
        ['a download of an id with a slash', exportDownloadRequestSchema, { cityId: 'bucharest', exportId: 'a/b' }],
        [
            'an address that is not https',
            exportDownloadResponseSchema,
            { url: 'http://x.example/e.zip', expiresAt: ISO, fileName: 'a-2026-11-02.zip' },
        ],
        [
            'a file name that climbs up',
            exportDownloadResponseSchema,
            { url: 'https://x.example/e.zip', expiresAt: ISO, fileName: '../a.zip' },
        ],
    ])('badPath_%s_isRefused', (_name, schema, value) => {
        expect(validate(schema, value).ok).toBe(false);
    });
});
