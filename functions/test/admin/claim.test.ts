/**
 * `admin.claim` (`functions/src/admin/claim.ts`, M2-interfaces §3.1) through its callable's `.run()`: the real
 * Firestore and Auth adapters on the emulators, Google's tokeninfo and Resource Manager scripted (`fakeIam`). The
 * access token is a generated value and must never reach a log line or a document.
 */
import { CLAIM_OAUTH_SCOPE, FIRESTORE_PATHS, OWNER_PERMISSION, adminDocSchema, cityDocSchema, ownerDocSchema } from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { claimFunction } from '../../src/admin/claim.js';
import { sessionFunction } from '../../src/admin/session.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { createFakeFirebaseManagement } from '../support/services.js';
import type { GoogleIam } from '../../src/ports/google-iam.js';
import { CONFIG, callableRequest, failureOf, fakeIam, googleToken, loggedText, openEmulators, type FakeIam, type World } from './world.js';

const emulators = openEmulators('fn-admin-claim');

afterAll(async () => {
    await emulators.close();
});

const ACCESS_TOKEN = 'e2e-claim-access-token-0123456789';
const CLIENT = CONFIG.oauthClientIds[0] ?? '';
/** The Google sign-in client of the fake Firebase Management (`createFakeFirebaseManagement`). */
const SIGN_IN_CLIENT = '123456789012-e2eclient.apps.googleusercontent.com';

type TokenInfo = Awaited<ReturnType<GoogleIam['tokenInfo']>>;

let accounts = 0;

/** A fresh Google account of this file in the Auth emulator. */
async function newAccount(world: World): Promise<{ readonly uid: string; readonly email: string }> {
    accounts += 1;
    const uid = `fn-admin-claim-${String(accounts)}`;
    const email = `${uid}@example.test`;
    await world.sdkAuth.createUser({ uid, email, emailVerified: true, displayName: `  Owner ${String(accounts)}  ` });
    return { uid, email };
}

function tokenInfo(email: string, overrides: Partial<TokenInfo> = {}): TokenInfo {
    return { email, emailVerified: true, audience: CLIENT, scopes: [CLAIM_OAUTH_SCOPE], expiresInSeconds: 3000, ...overrides };
}

function claim(world: World, iam: FakeIam, uid: string, email: string) {
    const fn = claimFunction(() => ({ ...world, iam }));
    return fn.run(callableRequest({ googleAccessToken: ACCESS_TOKEN }, { uid, token: googleToken(email.toUpperCase()) }));
}

