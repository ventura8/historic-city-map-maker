import { describe, expect, it, vi } from 'vitest';

import { rememberedSetupReady, SETUP_READY_KEY, SetupReadiness, setupReadyOf } from '../../src/app/setup-readiness.js';
import type { ShellState } from '../../src/state/state.js';
import { FakeDocuments, MemoryStore, shellStateAccess } from './fakes.js';

const OK = { state: 'ok' };
const COMPLETE = { billing: OK, provision: OK, mapbox: OK, usgs: OK };

function readiness(watch = true) {
    const documents = new FakeDocuments();
    const shell = shellStateAccess();
    const local = new MemoryStore();
    const denied = vi.fn();
    const subject = new SetupReadiness({ documents, shell, local, projectId: 'demo-hcm', denied, watch });
    const enter = (patch: Partial<ShellState>): void => {
        shell.update(patch);
        subject.stateChanged(shell.get());
    };
    const status = (data: Record<string, unknown> | null): void => {
        documents.watchers.get('setup/status')?.onNext(data);
    };
    return { documents, shell, local, denied, subject, enter, status };
}

describe('setupReadyOf', () => {
    it('happyPath_billingProvisioningMapboxAndUsgsOkIsComplete', () => {
        expect(setupReadyOf(COMPLETE)).toBe(true);
        expect(setupReadyOf({ ...COMPLETE, analytics: { state: 'missing' } })).toBe(true);
    });

    it('badPath_aMissingDocumentAnAreaNeverCheckedOrNotOkIsNotComplete', () => {
        expect(setupReadyOf(null)).toBe(false);
        expect(setupReadyOf({ billing: OK, provision: OK, mapbox: OK })).toBe(false);
        expect(setupReadyOf({ ...COMPLETE, usgs: { state: 'pending' } })).toBe(false);
        expect(setupReadyOf({ ...COMPLETE, mapbox: 'ok' })).toBe(false);
        expect(setupReadyOf({ ...COMPLETE, provision: { state: 'unknown' } })).toBe(false);
    });

    it('happyPath_usgsPostponedOrWaitingForItsApprovalIsComplete', () => {
        const postponedAt = { seconds: 1, nanoseconds: 0 };
        expect(setupReadyOf({ ...COMPLETE, usgs: { state: 'missing', postponedAt } })).toBe(true);
        expect(setupReadyOf({ ...COMPLETE, usgs: { state: 'pending', detail: 'apiError.usgs.accessPending' } })).toBe(true);
    });

    it('badPath_theInstallerTargetsOnceRecordedMustBeInstalled', () => {
        const installed = { server: { state: 'installed' }, site: { state: 'installed' } };
        expect(setupReadyOf({ ...COMPLETE, install: installed })).toBe(true);
        expect(setupReadyOf({ ...COMPLETE, install: { server: { state: 'installed' } } })).toBe(false);
        expect(setupReadyOf({ ...COMPLETE, install: { ...installed, site: { state: 1 } } })).toBe(false);
    });
});

describe('SetupReadiness', () => {
    it('happyPath_anAdminWithTheServerWatchesSetupStatusAndThisBrowserRemembersIt', () => {
        const r = readiness();

        r.enter({ auth: 'admin', mode: 'normal' });
        r.enter({ busy: true });
        r.status(COMPLETE);
        r.status(COMPLETE);

        expect(r.shell.get().setupReady).toBe(true);
        expect(r.local.get(SETUP_READY_KEY)).toBe('demo-hcm');
        expect(rememberedSetupReady(r.local, 'demo-hcm')).toBe(true);
        expect(r.documents.watchers.size).toBe(1);
    });

    it('badPath_anIncompleteSetupIsForgottenAndAnotherProjectsMemoryCountsForNothing', () => {
        const r = readiness();
        r.local.set(SETUP_READY_KEY, 'demo-hcm');
        r.enter({ auth: 'admin', mode: 'normal' });

        r.status({ billing: OK });

        expect(r.shell.get().setupReady).toBe(false);
        expect(r.local.get(SETUP_READY_KEY)).toBeNull();
        r.local.set(SETUP_READY_KEY, 'other-project');
        expect(rememberedSetupReady(r.local, 'demo-hcm')).toBeNull();
    });

    it('badPath_startUpModeOrSigningOutWatchesNothing', () => {
        const r = readiness();

        r.enter({ auth: 'bootstrap', mode: 'bootstrap' });
        expect(r.documents.watchers.size).toBe(0);
        r.enter({ auth: 'admin', mode: 'normal' });
        r.enter({ auth: 'signedOut' });
        r.subject.stop();

        expect(r.documents.stopped).toBe(1);
    });

    it('badPath_aCityOfTheE2eBuildsOwnNeverReadsTheSingleton', () => {
        const r = readiness(false);

        r.enter({ auth: 'admin', mode: 'normal' });

        expect(r.documents.watchers.size).toBe(0);
        expect(r.shell.get().setupReady).toBeNull();
    });

    it('badPath_aDeniedReadAsksWhoThisIsAndAnotherErrorOnlyEndsTheWatch', () => {
        const r = readiness();
        r.enter({ auth: 'admin', mode: 'normal' });

        r.documents.watchers.get('setup/status')?.onError('unavailable');
        r.enter({ busy: true });
        r.documents.watchers.get('setup/status')?.onError('permission-denied');

        expect(r.denied).toHaveBeenCalledTimes(1);
        // The first answer (no document yet) said not complete; the errors changed nothing after it.
        expect(r.shell.get().setupReady).toBe(false);
    });
});
