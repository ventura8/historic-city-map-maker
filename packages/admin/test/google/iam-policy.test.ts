import { describe, expect, it } from 'vitest';

import { GoogleApiError } from '../../src/google/failure.js';
import {
    ensureBindings,
    heldBindings,
    missingBindings,
    parsePolicy,
    POLICY_WRITE_ATTEMPTS,
    removeBindings,
    withBindings,
    withoutBindings,
    type Policy,
    type PolicyAccess,
} from '../../src/google/iam-policy.js';

/** Read, merge, write with the etag, and merge again after a concurrent change (M2b §3.4: an IAM etag ABORTED, three times). */

const ADMIN = { role: 'roles/datastore.user', member: 'serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com' };
const EVENTS = { role: 'roles/datastore.user', member: 'serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com' };

function memoryPolicy(start: Policy, failures: readonly Error[] = []): PolicyAccess & { written: Policy[] } {
    let current = start;
    const pending = [...failures];
    const written: Policy[] = [];
    return {
        written,
        read: () => Promise.resolve(current),
        write: (policy) => {
            const failure = pending.shift();
            if (failure !== undefined) {
                return Promise.reject(failure);
            }
            written.push(policy);
            current = { ...policy, etag: `etag-${String(written.length)}` };
            return Promise.resolve(current);
        },
    };
}

const conflict = (): GoogleApiError =>
    new GoogleApiError('resource-manager.setIamPolicy', { kind: 'conflict', status: 409, reason: 'ABORTED' });

describe('parsePolicy', () => {
    it('happyPath_bindingsVersionEtagAndConditionsAreKept', () => {
        const policy = parsePolicy({ version: 3, etag: 'e', bindings: [{ role: 'r', members: ['m'], condition: { title: 't' } }] });

        expect(policy).toEqual({ version: 3, etag: 'e', bindings: [{ role: 'r', members: ['m'], condition: { title: 't' } }] });
    });

    it('badPath_anUnreadableAnswerIsAnEmptyPolicy', () => {
        expect(parsePolicy(undefined)).toEqual({ version: 1, bindings: [] });
    });
});

describe('withBindings', () => {
    it('happyPath_aMemberJoinsTheRolesUnconditionalBindingNeverAConditionalOne', () => {
        const policy: Policy = {
            version: 3,
            etag: 'e',
            bindings: [
                { role: ADMIN.role, members: ['user:x@example.test'], condition: { title: 'until' } },
                { role: ADMIN.role, members: ['user:y@example.test'] },
            ],
        };

        const merged = withBindings(policy, [ADMIN, EVENTS]);

        expect(merged.bindings).toEqual([
            { role: ADMIN.role, members: ['user:x@example.test'], condition: { title: 'until' } },
            { role: ADMIN.role, members: ['user:y@example.test', ADMIN.member, EVENTS.member] },
        ]);
        expect(merged.etag).toBe('e');
        expect(missingBindings(merged, [ADMIN, EVENTS])).toEqual([]);
    });
});

describe('ensureBindings', () => {
    it('happyPath_nothingIsWrittenWhenEveryBindingIsThere', async () => {
        const access = memoryPolicy({ version: 1, bindings: [{ role: ADMIN.role, members: [ADMIN.member] }] });

        await expect(ensureBindings(access, [ADMIN])).resolves.toBe(0);
        expect(access.written).toEqual([]);
    });

    it('happyPath_aConcurrentChangeIsMergedAgain', async () => {
        const access = memoryPolicy({ version: 1, etag: 'a', bindings: [] }, [conflict()]);

        await expect(ensureBindings(access, [ADMIN])).resolves.toBe(1);
        expect(access.written).toHaveLength(1);
    });

    it('badPath_threeConflictsInARowOrAnotherFailureAreThrown', async () => {
        const conflicts = Array.from({ length: POLICY_WRITE_ATTEMPTS }, conflict);
        const refused = new GoogleApiError('resource-manager.setIamPolicy', { kind: 'forbidden', status: 403 });

        await expect(ensureBindings(memoryPolicy({ version: 1, bindings: [] }, conflicts), [ADMIN])).rejects.toMatchObject({
            kind: 'conflict',
        });
        await expect(ensureBindings(memoryPolicy({ version: 1, bindings: [] }, [refused]), [ADMIN])).rejects.toBe(refused);
    });
});

