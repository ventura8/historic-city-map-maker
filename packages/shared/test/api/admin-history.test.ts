import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { claimRequestSchema, inviteIdFor, inviteResponseSchema, normalizeEmail, sessionResponseSchema } from '../../src/api/admin.js';
import { cityAdminsListResponseSchema, cityInviteRequestSchema, cityRevokeRequestSchema } from '../../src/api/cities.js';
import { historyEntryId, historyEntryIdSchema, revertRequestSchema } from '../../src/api/history.js';
import { validate } from '../../src/schemas/validation.js';

/** sha256("owner@example.test"), computed independently (`printf %s owner@example.test | sha256sum`). */
const OWNER_HASH = 'b2096dbc5111b6305225657ffdfab205aaff1dfb30d71805aea56922b2cbb24f';
const ISO = '2026-10-12T08:30:00.000Z';
/** A generated test value shaped like a Google access token (assembled, so no scanner mistakes it for a real one). */
const ACCESS_TOKEN = ['ya29', 'scenario-claim-test-value'].join('.');

describe('invitations', () => {
    it('happyPath_theIdIsTheHashOfTheNormalizedAddress', async () => {
        const id = await inviteIdFor('  Owner@Example.TEST ');

        expect(id).toBe(OWNER_HASH);
        expect(normalizeEmail(' A@B.C ')).toBe('a@b.c');
    });

    it('badPath_anotherAddressHasAnotherId', async () => {
        expect(await inviteIdFor('owner2@example.test')).not.toBe(OWNER_HASH);
    });

    it('happyPath_anInviteRequestAndResponse', () => {
        expect(validate(cityInviteRequestSchema, { cityId: 'bucharest', email: 'ion@example.test', role: 'editor' })).toMatchObject({
            ok: true,
        });
        expect(
            validate(inviteResponseSchema, {
                inviteId: 'a'.repeat(64),
                expiresAt: ISO,
                signInUrl: 'https://bucurestiul-disparut.web.app/',
            }),
        ).toMatchObject({ ok: true });
    });

    it('badPath_anInvalidAddressIsAFieldIssue', () => {
        expect(validate(cityInviteRequestSchema, { cityId: 'bucharest', email: 'not-an-address', role: 'editor' })).toEqual({
            ok: false,
            issues: [{ path: 'email', code: 'validation.format' }],
        });
    });
});

describe('admin callables', () => {
    it('happyPath_sessionClaimRevokeAndList', () => {
        const session = {
            admin: false,
            role: null,
            claim: false,
            refreshToken: false,
            ownerClaimed: false,
            invitePending: true,
            cities: [],
            projectOwner: false,
        };
        const owner = {
            ...session,
            admin: true,
            role: 'owner',
            claim: true,
            ownerClaimed: true,
            invitePending: false,
            cities: [{ id: 'bucharest', role: 'owner', name: { ro: 'București', en: 'Bucharest' } }],
            projectOwner: true,
        };
        const list = {
            admins: [{ uid: 'u1', role: 'owner', projectOwner: true, email: 'o@example.test', createdAt: ISO, self: true }],
            invites: [{ inviteId: 'b'.repeat(64), role: 'editor', invitedBy: 'u1', createdAt: ISO, expiresAt: ISO }],
        };

        expect(validate(sessionResponseSchema, session)).toMatchObject({ ok: true });
        expect(validate(sessionResponseSchema, owner)).toMatchObject({ ok: true });
        expect(validate(claimRequestSchema, { googleAccessToken: ACCESS_TOKEN })).toMatchObject({ ok: true });
        expect(validate(cityRevokeRequestSchema, { kind: 'admin', cityId: 'bucharest', uid: 'u2' })).toMatchObject({ ok: true });
        expect(validate(cityRevokeRequestSchema, { kind: 'invite', cityId: 'bucharest', inviteId: 'c'.repeat(64) })).toMatchObject({
            ok: true,
        });
        expect(validate(cityAdminsListResponseSchema, list)).toMatchObject({ ok: true });
    });

    it.each([
        ['a token with spaces', claimRequestSchema, { googleAccessToken: 'ya29 has spaces in it, oh no' }, 'googleAccessToken'],
        ['a short token', claimRequestSchema, { googleAccessToken: 'ya29.x' }, 'googleAccessToken'],
        [
            'an e-mail address as the invitation id',
            cityRevokeRequestSchema,
            { kind: 'invite', cityId: 'bucharest', inviteId: 'a@example.test' },
            'inviteId',
        ],
        ['an unknown revocation kind', cityRevokeRequestSchema, { kind: 'everyone' }, 'kind'],
        [
            'a session with an unknown role',
            sessionResponseSchema,
            {
                admin: true,
                role: 'root',
                claim: true,
                refreshToken: false,
                ownerClaimed: true,
                invitePending: false,
                cities: [],
                projectOwner: false,
            },
            'role',
        ],
        [
            'a session whose cities are not a list',
            sessionResponseSchema,
            {
                ...{ admin: true, role: 'admin', claim: true, refreshToken: false, ownerClaimed: true, invitePending: false },
                ...{ cities: 'bucharest', projectOwner: false },
            },
            'cities',
        ],
    ])('badPath_%s', (_name, schema: z.ZodType, input, path) => {
        const result = validate(schema, input);

        expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toContain(path);
    });
});

