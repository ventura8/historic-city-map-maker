import { describe, expect, it, vi } from 'vitest';

import { guardCallables, outcomeOf } from '../../src/app/services.js';
import { failure, FakeCallables, SESSION } from './fakes.js';

describe('guardCallables', () => {
    it('happyPath_answersPassThrough', async () => {
        const callables = new FakeCallables();
        callables.answer('admin.session', () => SESSION.owner);
        const denied = vi.fn();

        await expect(guardCallables(callables, denied).call('admin.session', {}, { timeoutMs: 5 })).resolves.toEqual(SESSION.owner);
        expect(callables.calls[0]).toEqual({ name: 'admin.session', request: {}, timeoutMs: 5 });
        expect(denied).not.toHaveBeenCalled();
    });

    it('badPath_notAdminIsReportedThenRethrownOtherFailuresOnlyRethrown', async () => {
        const callables = new FakeCallables();
        callables.fail('admins.list', failure('permission-denied', 'apiError.notAdmin'));
        callables.fail('admins.invite', new Error('network'));
        const denied = vi.fn();
        const guarded = guardCallables(callables, denied);

        await expect(guarded.call('admins.list', { cityId: 'bucharest' })).rejects.toMatchObject({
            details: { code: 'apiError.notAdmin' },
        });
        await expect(guarded.call('admins.invite', { cityId: 'bucharest', email: 'a@e2e.test', role: 'editor' })).rejects.toThrow(
            'network',
        );
        expect(denied).toHaveBeenCalledTimes(1);
    });
});

describe('outcomeOf', () => {
    it('happyPath_aValueIsOk', async () => {
        await expect(outcomeOf(() => Promise.resolve(3))).resolves.toEqual({ ok: true, value: 3 });
    });

    it('badPath_aFailureIsItsMessageAndAnUnknownErrorIsInternal', async () => {
        await expect(outcomeOf(() => Promise.reject(failure('not-found', 'apiError.notFound')))).resolves.toEqual({
            ok: false,
            error: { key: 'apiError.notFound' },
        });
        await expect(outcomeOf(() => Promise.reject(new Error('x')))).resolves.toEqual({ ok: false, error: { key: 'apiError.internal' } });
    });
});
