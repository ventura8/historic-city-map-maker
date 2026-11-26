import { describe, expect, it } from 'vitest';

import { GoogleApiError, type GoogleFailure } from '../../src/google/failure.js';
import type { StartStepId } from '../../src/start/deploy.js';
import { CLOUD_CONSOLE, FIREBASE_CONSOLE, QUOTA_REQUEST, startFailureOf } from '../../src/start/failure.js';
import { StartFileError, StartReleaseError } from '../../src/start/files.js';

const COMMAND = 'npx create-historic-city@1 self-host';

function failureOf(failure: GoogleFailure, step: StartStepId, create = true): ReturnType<typeof startFailureOf> {
    return startFailureOf(new GoogleApiError('call', failure), { step, projectId: 'my-project', create, command: COMMAND });
}

describe('what the start page says of a failure', () => {
    it('anExpiredTokenAsksForAnotherConsent', () => {
        expect(failureOf({ kind: 'unauthorized', status: 401 }, 'files')).toEqual({ key: 'start.failure.expired', action: 'consent' });
    });

    it('aTakenIdOrTheQuotaGoesBackToTheForm', () => {
        expect(failureOf({ kind: 'conflict', status: 409 }, 'project')).toMatchObject({
            key: 'start.failure.taken',
            action: 'form',
            params: { projectId: 'my-project' },
        });
        expect(failureOf({ kind: 'rateLimited', status: 429 }, 'project')).toMatchObject({
            key: 'start.failure.quota',
            link: { url: QUOTA_REQUEST },
        });
        expect(failureOf({ kind: 'forbidden', status: 403, reason: 'QUOTA_EXCEEDED' }, 'project')).toMatchObject({
            key: 'start.failure.quota',
        });
    });

    it('aNameOrIdGoogleRefusesGoesBackToTheForm_notToTheTerms', () => {
        expect(failureOf({ kind: 'invalid', status: 400, reason: 'INVALID_ARGUMENT' }, 'project')).toEqual({
            key: 'start.failure.refused',
            action: 'form',
        });
        expect(failureOf({ kind: 'invalid', status: 400, reason: 'FAILED_PRECONDITION' }, 'project')).toMatchObject({
            key: 'start.failure.terms',
            link: { url: CLOUD_CONSOLE },
        });
    });

    it('aConflictOrALimitElsewhereIsNoReasonToLeave', () => {
        expect(failureOf({ kind: 'conflict', status: 409 }, 'firebase')).toMatchObject({
            key: 'start.failure.unknown',
            action: 'again',
            params: { step: 'firebase' },
        });
        expect(failureOf({ kind: 'rateLimited', status: 429 }, 'files')).toMatchObject({
            key: 'start.failure.unavailable',
            action: 'again',
        });
    });

    it('aRefusalBeforeFirebaseExistsIsTheTerms', () => {
        expect(failureOf({ kind: 'forbidden', status: 403 }, 'firebase')).toMatchObject({
            key: 'start.failure.terms',
            link: { url: FIREBASE_CONSOLE },
        });
        expect(failureOf({ kind: 'forbidden', status: 403 }, 'project')).toMatchObject({
            key: 'start.failure.terms',
            link: { url: CLOUD_CONSOLE },
        });
        expect(failureOf({ kind: 'forbidden', status: 403 }, 'files')).toMatchObject({ key: 'start.failure.unknown' });
    });

    it('aProjectThatIsNotTheirsIsNamed', () => {
        expect(failureOf({ kind: 'forbidden', status: 403 }, 'firebase', false)).toMatchObject({
            key: 'start.failure.permission',
            action: 'form',
        });
        expect(failureOf({ kind: 'conflict', status: 409 }, 'project', false)).toMatchObject({ key: 'start.failure.unknown' });
    });

    it('noAnswerAtAllNamesTheHostAndTheTerminal', () => {
        expect(failureOf({ kind: 'unavailable', status: 0, host: 'a.example' }, 'files')).toMatchObject({
            params: { host: 'a.example', command: COMMAND },
        });
        expect(failureOf({ kind: 'unavailable', status: 0 }, 'files')).toMatchObject({ params: { host: '' } });
        expect(failureOf({ kind: 'unavailable', status: 503 }, 'files')).toMatchObject({ key: 'start.failure.unavailable' });
    });

    it('aReleaseThatCannotBeReadSaysSo', () => {
        const context = { step: 'files' as const, projectId: 'p', create: true, command: COMMAND };
        expect(startFailureOf(new StartFileError('a.js'), context)).toMatchObject({ key: 'start.failure.file', params: { path: 'a.js' } });
        expect(startFailureOf(new StartReleaseError('x'), context)).toMatchObject({ key: 'start.failure.release' });
        expect(startFailureOf(new Error('x'), context)).toMatchObject({ key: 'start.failure.unknown' });
    });
});