/** `DECISIONS-for-review.md` §75b: one member out of one role's unconditional binding, everything else as read. */
const EDITOR = { role: 'roles/editor', member: 'serviceAccount:demo-hcm@appspot.gserviceaccount.com' };
const COMPUTE = 'serviceAccount:123456789012-compute@developer.gserviceaccount.com';

describe('withoutBindings', () => {
    it('happyPath_onlyThatMemberLeavesOnlyThatBindingAndTheConditionalOneAndTheEtagStay', () => {
        const policy: Policy = {
            version: 3,
            etag: 'e',
            bindings: [
                { role: 'roles/owner', members: ['user:owner@example.test'] },
                { role: EDITOR.role, members: [EDITOR.member], condition: { title: 'until' } },
                { role: EDITOR.role, members: [COMPUTE, EDITOR.member, 'user:x@example.test'] },
                { role: 'roles/viewer', members: [EDITOR.member] },
            ],
        };

        const removed = withoutBindings(policy, [EDITOR]);

        expect(removed).toEqual({
            version: 3,
            etag: 'e',
            bindings: [
                { role: 'roles/owner', members: ['user:owner@example.test'] },
                { role: EDITOR.role, members: [EDITOR.member], condition: { title: 'until' } },
                { role: EDITOR.role, members: [COMPUTE, 'user:x@example.test'] },
                { role: 'roles/viewer', members: [EDITOR.member] },
            ],
        });
        expect(heldBindings(removed, [EDITOR])).toEqual([]);
    });

    it('happyPath_aBindingLeftWithNoMemberGoes', () => {
        const policy: Policy = { version: 1, bindings: [{ role: EDITOR.role, members: [EDITOR.member] }] };

        expect(withoutBindings(policy, [EDITOR]).bindings).toEqual([]);
    });
});

describe('removeBindings', () => {
    it('happyPath_aHeldBindingIsRemovedInOneWriteWithTheEtagRead', async () => {
        const access = memoryPolicy({ version: 1, etag: 'a', bindings: [{ role: EDITOR.role, members: [COMPUTE, EDITOR.member] }] });

        await expect(removeBindings(access, [EDITOR])).resolves.toBe(1);
        expect(access.written).toEqual([{ version: 1, etag: 'a', bindings: [{ role: EDITOR.role, members: [COMPUTE] }] }]);
    });

    it('badPath_nothingIsWrittenWhenTheBindingIsAbsentOrOnlyConditional', async () => {
        const access = memoryPolicy({
            version: 3,
            bindings: [
                { role: EDITOR.role, members: [COMPUTE] },
                { role: EDITOR.role, members: [EDITOR.member], condition: { title: 'until' } },
            ],
        });

        await expect(removeBindings(access, [EDITOR])).resolves.toBe(0);
        expect(access.written).toEqual([]);
    });

    it('happyPath_aConcurrentChangeIsReadAndRemovedAgain', async () => {
        const access = memoryPolicy({ version: 1, etag: 'a', bindings: [{ role: EDITOR.role, members: [EDITOR.member] }] }, [conflict()]);

        await expect(removeBindings(access, [EDITOR])).resolves.toBe(1);
        expect(access.written).toEqual([{ version: 1, etag: 'a', bindings: [] }]);
    });

    it('badPath_aRefusalOrThreeConflictsAreThrown', async () => {
        const start: Policy = { version: 1, bindings: [{ role: EDITOR.role, members: [EDITOR.member] }] };
        const refused = new GoogleApiError('resource-manager.setIamPolicy', { kind: 'forbidden', status: 403 });
        const conflicts = Array.from({ length: POLICY_WRITE_ATTEMPTS }, conflict);

        await expect(removeBindings(memoryPolicy(start, [refused]), [EDITOR])).rejects.toBe(refused);
        await expect(removeBindings(memoryPolicy(start, conflicts), [EDITOR])).rejects.toMatchObject({ kind: 'conflict' });
    });
});
