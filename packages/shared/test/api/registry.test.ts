import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CALLABLES } from '../../src/api/callables.js';
import {
    ADMIN_CALLABLES,
    BACKGROUND_FUNCTIONS,
    CALLABLE_NAMES,
    CITY_ACCESSES,
    deployedName,
    FUNCTION_OWNERS,
    HTTP_ENDPOINTS,
    WORKER_CALLABLE_NAMES,
    type CallableAccess,
} from '../../src/api/registry.js';

const NAME = /^[a-z]+\.[a-zA-Z]+$/;

describe('the function registry', () => {
    it('happyPath_everyFunctionHasANamespacedNameAndAnOwner', () => {
        const all = { ...CALLABLES, ...HTTP_ENDPOINTS, ...BACKGROUND_FUNCTIONS };

        for (const [name, spec] of Object.entries(all)) {
            expect(name).toMatch(NAME);
            expect(FUNCTION_OWNERS).toContain(spec.owner);
        }
        expect(Object.keys(all)).toHaveLength(
            Object.keys(CALLABLES).length + Object.keys(HTTP_ENDPOINTS).length + Object.keys(BACKGROUND_FUNCTIONS).length,
        );
    });

    it('happyPath_theAdminsTableIsEveryCallableButTheWorkersAndTheNamesListEveryOne', () => {
        // Finding 67: the admin's two pairing callables share the family's prefix; the worker's own six are the rest.
        const workers = Object.keys(CALLABLES).filter((name) => name.startsWith('worker.') && !(name in ADMIN_CALLABLES));

        expect(workers).toEqual([...WORKER_CALLABLE_NAMES]);
        expect(Object.keys(ADMIN_CALLABLES).filter((name) => name.startsWith('worker.'))).toEqual([
            'worker.pairCode',
            'worker.revoke',
            'worker.manage',
        ]);
        expect(Object.keys(ADMIN_CALLABLES)).toEqual(Object.keys(CALLABLES).filter((name) => !workers.includes(name)));
        expect(new Set(CALLABLE_NAMES)).toEqual(new Set(Object.keys(CALLABLES)));
        expect(CALLABLE_NAMES).toHaveLength(Object.keys(CALLABLES).length);
    });

    it('badPath_noAdminCallableRunsWithoutAppCheckAndEveryWorkerCallableDoes', () => {
        expect(Object.values(ADMIN_CALLABLES).filter((spec) => spec.appCheck === 'off')).toEqual([]);
        expect(WORKER_CALLABLE_NAMES.map((name) => [CALLABLES[name].appCheck, CALLABLES[name].owner])).toEqual(
            WORKER_CALLABLE_NAMES.map(() => ['off', 'fn-worker']),
        );
    });

    it('happyPath_deployedNamesUseADash', () => {
        expect(deployedName('admin.claim')).toBe('admin-claim');
        expect(Object.keys(CALLABLES).map(deployedName)).toContain('setup-saveMapbox');
    });

    it('badPath_onlyOwnershipAndJoiningAreOpenToNonAdmins', () => {
        const open = Object.entries(CALLABLES)
            .filter(([, spec]) => spec.access === 'signedIn')
            .map(([name]) => name);

        expect(open).toEqual([
            'admin.session',
            'admin.claim',
            'admin.join',
            'contribute.context',
            'contribute.request',
            'suggestions.submit',
        ]);
    });

    it('badPath_onlyPairingAndTheStartersImageNeedNoSignInAndOnlyTheWorkersOwnCallablesAdmitAPairedToken', () => {
        const none = Object.entries(CALLABLES).filter(([, spec]) => spec.access === 'none');
        const paired = Object.entries(CALLABLES).filter(([, spec]) => 'workerToken' in spec);

        // Finding 72: `worker.image` too, which the starter file's supervisor asks (it reads one record, writes nothing).
        expect(none.map(([name]) => name)).toEqual(['worker.pair', 'worker.image']);
        // M20: the scan's report, which the paired worker sends for its archive.
        expect(paired.map(([name]) => name)).toEqual([
            'worker.hello',
            'worker.claim',
            'worker.step',
            'worker.urls',
            'worker.end',
            'worker.archiveReport',
            'worker.archiveCopy',
        ]);
    });

    it('badPath_everySecretPasteLayerDeletePaidOverageAndGuardResumeConsumesItsAppCheckToken', () => {
        const consuming = Object.entries(CALLABLES)
            .filter(([, spec]) => spec.appCheck === 'consume')
            .map(([name]) => name);

        expect(consuming).toEqual([
            'admin.claim',
            'admin.join',
            'setup.saveMapbox',
            'setup.saveUsgs',
            'setup.rotatePublicToken',
            'layers.delete',
            'imagery.choose',
            'imagery.resumeGuard',
        ]);
    });

    it('badPath_eachCallableValidatesItsRequest', () => {
        expect(CALLABLES['admins.invite'].request.safeParse({ cityId: 'bucharest', email: 'x', role: 'editor' }).success).toBe(false);
        expect(CALLABLES['admin.session'].request.safeParse({ extra: true }).success).toBe(false);
        expect(CALLABLES['setup.status'].request.safeParse({}).success).toBe(true);
    });
});