describe('admin.claim', () => {
    it('happyPath_theProjectOwnerBecomesTheMapOwner', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const iam = fakeIam(tokenInfo(email), [OWNER_PERMISSION]);

        await expect(claim(world, iam, uid, email)).resolves.toEqual({ role: 'owner', refreshToken: true });

        expect(iam.calls).toEqual(['tokenInfo', `testProjectPermissions demo-hcm ${OWNER_PERMISSION}`]);
        await expect(world.documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema)).resolves.toMatchObject({ uid, updatedBy: uid });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toMatchObject({
            role: 'owner',
            email,
            displayName: `Owner ${String(accounts)}`,
            cities: {},
            updatedBy: uid,
        });
        expect((await world.sdkAuth.getUser(uid)).customClaims).toEqual({ admin: true });
        expect(loggedText(world.recording)).not.toContain(ACCESS_TOKEN);
        expect(loggedText(world.recording)).not.toContain(email);
    });

    it('happyPath_withoutConfiguredClientsTheGoogleSignInClientIsAsked', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const signIn = createFakeFirebaseManagement();
        const iam = fakeIam(tokenInfo(email, { audience: SIGN_IN_CLIENT }), [OWNER_PERMISSION]);
        const fn = claimFunction(() => ({ ...world, config: { ...CONFIG, oauthClientIds: [] }, firebase: signIn.firebase, iam }));

        await expect(fn.run(callableRequest({ googleAccessToken: ACCESS_TOKEN }, { uid, token: googleToken(email) }))).resolves.toEqual({
            role: 'owner',
            refreshToken: true,
        });

        expect(signIn.recorder.calls).toEqual([{ method: 'googleSignInClientId', args: ['demo-hcm'] }]);
    });

    it('badPath_withoutConfiguredClientsOrGoogleSignInNoTokenMatches', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const signIn = createFakeFirebaseManagement();
        signIn.analytics.signInClient = null;
        const iam = fakeIam(tokenInfo(email, { audience: SIGN_IN_CLIENT }), [OWNER_PERMISSION]);
        const fn = claimFunction(() => ({ ...world, config: { ...CONFIG, oauthClientIds: [] }, firebase: signIn.firebase, iam }));

        const failure = await failureOf(fn.run(callableRequest({ googleAccessToken: ACCESS_TOKEN }, { uid, token: googleToken(email) })));

        expect(failure).toMatchObject({ code: 'permission-denied', details: { code: 'apiError.claim.tokenMismatch' } });
        expect(iam.calls).toEqual(['tokenInfo']);
    });

    it('happyPath_theFullCloudPlatformScopeAlsoProvesOwnership', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const iam = fakeIam(tokenInfo(email, { scopes: ['openid', 'https://www.googleapis.com/auth/cloud-platform'] }), [OWNER_PERMISSION]);

        await expect(claim(world, iam, uid, email)).resolves.toEqual({ role: 'owner', refreshToken: true });
    });

    it('happyPath_anInvitedAdminWhoOwnsTheProjectBecomesTheOwnerKeepingTheirRecord', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const joined = { seconds: 1_760_000_000, nanoseconds: 0 };
        await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, {
            role: 'admin',
            invitedBy: 'u-inviter',
            createdAt: joined,
            updatedBy: uid,
            updatedAt: joined,
        });

        await claim(world, fakeIam(tokenInfo(email), [OWNER_PERMISSION]), uid, email);

        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toMatchObject({
            role: 'owner',
            createdAt: joined,
        });
    });

    it('badPath_aSecondOwnerIsRefusedAndTheOwnersRepeatChangesNothing @S-A01-BAD-ALREADY-CLAIMED', async () => {
        const world = emulators.newWorld();
        const first = await newAccount(world);
        const second = await newAccount(world);
        await claim(world, fakeIam(tokenInfo(first.email), [OWNER_PERMISSION]), first.uid, first.email);
        const before = await world.documents.get(FIRESTORE_PATHS.admin(first.uid), adminDocSchema);

        const refused = await failureOf(claim(world, fakeIam(tokenInfo(second.email), [OWNER_PERMISSION]), second.uid, second.email));
        world.clock.set('2026-10-12T09:00:00.000Z');
        await claim(world, fakeIam(tokenInfo(first.email), [OWNER_PERMISSION]), first.uid, first.email);

        expect(refused).toMatchObject({ code: 'already-exists', details: { code: 'apiError.claim.alreadyClaimed' } });
        await expect(world.documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema)).resolves.toMatchObject({ uid: first.uid });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(first.uid), adminDocSchema)).resolves.toEqual(before);
        await expect(world.documents.get(FIRESTORE_PATHS.admin(second.uid), adminDocSchema)).resolves.toBeUndefined();
        expect((await world.sdkAuth.getUser(second.uid)).customClaims ?? {}).toEqual({});
    });
});

