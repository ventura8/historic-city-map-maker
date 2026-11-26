// The mount tests' world (`mount.test.ts`, `mount-busy.test.ts`): every port of `AdminDeps` faked, a counter as the Setup module.
import { vi } from 'vitest';

import type { AdminDeps } from '../../src/app/mount.js';
import type { SetupModuleSpec, ShellServices } from '../../src/app/services.js';
import { AdminTelemetry } from '../../src/app/telemetry.js';
import type { AnalyticsPort } from '../../src/firebase/analytics.js';
import { PageRegistry } from '../../src/routing/pages.js';
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
    testLog,
} from './fakes.js';

export interface Counter {
    readonly count: number;
}

export function mountWorld(options: { readonly search?: string; readonly hash?: string } = {}) {
    const auth = new FakeAuth();
    const callables = new FakeCallables();
    const documents = new FakeDocuments();
    const google = new FakeGoogle(auth);
    const local = new MemoryStore();
    const session = new MemoryStore();
    const location = new FakeLocation(options.hash ?? '', options.search ?? '');
    const analytics: AnalyticsPort = { setConsent: vi.fn(), log: vi.fn(), field: vi.fn() };
    const pages = new PageRegistry();
    pages.register('admins', () => Promise.resolve('hcm-admins-page'));
    const { log, recording } = testLog();
    let services: ShellServices<Counter> | null = null;
    const setup: SetupModuleSpec<Counter, { bump(): void }> = {
        initial: { count: 0 },
        create: (shell) => {
            services = shell;
            return {
                bump: () => {
                    shell.setSetup({ count: shell.getState().setup.count + 1 });
                },
            };
        },
    };
    const deps: AdminDeps<Counter, { bump(): void }> = {
        config: { ...E2E_WEB_CONFIG, measurementId: 'G-E2E0000000' },
        runtime: { release: 'e2e' },
        project: { projectId: 'demo-hcm', cities: ['bucharest'] },
        firebase: { auth, callables, documents, storage: NO_STORAGE },
        google,
        fetch: () => Promise.reject(new Error('no network in this test')),
        clock: new FakeClock(),
        session,
        local,
        location,
        log,
        visibility: new FakeVisibility(),
        // A browser language the interface does not have (Swedish): the admin starts in Romanian.
        languages: ['sv-SE'],
        pages,
        telemetry: () => new AdminTelemetry({ local, analytics, errors: { report: vi.fn() }, clearCookies: vi.fn(), log }),
        setup,
    };
    const services$ = (): ShellServices<Counter> => {
        if (services === null) {
            throw new Error('the setup module was not created');
        }
        return services;
    };
    return { auth, callables, documents, google, local, session, location, analytics, recording, deps, services: services$ };
}
