import { type CityRole, createLogger, type CallableName } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { describe, expect, it, vi } from 'vitest';

import { MIN_TOKEN_LIFE_MS } from '../../src/setup/google-access.js';
import { createSetupModule, setupDepsOf, type SetupModuleOptions, type SetupShell } from '../../src/setup/module.js';
import type { SetupState } from '../../src/setup/state.js';
import { FakeClock, FakeSession, FakeVisibility, access, createHarness, flush, statusView } from './harness.js';

interface View {
    readonly auth: string;
    readonly route: { readonly id: string; readonly params: readonly string[] };
    readonly cities?: readonly { readonly id: string; readonly role: CityRole }[];
}

function fakeShell() {
    const clock = new FakeClock();
    const listeners = new Set<(view: View) => void>();
    let view: View = { auth: 'signedOut', route: { id: 'setup', params: [] } };
    const published: SetupState[] = [];
    const call = vi.fn((name: CallableName) => Promise.resolve(name === 'setup.status' ? statusView() : {}));
    const google = {
        request: vi.fn<SetupShell['google']['request']>().mockResolvedValue({ granted: true, access: access(clock.now(), 'cloudBilling') }),
        live: vi.fn<SetupShell['google']['live']>().mockReturnValue(null),
        drop: vi.fn(),
    };
    const shell = {
        config: { projectId: 'demo-hcm', authDomain: 'demo-hcm.firebaseapp.com', messagingSenderId: '123456789012' },
        firebase: { callables: { call } },
        clock,
        session: new FakeSession(),
        visibility: new FakeVisibility(),
        log: createLogger('admin', { sink: createRecordingSink().sink }),
        google,
        getState: () => view,
        subscribe: (listener: (next: View) => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setSetup: (setup: SetupState) => {
            published.push(setup);
        },
        serverReady: vi.fn(() => Promise.resolve(true)),
    } as unknown as SetupShell;
    const move = (next: Partial<View>): void => {
        view = { ...view, ...next };
        for (const listener of [...listeners]) {
            listener(view);
        }
    };
    return { shell, call, google, move, published, latest: () => published.at(-1) };
}

function options(): SetupModuleOptions {
    const { cloud, importer, installer, sources } = createHarness();
    return {
        ...{
            cloud,
            importer,
            sources,
            createCity: vi.fn(() => Promise.resolve({ created: true })),
            cityId: 'bucharest',
            github: true,
            cityBBox: null,
        },
        ...{ installer, release: '1.0.0+abc1234', releaseTime: 1_761_955_200, siteAddress: 'https://demo-hcm.web.app/' },
    };
}

describe('createSetupModule', () => {
    it('happyPath_theSetupStartsInStartUpModeAndPublishesItsState', async () => {
        const { shell, move, latest } = fakeShell();
        const module = createSetupModule(options());
        expect(module.initial).toBeNull();

        const intents = module.create(shell);
        move({ auth: 'bootstrap' });
        await flush();

        expect(latest()?.mode).toBe('bootstrap');
        expect(latest()?.steps.signIn.state).toBe('ok');
        expect(latest()?.openStep).toBe('billing');
        expect(typeof intents.linkBilling).toBe('function');
    });

    it('happyPath_theAddressOpensItsStepAndTheClaimShowsOnItsCard', async () => {
        const { shell, move, latest } = fakeShell();
        createSetupModule(options()).create(shell);
        move({ auth: 'bootstrap', route: { id: 'setup', params: ['usgs'] } });
        await flush();
        expect(latest()?.openStep).toBe('usgs');

        move({ route: { id: 'setup', params: ['provision'] } });
        expect(latest()?.openStep).toBe('provision');
        move({ route: { id: 'setup', params: ['nonsense'] } });
        move({ route: { id: 'photos', params: [] } });
        expect(latest()?.openStep).toBe('provision');

        move({ auth: 'claiming' });
        move({ auth: 'claiming', route: { id: 'setup', params: [] } });
        expect(latest()?.steps.claim).toMatchObject({ state: 'pending', detail: { key: 'adminShell.auth.claiming' } });
    });

    it('happyPath_theClaimSwitchesToNormalModeAndLoadsTheServersRecord', async () => {
        const { shell, call, move, latest } = fakeShell();
        createSetupModule(options()).create(shell);
        move({ auth: 'bootstrap' });
        await flush();

        move({ auth: 'admin' });
        await flush();

        expect(call).toHaveBeenCalledWith('setup.status', {});
        expect(latest()?.mode).toBe('normal');
    });

    it('badPath_aModeratorsAccountRunsNoSetup @S-A91-BAD-NOT-ALLOWED', async () => {
        const { shell, call, move } = fakeShell();
        createSetupModule(options()).create(shell);
        move({ auth: 'admin', cities: [{ id: 'bucharest', role: 'moderator' }] });
        await flush();

        expect(call).not.toHaveBeenCalledWith('setup.status', {});
    });

    it('happyPath_anAdminSessionStartsInNormalModeAtTheAddressedStep', async () => {
        const { shell, move, latest } = fakeShell();
        createSetupModule(options()).create(shell);

        move({ auth: 'admin', route: { id: 'setup', params: ['analytics'] } });
        await flush();

        expect(latest()).toMatchObject({ mode: 'normal', openStep: 'analytics' });
    });

    it('badPath_aSessionOpenedOnAnotherPageChecksNoSetupCardUntilTheSetupPageShows', async () => {
        const { shell, call, move, latest } = fakeShell();
        createSetupModule(options()).create(shell);

        move({ auth: 'admin', route: { id: 'photos', params: [] } });
        await flush();
        expect(latest()?.openStep).toBe('billing');
        move({ route: { id: 'setup', params: ['analytics'] } });
        await flush();
        expect(call).toHaveBeenCalledWith('setup.analyticsConfig', { cityId: 'bucharest' });
        call.mockClear();
        move({ route: { id: 'photos', params: [] } });
        await flush();

        expect(call).not.toHaveBeenCalledWith('setup.analyticsConfig', expect.anything());
    });

    it('badPath_signedOutStartsNothing', async () => {
        const { shell, call, move } = fakeShell();
        createSetupModule(options()).create(shell);

        move({ auth: 'probing' });
        await flush();

        expect(call).not.toHaveBeenCalled();
    });
});

describe('setupDepsOf', () => {
    it('happyPath_theHostComesFromTheWebConfigurationAndTheOptions', async () => {
        const { shell } = fakeShell();
        const deps = setupDepsOf(shell, options());

        expect(deps.host).toMatchObject({
            projectId: 'demo-hcm',
            projectNumber: '123456789012',
            authDomain: 'demo-hcm.firebaseapp.com',
            cityId: 'bucharest',
        });
        expect(await deps.host.serverDeployed()).toBe(true);
        expect(deps.clock).toBe(shell.clock);
    });

    it('happyPath_theBackendCallsEachCallableByItsName', async () => {
        const { shell, call } = fakeShell();
        const deps = setupDepsOf(shell, options());

        await deps.backend.status();
        await deps.backend.selfTest();
        await deps.backend.recordCloud({ billing: { state: 'ok' } });
        await deps.backend.saveMapbox({ cityId: 'bucharest', secretToken: 'sk.x' });
        await deps.backend.saveUsgs({ username: 'u', applicationToken: 't' });
        await deps.backend.rotatePublicToken({ cityId: 'bucharest', audience: 'viewer' });
        await deps.backend.analyticsConfig({ cityId: 'bucharest' });
        await deps.backend.listGroups({ hours: 168, pageSize: 20 });
        await deps.backend.createCity();

        expect(call.mock.calls.map(([name]) => name)).toEqual([
            'setup.status',
            'setup.selfTest',
            'setup.recordCloud',
            'setup.saveMapbox',
            'setup.saveUsgs',
            'setup.rotatePublicToken',
            'setup.analyticsConfig',
            'telemetry.listGroups',
        ]);
    });

    it('happyPath_googleConsentGoesThroughTheShell', async () => {
        const { shell, google } = fakeShell();
        const deps = setupDepsOf(shell, options());

        expect((await deps.google.request('cloudBilling'))?.token).toBeDefined();
        deps.google.live('cloudPlatform');
        deps.google.drop();

        expect(google.live).toHaveBeenCalledWith('cloudPlatform', MIN_TOKEN_LIFE_MS);
        expect(google.drop).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['popupBlocked', 'auth/popup-blocked'],
        ['scopeDenied', 'hcm/scope-denied'],
        ['wrongAccount', 'hcm/wrong-account'],
        ['network', 'auth/network-request-failed'],
        ['failed', 'failed'],
    ])('badPath_aRefused_%s_consentRejectsWithItsCode', async (failure, code) => {
        const { shell, google } = fakeShell();
        google.request.mockResolvedValue({ granted: false, failure });
        const deps = setupDepsOf(shell, options());

        await expect(deps.google.request('cloudPlatform')).rejects.toMatchObject({ code });
    });

    it('badPath_aClosedPopupIsNoToken', async () => {
        const { shell, google } = fakeShell();
        google.request.mockResolvedValue({ granted: false, failure: 'popupClosed' });

        expect(await setupDepsOf(shell, options()).google.request('cloudPlatform')).toBeNull();
    });
});
