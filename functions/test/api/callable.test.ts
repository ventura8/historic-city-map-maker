/**
 * The callable plumbing every M2 function uses (docs/research/M2-interfaces.md §3.0): access rule, request and
 * response validation against the shared registry, and the error protocol `HttpsError(status, code, details)`.
 */
import { apiErrorDetailsSchema, type SetupStatusView } from '@hcm/shared';
import { HttpsError, type CallableRequest } from 'firebase-functions/https';
import { describe, expect, it } from 'vitest';

import { requireAccess, requireCityRole, type Caller, type CallerToken } from '../../src/api/access.js';
import { ApiError, toHttpsError } from '../../src/api/api-error.js';
import { callableOptions, defineCallable, runCallable, type CallableDeps } from '../../src/api/callable.js';
import { InvalidDocumentError, UpstreamError } from '../../src/ports/errors.js';
import { fakeAdmins, fakeMembership, recordingLogger, type FakeStanding } from '../support/fakes.js';

const ISO = '2026-10-12T08:30:00.000Z';

/** A verified Google admin's token; override one claim to build each bad case. */
function adminToken(overrides: Partial<CallerToken> = {}): CallerToken {
    return { email_verified: true, admin: true, firebase: { sign_in_provider: 'google.com' }, ...overrides };
}

function caller(uid: string, token: CallerToken = adminToken()): Caller {
    return { uid, token };
}
const missing = { state: 'missing', checkedAt: null } as const;

const VIEW: SetupStatusView = {
    billing: missing,
    provision: { ...missing, items: [] },
    mapbox: missing,
    usgs: missing,
    analytics: missing,
    crash: missing,
    secretsRev: 0,
    ready: false,
    generatedAt: ISO,
};

function deps(admins: readonly string[] = ['u-admin'], standing: FakeStanding = {}): CallableDeps & ReturnType<typeof recordingLogger> {
    const logged = recordingLogger();
    return { ...logged, admins: fakeAdmins(admins, standing) };
}

/** What firebase-functions hands a callable (its `.run()` takes the same). */
function request(data: unknown, auth = caller('u-admin')): CallableRequest<unknown> {
    return {
        data,
        auth: { ...auth, rawToken: 'test-id-token' },
        rawRequest: {} as CallableRequest['rawRequest'],
        acceptsStreaming: false,
    } as CallableRequest<unknown>;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected a rejection');
}

describe('runCallable', () => {
    it('happyPath_anAdminGetsTheValidatedResponse', async () => {
        const result = await runCallable('setup.status', () => Promise.resolve(VIEW), deps(), { auth: caller('u-admin'), data: {} });

        expect(result).toEqual(VIEW);
    });

    it('happyPath_aSignedInNonAdminMayAskForItsSession', async () => {
        const session = {
            admin: false,
            role: null,
            claim: false,
            refreshToken: false,
            ownerClaimed: true,
            invitePending: false,
            cities: [],
            projectOwner: false,
        };

        const result = await runCallable(
            'admin.session',
            (_deps, verified) => Promise.resolve({ ...session, claim: verified.claim }),
            deps([]),
            {
                auth: caller('u-stranger', adminToken({ admin: undefined, email: 'stranger@example.test' })),
                data: {},
            },
        );

        expect(result).toEqual(session);
    });

    it('badPath_anInvalidRequestListsItsFieldIssues', async () => {
        const error = await rejection(
            runCallable('admins.invite', () => Promise.reject(new Error('never')), deps(), {
                auth: caller('u-admin'),
                data: { cityId: 'bucharest', email: 'nope', role: 'editor' },
            }),
        );

        expect(error).toMatchObject({ code: 'apiError.invalidRequest', issues: [{ path: 'email', code: 'validation.format' }] });
    });

    it('badPath_aResponseOutsideItsSchemaIsNeverSent', async () => {
        const context = deps();

        const error = await rejection(
            runCallable('setup.status', () => Promise.resolve({ ...VIEW, token: 'sk.never' } as SetupStatusView), context, {
                auth: caller('u-admin'),
                data: {},
            }),
        );

        expect(error).toMatchObject({ code: 'apiError.internal' });
        expect(context.recording.records).toEqual([
            {
                level: 'error',
                scope: 'functions',
                message: 'callable response does not match its schema',
                data: { callable: 'setup.status', issues: 1 },
            },
        ]);
    });
});