describe('a server from before M5 (finding 27 of 2026-10-31)', () => {
    it('happyPath_aSessionWithoutCitiesAndProjectOwnerReadsAsNoCityAndNotTheOwner', () => {
        const old = { admin: true, role: 'owner', claim: true, refreshToken: false, ownerClaimed: true, invitePending: false };

        expect(sessionResponseSchema.parse(old)).toEqual({ ...old, cities: [], projectOwner: false });
    });
});

describe('history', () => {
    it('happyPath_entryIdsSortByTime', () => {
        const first = historyEntryId(new Date(5), 'projects/p/databases/(default)/documents/x');
        const second = historyEntryId(new Date(1_760_000_000_000), 'evt-2');

        expect(first).toBe('0000000000005-projects_p_databases__default__documents_x');
        expect(second).toBe('1760000000000-evt-2');
        expect([second, first].sort((a, b) => a.localeCompare(b))).toEqual([first, second]);
        expect(historyEntryIdSchema.safeParse(first).success).toBe(true);
    });

    it('badPath_anEmptyEventIdStillMakesAnId', () => {
        expect(historyEntryId(new Date(0), '')).toBe('0000000000000-_');
        expect(historyEntryId(new Date(0), 'x'.repeat(100))).toHaveLength(14 + 64);
    });

    it('happyPath_aRevertRequest', () => {
        expect(
            validate(revertRequestSchema, { cityId: 'bucuresti', entity: 'poi', entityId: 'cvartal', entryId: '1760000000000-evt' }),
        ).toMatchObject({ ok: true });
        expect(
            validate(revertRequestSchema, { cityId: 'bucuresti', entity: 'city', entityId: 'bucuresti', entryId: '1760000000000-evt' }),
        ).toMatchObject({ ok: true });
    });

    it.each([
        [
            'the city entity of another city',
            { cityId: 'bucuresti', entity: 'city', entityId: 'cluj', entryId: '1760000000000-evt' },
            'entityId',
        ],
        ['an entry id without its time', { cityId: 'bucuresti', entity: 'poi', entityId: 'x', entryId: 'evt' }, 'entryId'],
        ['an unaudited entity', { cityId: 'bucuresti', entity: 'job', entityId: 'x', entryId: '1760000000000-evt' }, 'entity'],
    ])('badPath_%s', (_name, input, path) => {
        const result = validate(revertRequestSchema, input);

        expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toContain(path);
    });
});
