import { describe, expect, it } from 'vitest';

import { CallableFailure } from '../../src/firebase/ports.js';
import { callImagery, refusalOf } from '../../src/imagery/api.js';
import { failure, FakeCallables } from '../app/fakes.js';
import { answer } from './world.js';

const SEARCHED = { found: 3, added: 2, updated: 1, failedDatasets: [], searchedAt: '2026-10-20T09:00:00.000Z' };

describe('the imagery callables', () => {
    it('happyPath_anAnswerIsValidatedAndGivenBack', async () => {
        const callables = new FakeCallables();
        answer(callables, 'imagery.search', () => SEARCHED);

        await expect(callImagery(callables, 'imagery.search', { cityId: 'bucharest' })).resolves.toEqual(SEARCHED);
        expect(callables.calls).toEqual([{ name: 'imagery.search', request: { cityId: 'bucharest' } }]);
    });

    it('badPath_anAnswerThatFailsItsSchemaIsInternal', async () => {
        const callables = new FakeCallables();
        answer(callables, 'imagery.search', () => ({ found: -1 }) as never);

        await expect(callImagery(callables, 'imagery.search', { cityId: 'bucharest' })).rejects.toMatchObject({
            details: { code: 'apiError.internal' },
        });
    });

    it('badPath_aRefusalKeepsItsCodeAndAnyOtherErrorIsInternal', async () => {
        const callables = new FakeCallables();
        callables.fail('imagery.import', failure('failed-precondition', 'apiError.imagery.notScanned'));
        const refused = await callImagery(callables, 'imagery.import', { cityId: 'bucharest', entityId: 'DS1' }).catch(
            (error: unknown) => error,
        );
        callables.fail('imagery.import', new TypeError('CALLABLES[name] is undefined'));
        const broken = await callImagery(callables, 'imagery.import', { cityId: 'bucharest', entityId: 'DS1' }).catch(
            (error: unknown) => error,
        );

        expect(refusalOf(refused)).toEqual({ key: 'apiError.imagery.notScanned' });
        expect(broken).toBeInstanceOf(CallableFailure);
        expect(refusalOf(broken)).toEqual({ key: 'apiError.internal' });
    });

    it('happyPath_aRefusalsParametersFillItsMessageAndTheNetworkIsUnavailable', () => {
        expect(refusalOf(failure('resource-exhausted', 'apiError.imagery.dailyLimit', { limit: '10' }))).toEqual({
            key: 'apiError.imagery.dailyLimit',
            params: { limit: '10' },
        });
        expect(refusalOf(new Error('offline'))).toEqual({ key: 'apiError.unavailable' });
    });
});