describe('requireAccess', () => {
    it.each([
        ['an anonymous call', undefined, 'apiError.unauthenticated'],
        ['an unverified address', caller('u-admin', adminToken({ email_verified: false })), 'apiError.accountNotAllowed'],
        ['a password account', caller('u-admin', adminToken({ firebase: { sign_in_provider: 'password' } })), 'apiError.accountNotAllowed'],
        ['a claim without its document', caller('u-revoked'), 'apiError.notAdmin'],
        ['a document without the claim', caller('u-admin', adminToken({ admin: undefined })), 'apiError.notAdmin'],
    ])('badPath_%s', async (_name, who, code) => {
        await expect(requireAccess('admin', who, fakeAdmins(['u-admin']))).rejects.toMatchObject({ code });
    });

    it('happyPath_theAdminsDocumentIsReadOnlyForAQualifyingToken', async () => {
        const admins = fakeAdmins(['u-admin']);

        await expect(requireAccess('admin', caller('u-admin', adminToken({ admin: undefined })), admins)).rejects.toBeInstanceOf(ApiError);
        await expect(requireAccess('admin', caller('u-admin', adminToken({ email: 'a@example.test' })), admins)).resolves.toEqual({
            uid: 'u-admin',
            email: 'a@example.test',
            claim: true,
        });
        expect(admins.lookups).toEqual(['u-admin']);
    });
});

describe('the M5 accesses (docs/research/M5-interfaces.md §1.3)', () => {
    const EDITOR: FakeStanding = { projectRole: 'admin', cities: { bucharest: 'editor' } };
    const never = () => Promise.reject(new Error('the handler never runs'));
    const list = { cityId: 'cluj' };

    it('happyPath_aCityEditorCallsTheCitysCallables', async () => {
        const answer = { admins: [], invites: [] };

        await expect(
            runCallable('admins.list', () => Promise.resolve(answer), deps(['u-admin'], EDITOR), {
                auth: caller('u-admin'),
                data: { cityId: 'bucharest' },
            }),
        ).resolves.toEqual(answer);
    });

    it.each([
        ['a city the caller does not administer', 'admins.list', list, EDITOR, 'apiError.city.notMember'],
        [
            'an owner callable called by an editor',
            'admins.invite',
            { cityId: 'bucharest', email: 'ion@example.test', role: 'editor' },
            EDITOR,
            'apiError.city.notOwner',
        ],
        [
            'a project callable called by a city owner',
            'cities.setLimits',
            { cityId: 'bucharest', limits: {} },
            { projectRole: 'admin' },
            'apiError.city.notProjectOwner',
        ],
        [
            'an admin document from before M5',
            'admins.list',
            { cityId: 'bucharest' },
            { projectRole: 'admin', cities: {} },
            'apiError.city.notMember',
        ],
    ] as const)('badPath_%s_isRefusedBeforeTheHandler @S-A51-BAD-OTHER-CITY-CALLABLE', async (_name, name, data, standing, code) => {
        const error = await rejection(runCallable(name, never, deps(['u-admin'], standing), { auth: caller('u-admin'), data }));

        expect(error).toMatchObject({ code });
    });

    it('badPath_aNonMembersInvalidRequestIsStillAFieldIssue', async () => {
        const error = await rejection(
            runCallable('admins.list', never, deps(['u-admin'], EDITOR), { auth: caller('u-admin'), data: { cityId: 'Cluj' } }),
        );

        expect(error).toMatchObject({ code: 'apiError.invalidRequest' });
    });

    it.each([
        ['a claim without its document', caller('u-revoked')],
        ['a document without the claim', caller('u-admin', adminToken({ admin: undefined }))],
    ])('badPath_%s_isNoAdminOfAnyCity', async (_name, who) => {
        await expect(requireAccess('cityEditor', who, fakeAdmins(['u-admin']))).rejects.toMatchObject({ code: 'apiError.notAdmin' });
    });

    it('happyPath_theProjectOwnerPassesAndTheMembershipIsKeptForTheCityCheck', async () => {
        const verified = await requireAccess('projectOwner', caller('u-admin'), fakeAdmins(['u-admin']));

        expect([verified.membership?.projectRole, verified.membership?.roleIn('anywhere')]).toEqual(['owner', 'owner']);
    });

    it('badPath_aCityCallableWithoutACityIsAServerBug', () => {
        const verified = { uid: 'u-admin', email: undefined, claim: true, membership: fakeMembership() };

        expect(() => {
            requireCityRole('cityEditor', verified, {});
        }).toThrow(ApiError);
        expect(() => {
            requireCityRole('admin', verified, {});
        }).not.toThrow();
    });
});