describe('admin.claim refusals', () => {
    it.each([
        ['another account', { email: 'someone-else@example.test' }],
        ['another OAuth client', { audience: 'e2e-other-client.apps.googleusercontent.com' }],
        ['an unverified address', { emailVerified: false }],
    ])('badPath_aTokenOf_%s_isRefusedBeforeResourceManager @S-A01-BAD-FOREIGN-TOKEN', async (_case, overrides) => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const iam = fakeIam(tokenInfo(email, overrides), [OWNER_PERMISSION]);

        const failure = await failureOf(claim(world, iam, uid, email));

        expect(failure).toMatchObject({ code: 'permission-denied', details: { code: 'apiError.claim.tokenMismatch' } });
        expect(iam.calls).toEqual(['tokenInfo']);
        await expect(world.documents.get(FIRESTORE_PATHS.setupOwner, ownerDocSchema)).resolves.toBeUndefined();
        expect(loggedText(world.recording)).not.toContain(ACCESS_TOKEN);
    });

    it('badPath_anIdTokenWithoutAnAddressCannotBeMatched', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const fn = claimFunction(() => ({ ...world, iam: fakeIam(tokenInfo(email), [OWNER_PERMISSION]) }));
        const token = googleToken(email);
        const withoutAddress = { email_verified: true, firebase: token.firebase };

        const failure = await failureOf(fn.run(callableRequest({ googleAccessToken: ACCESS_TOKEN }, { uid, token: withoutAddress })));

        expect(failure).toMatchObject({ details: { code: 'apiError.claim.tokenMismatch' } });
    });

    it('badPath_aTokenWithoutTheCloudScopeAsksForIt', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const iam = fakeIam(tokenInfo(email, { scopes: ['openid', 'email'] }), [OWNER_PERMISSION]);

        await expect(failureOf(claim(world, iam, uid, email))).resolves.toMatchObject({ details: { code: 'apiError.claim.scopeMissing' } });
        expect(iam.calls).toEqual(['tokenInfo']);
    });

    it('badPath_anAccountThatDoesNotOwnTheProjectGetsNothing', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);

        const failure = await failureOf(claim(world, fakeIam(tokenInfo(email), []), uid, email));

        expect(failure).toMatchObject({
            code: 'permission-denied',
            details: { code: 'apiError.claim.notOwner', params: { projectId: 'demo-hcm' } },
        });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toBeUndefined();
        expect((await world.sdkAuth.getUser(uid)).customClaims ?? {}).toEqual({});
    });

    it.each([
        ['tokeninfo refuses an expired token', fakeIam(new UpstreamError('google-oauth', 'invalid', { status: 400 }))],
        [
            'Resource Manager refuses a revoked token',
            fakeIam(tokenInfo('x'), new UpstreamError('resource-manager', 'unauthorized', { status: 401 })),
        ],
    ])('badPath_%s', async (_case, scripted) => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const iam: FakeIam = { ...scripted, tokenInfo: (token) => scripted.tokenInfo(token).then((info) => ({ ...info, email })) };

        const failure = await failureOf(claim(world, iam, uid, email));

        expect(failure).toMatchObject({ code: 'unauthenticated', details: { code: 'apiError.claim.tokenInvalid' } });
    });

    it('badPath_googleUnavailableIsRetryable', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const iam = fakeIam(new UpstreamError('google-oauth', 'unavailable', { status: 503 }));

        const failure = await failureOf(claim(world, iam, uid, email));

        expect(failure).toMatchObject({ code: 'unavailable', details: { code: 'apiError.unavailable' } });
    });

    it('badPath_anUnverifiedOrNonGoogleAccountIsRefused @S-A20-BAD-UNVERIFIED-ACCOUNT', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const iam = fakeIam(tokenInfo(email), [OWNER_PERMISSION]);
        const fn = claimFunction(() => ({ ...world, iam }));
        const data = { googleAccessToken: ACCESS_TOKEN };

        const unverified = await failureOf(fn.run(callableRequest(data, { uid, token: googleToken(email, { email_verified: false }) })));
        const password = await failureOf(
            fn.run(callableRequest(data, { uid, token: googleToken(email, { firebase: { sign_in_provider: 'password' } }) })),
        );

        expect([unverified, password]).toMatchObject([
            { code: 'permission-denied', details: { code: 'apiError.accountNotAllowed' } },
            { code: 'permission-denied', details: { code: 'apiError.accountNotAllowed' } },
        ]);
        expect(iam.calls).toEqual([]);
    });
});

describe('admin.claim and the cities', () => {
    it('badPath_aClaimInAProjectWithCitiesMakesTheOwnerAMemberOfNone', async () => {
        // docs/LESSONS.md 258: the claim's document had no cities, so the next session gave the owner every city there
        // was (in the e2e, the cities of the content worlds running beside the Setup journey).
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const at = { seconds: 1_760_000_000, nanoseconds: 0 };
        await world.documents.set(FIRESTORE_PATHS.city('w-0123456789'), cityDocSchema, {
            name: { ro: 'Alt oraș' },
            bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
            published: false,
            updatedBy: 'u-other',
            updatedAt: at,
        });

        await claim(world, fakeIam(tokenInfo(email), [OWNER_PERMISSION]), uid, email);
        const session = await sessionFunction(() => world).run(callableRequest({}, { uid, token: googleToken(email, { admin: true }) }));

        expect(session).toMatchObject({ admin: true, projectOwner: true, cities: [] });
        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toMatchObject({ cities: {} });
    });

    it('happyPath_anAdminWhoClaimsKeepsTheirCities', async () => {
        const world = emulators.newWorld();
        const { uid, email } = await newAccount(world);
        const at = { seconds: 1_760_000_000, nanoseconds: 0 };
        const record = { role: 'admin', cities: { cluj: 'editor' }, createdAt: at, updatedBy: uid, updatedAt: at } as const;
        await world.documents.set(FIRESTORE_PATHS.admin(uid), adminDocSchema, record);

        await claim(world, fakeIam(tokenInfo(email), [OWNER_PERMISSION]), uid, email);

        await expect(world.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema)).resolves.toMatchObject({
            role: 'owner',
            cities: { cluj: 'editor' },
        });
    });
});
