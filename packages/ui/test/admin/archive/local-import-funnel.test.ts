import { describe, expect, it } from 'vitest';

import type { LocalImportPort } from '../../../src/admin/archive/archive-port.js';
import { localImportFunnel } from '../../../src/admin/archive/local-import-funnel.js';

function local(phase: LocalImportPort['phase'], error: string | null = null): LocalImportPort {
    return {
        phase,
        percent: 0,
        done: 0,
        total: 0,
        error,
    };
}

const ORDER = ['choose', 'upload', 'scan'];

describe('localImportFunnel', () => {
    it('happyPath_idleReturnsNull', () => {
        expect(localImportFunnel(local('idle'))).toBeNull();
    });

    it('happyPath_uploadMarksChooseDone', () => {
        expect(localImportFunnel(local('upload'))).toEqual({
            wizard: 'local_import',
            order: ORDER,
            step: 'upload',
            done: ['choose'],
            errors: {},
            complete: false,
        });
    });

    it('happyPath_scanMarksChooseAndUploadDone', () => {
        expect(localImportFunnel(local('scan'))).toEqual({
            wizard: 'local_import',
            order: ORDER,
            step: 'scan',
            done: ['choose', 'upload'],
            errors: {},
            complete: false,
        });
    });

    it('happyPath_doneCompletesAllSteps', () => {
        expect(localImportFunnel(local('done'))).toEqual({
            wizard: 'local_import',
            order: ORDER,
            step: 'scan',
            done: ['choose', 'upload', 'scan'],
            errors: {},
            complete: true,
        });
    });

    it('badPath_failedUsesErrorCode', () => {
        expect(localImportFunnel(local('failed', 'apiError.internal'))).toEqual({
            wizard: 'local_import',
            order: ORDER,
            step: 'upload',
            done: ['choose'],
            errors: { upload: 'apiError.internal' },
            complete: false,
        });
    });

    it('badPath_failedWithoutCodeFallsBackToFailed', () => {
        expect(localImportFunnel(local('failed'))).toEqual({
            wizard: 'local_import',
            order: ORDER,
            step: 'upload',
            done: ['choose'],
            errors: { upload: 'failed' },
            complete: false,
        });
    });

    it('badPath_cancelledReturnsToChooseStep', () => {
        expect(localImportFunnel(local('cancelled'))).toEqual({
            wizard: 'local_import',
            order: ORDER,
            step: 'choose',
            done: [],
            errors: {},
            complete: false,
        });
    });
});