/** The shapes a request schema may take: an object, or a union of objects (`imagery.join`: frames or archive maps). */
function requestShapes(schema: z.ZodType): readonly z.ZodObject[] {
    if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
        return schema.options as readonly z.ZodObject[];
    }
    return [schema as z.ZodObject];
}

function callablesWith(access: CallableAccess): string[] {
    return Object.entries(CALLABLES)
        .filter(([, spec]) => spec.access === access)
        .map(([name]) => name);
}

describe('the M5 access of each callable (docs/research/M5-interfaces.md §1.3)', () => {
    it('happyPath_everyCityCallableNamesItsCityAtTheTopOfItsRequest', () => {
        const scoped = Object.values(CALLABLES).filter((spec) => CITY_ACCESSES.includes(spec.access));

        expect(scoped.length).toBeGreaterThan(20);
        for (const spec of scoped) {
            for (const shape of requestShapes(spec.request)) {
                expect(Object.keys(shape.shape)).toContain('cityId');
            }
        }
    });

    it('happyPath_theProjectOwnersCallablesAreTheProjectsOwnSettings', () => {
        expect(callablesWith('projectOwner')).toEqual([
            'setup.recordCloud',
            'setup.createCity',
            'setup.saveMapbox',
            'setup.saveUsgs',
            'setup.analyticsConfig',
            'imagery.resumeGuard',
            'cities.create',
            'cities.locate',
            'cities.setLimits',
        ]);
    });

    it('badPath_onlyACitysOwnerInvitesRemovesAndRotatesItsToken', () => {
        expect(callablesWith('cityOwner')).toEqual([
            'admins.invite',
            'admins.revoke',
            'setup.rotatePublicToken',
            'imagery.confirmRights',
            'admins.setRole',
            'export.start',
            'export.download',
            'contribute.decide',
        ]);
    });

    it('badPath_projectWideFactsStayWithStaff', () => {
        expect(callablesWith('admin')).toEqual(['telemetry.listGroups', 'setup.status', 'setup.selfTest']);
        expect(callablesWith('member')).toEqual(['notify.registerDevice', 'notify.unregisterDevice', 'notify.sendTest']);
    });

    it('badPath_onlyTheReviewQueueAndARevertAdmitAModerator', () => {
        expect(callablesWith('cityReviewer')).toEqual(['history.revert', 'review.decide', 'suggestions.decide', 'contributors.setBlocked']);
    });
});

describe('W5: the share of a worker document', () => {
    it('happyPath_itsProfilesAndReasonsAreTheGovernors', async () => {
        const { workerShareSchema } = await import('../../src/schemas/worker.js');
        const { WORKER_PROFILES, WORKER_PROFILE_WHYS } = await import('../../src/api/worker-machine.js');

        expect(workerShareSchema.shape.profile.options).toEqual([...WORKER_PROFILES]);
        expect(workerShareSchema.shape.why.options).toEqual([...WORKER_PROFILE_WHYS]);
    });
});