describe('toHttpsError', () => {
    it('happyPath_anApiErrorKeepsItsCodeParametersAndStatus', () => {
        const { log, recording } = recordingLogger();

        const error = toHttpsError(new ApiError('apiError.claim.notOwner', { projectId: 'demo-hcm' }), log);

        expect([error.code, error.message, error.details]).toEqual([
            'permission-denied',
            'apiError.claim.notOwner',
            { code: 'apiError.claim.notOwner', params: { projectId: 'demo-hcm' } },
        ]);
        expect(apiErrorDetailsSchema.safeParse(error.details).success).toBe(true);
        expect(recording.records).toEqual([]);
    });

    it.each([
        ['maintenance', 'apiError.unavailable', 'unavailable'],
        ['rateLimited', 'apiError.rateLimited', 'resource-exhausted'],
        ['conflict', 'apiError.conflict', 'aborted'],
        ['notFound', 'apiError.notFound', 'not-found'],
        ['unauthorized', 'apiError.internal', 'internal'],
    ] as const)('badPath_anUnmappedUpstream_%s_becomes_%s', (failure, code, status) => {
        const { log, recording } = recordingLogger();

        const error = toHttpsError(new UpstreamError('mapbox', failure, { status: 500 }), log);

        expect([error.code, error.message]).toEqual([status, code]);
        expect(recording.records[0]?.data).toEqual({ code, error: `UpstreamError: mapbox call failed: ${failure} (HTTP 500)` });
    });

    it('badPath_anInvalidStoredDocumentIsInternalAndLoggedWithoutValues', () => {
        const { log, recording } = recordingLogger();

        const error = toHttpsError(new InvalidDocumentError('setup/status', [{ path: 'mapbox', code: 'validation.type' }]), log);

        expect(error.message).toBe('apiError.internal');
        expect(recording.records[0]?.data).toEqual({
            code: 'apiError.internal',
            error: 'InvalidDocumentError',
            path: 'setup/status',
            issues: 1,
        });
    });

    it('badPath_aThrownValueThatIsNoErrorIsInternal', () => {
        const { log, recording } = recordingLogger();

        expect(toHttpsError('boom', log).message).toBe('apiError.internal');
        expect(recording.records[0]?.data).toEqual({ code: 'apiError.internal', error: 'non-error value thrown' });
    });

    it('happyPath_anHttpsErrorPassesThrough', () => {
        const original = new HttpsError('unauthenticated', 'App Check token missing');

        expect(toHttpsError(original, recordingLogger().log)).toBe(original);
    });
});

describe('defineCallable', () => {
    it('happyPath_runsTheHandlerThroughFirebaseFunctions', async () => {
        const fn = defineCallable('setup.status', () => Promise.resolve(VIEW), deps);

        await expect(fn.run(request({}))).resolves.toEqual(VIEW);
    });

    it('badPath_aFailureLeavesAsAnHttpsErrorWithDetails', async () => {
        const fn = defineCallable('setup.status', () => Promise.reject(new ApiError('apiError.secrets.unavailable')), deps);

        await expect(fn.run(request({}))).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'apiError.secrets.unavailable',
            details: { code: 'apiError.secrets.unavailable' },
        });
    });

    it('badPath_anAnonymousCallIsUnauthenticated', async () => {
        const fn = defineCallable('setup.status', () => Promise.resolve(VIEW), deps);
        const anonymous = {
            data: {},
            rawRequest: {} as CallableRequest['rawRequest'],
            acceptsStreaming: false,
        } as CallableRequest<unknown>;

        await expect(fn.run(anonymous)).rejects.toMatchObject({ code: 'unauthenticated', details: { code: 'apiError.unauthenticated' } });
    });
});

