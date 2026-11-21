import { createFakeFetch, E2E_PROJECT_CONFIG, jsonResponse } from '@hcm/test-support/fakes';
import { describe, expect, it, vi } from 'vitest';

import { bootAdmin, configMissingApp } from '../../src/app/boot.js';
import type { BootEnvironment } from '../../src/app/boot.js';
import { PROJECT_URL, RUNTIME_URL, WEB_CONFIG_URL } from '../../src/app/config.js';
import { ACCENT_KEY, THEME_KEY } from '../../src/app/mount.js';
import { NO_SETUP } from '../../src/app/services.js';
import { AdminTelemetry } from '../../src/app/telemetry.js';
import { PageRegistry } from '../../src/routing/pages.js';
import { LANGUAGE_KEY } from '../../src/state/locale.js';
import {
    E2E_WEB_CONFIG,
    FakeAuth,
    FakeCallables,
    FakeClock,
    FakeDocuments,
    FakeGoogle,
    FakeLocation,
    FakeVisibility,
    MemoryStore,
    NO_STORAGE,
    settle,
    testLog,
    undeployed,
} from './fakes.js';

function environment(files: Readonly<Record<string, Response>>) {
    const location = new FakeLocation('', '?lang=en');
    const local = new MemoryStore();
    const { log, recording } = testLog();
    const fetcher = createFakeFetch((request) => {
        const response = files[request.url.pathname];
        return response === undefined ? undefined : { operation: request.url.pathname, response };
    });
    const build = vi.fn((): ReturnType<BootEnvironment<null, null>['build']> => {
        const auth = new FakeAuth();
        const callables = new FakeCallables();
        undeployed(callables);
        return {
            project: { projectId: 'demo-hcm', cities: ['bucharest'] },
            firebase: { auth, callables, documents: new FakeDocuments(), storage: NO_STORAGE },
            google: new FakeGoogle(auth),
            fetch: fetcher.fetch,
            clock: new FakeClock(),
            session: new MemoryStore(),
            local,
            location,
            log,
            visibility: new FakeVisibility(),
            languages: [],
            pages: new PageRegistry(),
            telemetry: () => new AdminTelemetry({ local, analytics: null, errors: { report: vi.fn() }, clearCookies: vi.fn(), log }),
            setup: NO_SETUP,
        };
    });
    const env: BootEnvironment<null, null> = {
        fetch: (input, init) => fetcher.fetch(new URL(input instanceof Request ? input.url : input, 'https://demo-hcm.web.app'), init),
        location,
        local,
        languages: [],
        log,
        build,
    };
    return { env, build, location, local, recording };
}

describe('bootAdmin', () => {
    it('happyPath_theConfigurationAndTheRuntimeFileStartTheApp', async () => {
        const e = environment({
            [WEB_CONFIG_URL]: jsonResponse(E2E_WEB_CONFIG),
            [RUNTIME_URL]: jsonResponse({ release: 'r1' }),
            [PROJECT_URL]: jsonResponse(E2E_PROJECT_CONFIG),
        });

        const app = await bootAdmin(e.env);
        await settle();

        expect(e.build).toHaveBeenCalledWith(E2E_WEB_CONFIG, { release: 'r1' }, E2E_PROJECT_CONFIG);
        expect(app.state).toMatchObject({ auth: 'signedOut', mode: 'bootstrap', locale: 'en', projectId: 'demo-hcm' });
        expect(e.recording.records.find((record) => record.message === 'admin booting')?.data).toEqual({
            projectId: 'demo-hcm',
            release: 'r1',
            startUp: false,
            appCheck: false,
            project: true,
        });
    });

    it('badPath_withoutAProjectFileTheAppStillStarts', async () => {
        const e = environment({ [WEB_CONFIG_URL]: jsonResponse(E2E_WEB_CONFIG) });

        await bootAdmin(e.env);

        expect(e.build).toHaveBeenCalledWith(E2E_WEB_CONFIG, { release: 'dev' }, null);
    });

    it('badPath_aMissingConfigurationShowsItsScreenAndBuildsNothing', async () => {
        const e = environment({});

        const app = await bootAdmin(e.env);

        expect(e.build).not.toHaveBeenCalled();
        expect(app.state).toMatchObject({ auth: 'configMissing', locale: 'en' });
    });
});

describe('configMissingApp', () => {
    it('happyPath_reloadLanguageAndThemeStillWork', async () => {
        const e = environment({});
        e.local.set(THEME_KEY, 'dark');
        e.local.set(ACCENT_KEY, 'map');
        const app = configMissingApp(e.env);
        const seen: string[] = [];
        const stop = app.subscribe((state) => {
            seen.push(state.locale);
        });

        app.intents.reload();
        app.intents.setLocale('ro');
        expect(app.state.theme.accent).toBe('map');
        app.intents.setTheme('light');
        app.intents.setAccent('device');
        stop();

        expect(e.location.reloads).toBe(1);
        expect(e.local.get(ACCENT_KEY)).toBe('device');
        expect(e.local.get(LANGUAGE_KEY)).toBe('ro');
        expect(e.local.get(THEME_KEY)).toBe('light');
        expect(app.state.theme.mode).toBe('light');
        expect(seen).toEqual(['ro', 'ro', 'ro']);
        await expect(app.loadPage('setup')).resolves.toBeNull();
    });

    it('happyPath_aLanguageBeyondTheBundledTwoIsFetchedThenShown_andOneThatCannotBeKeepsTheLanguage', async () => {
        const e = environment({ '/i18n/pt.json': jsonResponse({ locale: 'pt', messages: { 'adminShell.notice.close': 'Fechar' } }) });
        const app = configMissingApp(e.env);

        app.intents.setLocale('pt');
        await vi.waitFor(() => {
            expect(app.state.locale).toBe('pt');
        });
        expect(e.local.get(LANGUAGE_KEY)).toBe('pt');
        app.intents.setLocale('bn');
        await vi.waitFor(() => {
            expect(app.state.notice?.key).toBe('adminShell.language.unavailable');
        });
        expect(app.state.locale).toBe('pt');
    });

    it('badPath_everyOtherIntentDoesNothingAndTheServerCallsRefuse', async () => {
        const app = configMissingApp(environment({}).env);

        await app.intents.signIn();
        await app.intents.signOut();
        await app.intents.claim();
        await app.intents.join();
        await app.intents.retry();
        await app.intents.enableApi();
        app.intents.navigate({ id: 'admins', params: [] });
        app.intents.switchCity('cluj');
        await app.intents.refreshCities();
        app.intents.previewTheme(null);
        app.intents.setConsent('granted');
        app.intents.dismissNotice();
        app.intents.setWindowClass('large');
        app.telemetry.reportError(new Error('x'), { fatal: false, source: 'window' });
        app.telemetry.setConsent('granted');
        app.telemetry.setConsent('denied');
        app.destroy();

        expect([app.content.jobs, app.content.admins, app.hasUnsavedChanges()]).toEqual([null, null, false]);
        expect(app.state.auth).toBe('configMissing');
        expect([app.state.cities, app.state.cityId, app.state.projectOwner]).toEqual([[], null, false]);
    });
});
