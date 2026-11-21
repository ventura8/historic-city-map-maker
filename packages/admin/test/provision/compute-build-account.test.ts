import { describe, expect, it } from 'vitest';

import { applyProvision, doctorProvision, planProvision } from '../../src/provision/provisioner.js';
import { provisionWorld, writes, type ProvisionWorld } from './world.js';

/**
 * Finding 33 of `docs/research/manual-test-2026-10-25.md` (live test 2026-10-31, Cloud Build f92cec75) and
 * `DECISIONS-for-review.md` §75g (the user's decision, "Act-as + narrow its role"): Cloud Functions gen 2 builds every
 * function as the Compute Engine default account, and the Cloud Functions API refuses a caller that may not act as it.
 * The `iam` item, in this order: (1) the installer's Service Account User on that account's own policy, (2) the account's
 * `roles/cloudbuild.builds.builder` on the project, (3) only then its `roles/editor` removed (one member, one binding).
 */

const COMPUTE_EMAIL = '123456789012-compute@developer.gserviceaccount.com';
const COMPUTE = `serviceAccount:${COMPUTE_EMAIL}`;
const INSTALLER = 'serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com';
const BUILDER = 'roles/cloudbuild.builds.builder';
const BEFORE_IAM = ['apis', 'service-accounts', 'buckets', 'secrets', 'org-policies', 'iam'] as const;

function projectRolesOf(world: ProvisionWorld, member: string): string[] {
    return (world.fakes.state.resourceManager.policies.get('demo-hcm')?.bindings ?? [])
        .filter((binding) => binding.members.includes(member))
        .map((binding) => binding.role);
}

/** Who holds Service Account User on the Compute Engine default account (its own policy). */
function computeUsers(world: ProvisionWorld): readonly string[] {
    const policy = world.fakes.state.iam.projects.get('demo-hcm')?.accountPolicies.get(COMPUTE_EMAIL) ?? [];
    return policy.find((binding) => binding.role === 'roles/iam.serviceAccountUser')?.members ?? [];
}

/** The project's policy as a project prepared before §75g left it: the account an Editor, without its builder role. */
function beforeTheFix(world: ProvisionWorld): void {
    const policies = world.fakes.state.resourceManager.policies;
    const policy = policies.get('demo-hcm');
    if (policy !== undefined) {
        const bindings = policy.bindings
            .map((binding) => ({ ...binding, members: binding.members.filter((member) => binding.role !== BUILDER || member !== COMPUTE) }))
            .filter((binding) => binding.members.length > 0);
        policies.set('demo-hcm', { ...policy, bindings: [...bindings, { role: 'roles/editor', members: [COMPUTE] }] });
    }
    world.fakes.scenario('iam.computeActAsMissing');
}

describe('the functions build account (the iam item, §75g)', () => {
    it('happyPath_provisionLetsTheInstallerActAsItGrantsTheBuilderRoleThenRemovesEditorAndAReCheckWritesNothing @S-A04-HAPPY-COMPUTE-BUILD-ACCOUNT', async () => {
        const world = provisionWorld();

        const report = await applyProvision(planProvision(null, BEFORE_IAM), world.deps);
        const firstWrites = writes(world.fakes).length;
        const doctor = await doctorProvision(world.deps, ['iam']);
        const again = await applyProvision(planProvision(null, ['iam']), world.deps);

        expect(report.items.find((item) => item.id === 'iam')).toEqual({ id: 'iam', state: 'ok' });
        expect(computeUsers(world)).toEqual([INSTALLER]);
        expect(projectRolesOf(world, COMPUTE)).toContain(BUILDER);
        expect(projectRolesOf(world, COMPUTE)).not.toContain('roles/editor');
        // Never project-wide: the installer may act as the build account on that account's policy only.
        expect(projectRolesOf(world, INSTALLER)).not.toContain('roles/iam.serviceAccountUser');
        // In order: the actAs on the account, the builder role on the project, then the removal.
        const operations = world.fakes.calls.map((call) => `${call.operation} ${call.url} ${call.body}`);
        const actAs = operations.findIndex((call) => call.startsWith('iam.serviceAccounts.setIamPolicy') && call.includes(COMPUTE_EMAIL));
        const builder = operations.findIndex((call) => call.startsWith('resource-manager.setIamPolicy') && call.includes(BUILDER));
        const removal = operations.findLastIndex((call) => call.startsWith('resource-manager.setIamPolicy'));
        expect(actAs).toBeGreaterThan(-1);
        expect(actAs).toBeLessThan(builder);
        expect(builder).toBeLessThan(removal);
        expect(doctor.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(again.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(writes(world.fakes)).toHaveLength(firstWrites);
    });

    it('happyPath_aProjectPreparedBeforeLacksTheBuildAccountWithItsReasonAndRetryWhatFailedFixesIt @S-A04-HAPPY-COMPUTE-BUILD-ACCOUNT', async () => {
        const world = provisionWorld();
        await applyProvision(planProvision(null, BEFORE_IAM), world.deps);
        beforeTheFix(world);

        const doctor = await doctorProvision(world.deps, ['iam']);
        const report = await applyProvision(planProvision(doctor.items, ['iam']), world.deps);

        expect(doctor.items).toEqual([{ id: 'iam', state: 'missing', detail: 'adminSetup.provision.computeBuildAccount' }]);
        expect(report.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(computeUsers(world)).toEqual([INSTALLER]);
        expect(projectRolesOf(world, COMPUTE)).toContain(BUILDER);
        expect(projectRolesOf(world, COMPUTE)).not.toContain('roles/editor');
    });

    it('badPath_aRefusedRemovalFailsTheItemWithTheRoleItNeedsAndKeepsTheBuilderRole @S-A04-BAD-COMPUTE-EDITOR-REFUSED', async () => {
        const world = provisionWorld();
        world.fakes.scenario('resource-manager.computeEditorLocked');

        const report = await applyProvision(planProvision(null, BEFORE_IAM), world.deps);
        const doctor = await doctorProvision(world.deps, ['iam']);

        expect(report.items.find((item) => item.id === 'iam')).toEqual({
            id: 'iam',
            state: 'invalid',
            detail: 'apiError.cloud.permission',
            params: { role: 'roles/resourcemanager.projectIamAdmin' },
        });
        // The grants before it went through: the build works, only the narrowing waits.
        expect(computeUsers(world)).toEqual([INSTALLER]);
        expect(projectRolesOf(world, COMPUTE)).toEqual(expect.arrayContaining([BUILDER, 'roles/editor']));
        expect(projectRolesOf(world, 'serviceAccount:demo-hcm@appspot.gserviceaccount.com')).toEqual([]);
        expect(doctor.items).toEqual([{ id: 'iam', state: 'missing', detail: 'adminSetup.provision.computeBuildAccount' }]);
    });

    it('badPath_withoutTheAccountNothingIsGrantedOrRemoved', async () => {
        const world = provisionWorld();
        world.fakes.scenario('iam.noComputeAccount');

        const report = await applyProvision(planProvision(null, BEFORE_IAM), world.deps);

        expect(report.items.find((item) => item.id === 'iam')).toEqual({ id: 'iam', state: 'ok' });
        expect(projectRolesOf(world, COMPUTE)).toEqual(['roles/editor']);
        expect(world.fakes.calls.filter((call) => call.url.includes(`${COMPUTE_EMAIL}:`))).toEqual([]);
    });
});
