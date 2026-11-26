import { GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createGoogleClients } from '../../src/google/clients.js';
import { applyProvision, doctorProvision, planProvision, type ProvisionDeps } from '../../src/provision/provisioner.js';
import { OWNER_EMAIL, provisionWorld, type ProvisionWorld } from './world.js';

/**
 * `DECISIONS-for-review.md` §75b (the user's decision, 2026-10-31): the `iam` item takes `roles/editor` away from the App
 * Engine default account on the project's policy, that member of that binding only, and leaves every other member and
 * binding as it found them. The fake project starts as Google makes one: the owner, and Editor for the Compute Engine
 * and App Engine default accounts; since §75g (finding 33) the Compute Engine account loses it too, after its builder role
 * (`compute-build-account.test.ts`), so a fresh run leaves no Editor binding at all.
 */

const APP_ENGINE = 'serviceAccount:demo-hcm@appspot.gserviceaccount.com';
const COMPUTE = 'serviceAccount:123456789012-compute@developer.gserviceaccount.com';
const OWNER = `user:${OWNER_EMAIL}`;
const BEFORE_IAM = ['apis', 'service-accounts', 'buckets', 'artifact-registry', 'secrets', 'org-policies', 'iam'] as const;

function projectBindings(world: ProvisionWorld): readonly { readonly role: string; readonly members: readonly string[] }[] {
    return world.fakes.state.resourceManager.policies.get('demo-hcm')?.bindings ?? [];
}

function membersOf(world: ProvisionWorld, role: string): readonly string[] {
    return projectBindings(world).find((binding) => binding.role === role)?.members ?? [];
}

/** Puts the App Engine account back among the editors, as a project prepared before §75b still has it. */
function editorAgain(world: ProvisionWorld): void {
    const policies = world.fakes.state.resourceManager.policies;
    const policy = policies.get('demo-hcm');
    if (policy !== undefined) {
        const others = policy.bindings.filter((binding) => binding.role !== 'roles/editor');
        policies.set('demo-hcm', {
            ...policy,
            bindings: [...others, { role: 'roles/editor', members: [...membersOf(world, 'roles/editor'), APP_ENGINE] }],
        });
    }
}

/** A fetch input's address. */
function urlOf(input: string | URL | Request): string {
    if (typeof input === 'string') {
        return input;
    }
    return input instanceof URL ? input.href : input.url;
}

/** The world's deps whose transport changes the project's etag once, just before the removal's write (a concurrent change). */
function concurrentRemoval(world: ProvisionWorld): ProvisionDeps {
    let raced = false;
    const fetch: typeof world.fakes.fetch = (input, init) => {
        const body = typeof init?.body === 'string' ? init.body : '';
        const url = urlOf(input);
        const removal = url.includes('cloudresourcemanager') && url.endsWith(':setIamPolicy') && !body.includes('appspot');
        const policy = world.fakes.state.resourceManager.policies.get('demo-hcm');
        if (removal && !raced && policy !== undefined) {
            raced = true;
            world.fakes.state.resourceManager.policies.set('demo-hcm', { ...policy, etag: 'BwXe2eRACE=' });
        }
        return world.fakes.fetch(input, init);
    };
    const clients = createGoogleClients({ fetch, token: () => GOOGLE_TOKENS.owner, sleep: () => Promise.resolve(), log: world.log });
    return { ...world.deps, clients };
}