describe('callableOptions', () => {
    it('happyPath_enforcedAppCheckConsumesTokensForSecretPastes', () => {
        expect(callableOptions('setup.saveMapbox', { HCM_APP_CHECK: 'enforce' })).toEqual({
            maxInstances: 3,
            serviceAccount: 'fn-admin@demo-hcm.iam.gserviceaccount.com',
            enforceAppCheck: true,
            consumeAppCheckToken: true,
        });
        expect(callableOptions('setup.status', { HCM_APP_CHECK: 'enforce' })).toEqual({
            maxInstances: 3,
            serviceAccount: 'fn-admin@demo-hcm.iam.gserviceaccount.com',
            enforceAppCheck: true,
            consumeAppCheckToken: false,
        });
    });

    it('happyPath_theImagerySearchMayRunFiveMinutes', () => {
        // Three datasets, up to five pages each, and the browse copies (CR-M3-22); every other callable keeps 60 s.
        expect(callableOptions('imagery.search', {})).toMatchObject({ timeoutSeconds: 540 });
        expect(callableOptions('imagery.import', {})).not.toHaveProperty('timeoutSeconds');
    });

    it('happyPath_theBrowseCopyTakesTwoRequestsAtATimeOthersCloudRunsDefault @S-A11-BAD-BROWSE-MEMORY', () => {
        // Admin sweep 2026-11-14: `imagery.browse` ran out of its 256 MiB 14 times at Cloud Run's 80 requests an instance.
        expect(callableOptions('imagery.browse', {})).toMatchObject({ concurrency: 2 });
        expect(callableOptions('imagery.search', {})).not.toHaveProperty('concurrency');
    });

    it('happyPath_markSceneTakesHalfAGigabyteForTheDatePlanRewrite', () => {
        // Crashes 2026-11-20: `imagery-markscene` used 259 MiB on the default 256 MiB (22 reports).
        expect(callableOptions('imagery.markScene', {})).toMatchObject({ memory: '512MiB' });
        // Error Reporting 2026-11-22: `imagery.browse` still ran out of 256 MiB at two requests an instance (LESSONS 772).
        expect(callableOptions('imagery.browse', {})).toMatchObject({ memory: '512MiB', concurrency: 2 });
        expect(callableOptions('imagery.search', {})).not.toHaveProperty('memory');
    });

    it('badPath_theLocalWorkersCallablesNeverEnforceAppCheck', () => {
        // M7 (docs/research/M7-local-worker.md §2.4): a process on the owner's computer cannot be attested.
        expect(callableOptions('worker.step', { HCM_APP_CHECK: 'enforce' })).toEqual({
            maxInstances: 2,
            serviceAccount: 'fn-admin@demo-hcm.iam.gserviceaccount.com',
            enforceAppCheck: false,
            consumeAppCheckToken: false,
        });
    });

    it('badPath_monitorModeEnforcesNothingYet', () => {
        expect(callableOptions('admin.claim', {})).toEqual({
            maxInstances: 2,
            serviceAccount: 'fn-admin@demo-hcm.iam.gserviceaccount.com',
            enforceAppCheck: false,
            consumeAppCheckToken: false,
        });
    });
});

describe('M13: the roles and the accesses (docs/research/M13-roles.md §1)', () => {
    const verified = (access: 'cityEditor' | 'cityReviewer' | 'cityOwner', role: 'owner' | 'editor' | 'moderator' | 'uploader') => {
        const caller = { uid: 'u-admin', token: { email_verified: true, admin: true, firebase: { sign_in_provider: 'google.com' } } };
        return requireAccess(access, caller, fakeAdmins(['u-admin'], { projectRole: 'admin', cities: { bucharest: role } }));
    };

    it.each([
        ['cityEditor', 'editor'],
        ['cityReviewer', 'moderator'],
        ['cityReviewer', 'editor'],
    ] as const)('happyPath_%s_admitsA_%s', async (access, role) => {
        const caller = await verified(access, role);
        expect(() => {
            requireCityRole(access, caller, { cityId: 'bucharest' });
        }).not.toThrow();
    });

    it.each([
        ['cityEditor', 'moderator', 'apiError.city.notEditor'],
        ['cityEditor', 'uploader', 'apiError.city.notEditor'],
        ['cityReviewer', 'uploader', 'apiError.city.notReviewer'],
        ['cityOwner', 'moderator', 'apiError.city.notOwner'],
        ['cityOwner', 'editor', 'apiError.city.notOwner'],
    ] as const)('badPath_%s_refusesA_%s', async (access, role, code) => {
        const caller = await verified(access, role);
        expect(() => {
            requireCityRole(access, caller, { cityId: 'bucharest' });
        }).toThrow(expect.objectContaining({ code }));
    });

    it.each(['moderator', 'uploader'] as const)('badPath_a_%s_reachesNoProjectStateButMayRegisterADevice', async (role) => {
        const caller = { uid: 'u-admin', token: { email_verified: true, admin: true, firebase: { sign_in_provider: 'google.com' } } };
        const admins = fakeAdmins(['u-admin'], { projectRole: 'admin', cities: { bucharest: role } });
        await expect(requireAccess('admin', caller, admins)).rejects.toMatchObject({ code: 'apiError.notAdmin' });
        await expect(requireAccess('member', caller, admins)).resolves.toMatchObject({ uid: 'u-admin' });
    });

    it('happyPath_anAccountWithNoCityKeepsWhatItHad', async () => {
        const caller = { uid: 'u-admin', token: { email_verified: true, admin: true, firebase: { sign_in_provider: 'google.com' } } };
        await expect(requireAccess('admin', caller, fakeAdmins(['u-admin'], { projectRole: 'admin', cities: {} }))).resolves.toMatchObject({
            uid: 'u-admin',
        });
    });
});