describe('the App Engine default account loses Editor on the project (the iam item, §75b)', () => {
    it('happyPath_prepareTheProjectRemovesThatMemberOnlyAndKeepsTheOtherEditorsAndBindings @S-A04-HAPPY-APPENGINE-NO-EDITOR', async () => {
        const world = provisionWorld();
        const before = await doctorProvision(world.deps, ['iam']);

        const report = await applyProvision(planProvision(null, BEFORE_IAM), world.deps);
        const after = await doctorProvision(world.deps, ['iam']);

        // A fresh project lacks the whole role table too: no reason of its own then.
        expect(before.items).toEqual([{ id: 'iam', state: 'missing' }]);
        expect(report.items.find((item) => item.id === 'iam')).toEqual({ id: 'iam', state: 'ok' });
        expect(after.items).toEqual([{ id: 'iam', state: 'ok' }]);
        // §75g took the Compute Engine account's Editor role too: the binding left empty is dropped.
        expect(membersOf(world, 'roles/editor')).toEqual([]);
        expect(membersOf(world, 'roles/owner')).toEqual([OWNER]);
        expect(membersOf(world, 'roles/run.invoker')).toEqual(expect.arrayContaining([COMPUTE]));
        expect(membersOf(world, 'roles/run.invoker')).toHaveLength(3);
        expect(JSON.stringify(projectBindings(world))).not.toContain('appspot');
    });

    it('happyPath_aProjectPreparedBeforeHasOnlyThatLeftWithItsReasonAndRetryRemovesItInOneWrite @S-A04-HAPPY-APPENGINE-NO-EDITOR', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, BEFORE_IAM), world.deps);
        editorAgain(world);
        const writesBefore = world.fakes.callsTo('resource-manager.setIamPolicy').length;

        const doctor = await doctorProvision(world.deps, ['iam']);
        const report = await applyProvision(planProvision(doctor.items, ['iam']), world.deps);
        const again = await applyProvision(planProvision(null, ['iam']), world.deps);

        expect(doctor.items).toEqual([{ id: 'iam', state: 'missing', detail: 'adminSetup.provision.appEngineEditor' }]);
        expect(report.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(again.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(world.fakes.callsTo('resource-manager.setIamPolicy')).toHaveLength(writesBefore + 1);
        expect(membersOf(world, 'roles/editor')).toEqual([]);
    });

    it('happyPath_aConcurrentChangeOfThePolicyIsReadAgainAndTheRemovalWritten', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, BEFORE_IAM), world.deps);
        editorAgain(world);
        const writesBefore = world.fakes.callsTo('resource-manager.setIamPolicy').length;

        const report = await applyProvision(planProvision(null, ['iam']), concurrentRemoval(world));

        expect(report.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(membersOf(world, 'roles/editor')).toEqual([]);
        // The first write met the other change (409 ABORTED), the second went through with the new etag.
        expect(world.fakes.callsTo('resource-manager.setIamPolicy')).toHaveLength(writesBefore + 2);
        expect(world.fakes.state.resourceManager.policies.get('demo-hcm')?.etag).not.toBe('BwXe2eRACE=');
    });

    it('badPath_withoutTheAccountNothingIsRemovedAndTheItemIsDone', async () => {
        const world = provisionWorld();
        world.fakes.scenario('iam.noAppEngineAccount');

        const report = await applyProvision(planProvision(null, BEFORE_IAM), world.deps);

        expect(report.items.find((item) => item.id === 'iam')).toEqual({ id: 'iam', state: 'ok' });
        // The Compute Engine account's removal (§75g) is its own write; the App Engine member is left as it is.
        expect(membersOf(world, 'roles/editor')).toEqual([APP_ENGINE]);
    });

    it('badPath_aRefusedRemovalFailsTheItemWithTheRoleItNeedsAndTouchesNothingElse @S-A04-BAD-APPENGINE-EDITOR-REFUSED', async () => {
        const world = provisionWorld();
        world.fakes.scenario('resource-manager.appEngineEditorLocked');

        const report = await applyProvision(planProvision(null, BEFORE_IAM), world.deps);

        expect(report.items.find((item) => item.id === 'iam')).toEqual({
            id: 'iam',
            state: 'invalid',
            detail: 'apiError.cloud.permission',
            params: { role: 'roles/resourcemanager.projectIamAdmin' },
        });
        // The role table was written before the removal; the editors are as Google made them (the App Engine removal comes
        // first and stops the item, so the Compute Engine one is not tried).
        expect(membersOf(world, 'roles/run.invoker')).toHaveLength(3);
        expect(membersOf(world, 'roles/editor')).toEqual([COMPUTE, APP_ENGINE]);
        // Retry what failed runs the item again: the role table is in place, so the removal is all it tries.
        const retried = await applyProvision(planProvision(report.items, ['iam']), world.deps);
        expect(retried.items).toEqual([report.items.find((item) => item.id === 'iam')]);
    });
});
