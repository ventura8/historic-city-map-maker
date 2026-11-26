// Fakes of the Setup Assistant's ports (packages/admin/src/setup/ports.ts): a movable clock whose timers run in
// order, a visibility switch, an in-memory sessionStorage, Google consent that records each popup, and vi.fn ports
// for Google Cloud, the callables and the legacy importer. Test tokens come from @hcm/test-support (built at run time).
import { API_ERRORS, PROVISION_ITEMS, createLogger, type ApiErrorCode, type SetupStatusView } from '@hcm/shared';
import { createRecordingSink, type RecordingSink } from '@hcm/test-support';
import { GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { vi, type Mock } from 'vitest';

import { GOOGLE_SCOPES, unsatisfiedScopes, type GoogleScope } from '../../src/google/scopes.js';
import type { InstallerPort } from '../../src/install/ports.js';
import type {
    GoogleAccess,
    SetupBackend,
    SetupClock,
    SetupCloud,
    SetupDeps,
    SetupGoogleAuth,
    SetupHost,
    SetupLegacyImport,
    SetupSourcesPort,
    SessionStore,
    VisibilityPort,
} from '../../src/setup/ports.js';

export const START = Date.parse('2026-10-12T09:00:00.000Z');
export const PROJECT_ID = 'demo-hcm';

interface Timer {
    readonly id: number;
    readonly at: number;
    readonly callback: () => void;
}

/** A clock whose `advance` runs the due timers in time order (a timer set by a timer runs in the same advance). */
export class FakeClock implements SetupClock {
    time = START;
    private timers: Timer[] = [];
    private nextId = 1;

    now(): number {
        return this.time;
    }

    setTimeout(callback: () => void, ms: number): number {
        const id = this.nextId++;
        this.timers.push({ id, at: this.time + ms, callback });
        return id;
    }

    clearTimeout(handle: unknown): void {
        this.timers = this.timers.filter((timer) => timer.id !== handle);
    }

    pending(): number {
        return this.timers.length;
    }

    /** Moves time forward by `ms`, running every timer that falls due, and lets the promises they started settle. */
    async advance(ms: number): Promise<void> {
        const end = this.time + ms;
        for (let next = this.due(end); next !== undefined; next = this.due(end)) {
            this.timers = this.timers.filter((timer) => timer !== next);
            this.time = next.at;
            next.callback();
            await flush();
        }
        this.time = end;
    }

    private due(end: number): Timer | undefined {
        return this.timers.filter((timer) => timer.at <= end).toSorted((a, b) => a.at - b.at || a.id - b.id)[0];
    }
}

/** Lets every pending promise chain settle (the fakes answer without timers). */
export function flush(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

export class FakeVisibility implements VisibilityPort {
    shown = true;
    private readonly listeners = new Set<(visible: boolean) => void>();

    visible(): boolean {
        return this.shown;
    }

    onChange(listener: (visible: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    set(visible: boolean): void {
        this.shown = visible;
        for (const listener of [...this.listeners]) {
            listener(visible);
        }
    }

    listening(): number {
        return this.listeners.size;
    }
}

export class FakeSession implements SessionStore {
    readonly values = new Map<string, string>();

    get(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    set(key: string, value: string): void {
        this.values.set(key, value);
    }

    remove(key: string): void {
        this.values.delete(key);
    }
}

/** A token granting `scopes` for an hour from `now`. */
export function access(now: number, ...scopes: GoogleScope[]): GoogleAccess {
    return { token: GOOGLE_TOKENS.owner, scopes: scopes.map((scope) => GOOGLE_SCOPES[scope]), expiresAt: now + 3_600_000 };
}

/** Google consent: every popup is recorded and grants what it asked for, unless a test says otherwise. */
class FakeGoogle implements SetupGoogleAuth {
    current: GoogleAccess | null = null;
    readonly requests: GoogleScope[] = [];
    dropped = 0;
    answer: (scope: GoogleScope) => Promise<GoogleAccess | null>;

    constructor(private readonly clock: FakeClock) {
        this.answer = (scope) => Promise.resolve(access(this.clock.now(), scope));
    }

    live(scope: GoogleScope): GoogleAccess | null {
        const current = this.current;
        return current !== null && unsatisfiedScopes(current.scopes, [scope]).length === 0 ? current : null;
    }

    request(scope: GoogleScope): Promise<GoogleAccess | null> {
        this.requests.push(scope);
        return this.answer(scope).then((granted) => {
            this.current = granted ?? this.current;
            return granted;
        });
    }

    drop(): void {
        this.current = null;
        this.dropped += 1;
    }

    /** Owns the live token of `scope` now. */
    grant(...scopes: GoogleScope[]): void {
        this.current = access(this.clock.now(), ...scopes);
    }
}

/** An error as google-clients throws it. */
export function googleError(kind: string, extra: Readonly<Record<string, string>> = {}): Error {
    return Object.assign(new Error(kind), { kind, ...extra });
}

/** A callable's failure as the Firebase SDK reports it. */
export function functionsError(code: ApiErrorCode, params?: Readonly<Record<string, string>>): Error {
    const details = params === undefined ? { code } : { code, params };
    return Object.assign(new Error(code), { code: `functions/${API_ERRORS[code].status}`, details });
}

type Fake<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K] };

const AREA = { state: 'missing', checkedAt: null } as const;

/** A `setup.status` answer: nothing set up unless `changes` says so. */
export function statusView(changes: Partial<SetupStatusView> = {}): SetupStatusView {
    return {
        billing: AREA,
        provision: { ...AREA, items: [] },
        mapbox: AREA,
        usgs: AREA,
        analytics: AREA,
        crash: AREA,
        secretsRev: 0,
        ready: false,
        generatedAt: new Date(START).toISOString(),
        ...changes,
    };
}

/** Every doctor item `ok` (the scheduler `pending` unless `schedulerOk`). */
export function provisionedItems(schedulerOk = false): SetupStatusView['provision']['items'] {
    return PROVISION_ITEMS.map((id) => ({ id, state: id === 'scheduler' && !schedulerOk ? 'pending' : 'ok' }));
}

export interface Harness {
    readonly deps: SetupDeps;
    readonly clock: FakeClock;
    readonly visibility: FakeVisibility;
    readonly session: FakeSession;
    readonly google: FakeGoogle;
    readonly cloud: Fake<SetupCloud>;
    readonly backend: Fake<SetupBackend>;
    readonly importer: Fake<SetupLegacyImport>;
    /** M28: the city's sources; by default a saved choice of the defaults (`{}`), so the Sources step is done. */
    readonly sources: Fake<SetupSourcesPort>;
    readonly host: Fake<SetupHost>;
    readonly logs: RecordingSink;
    /** The shell's snackbar (M6 setup-ux). */
    readonly notify: Mock<SetupDeps['notify']>;
    /** M6 installer: the Cloud Build port (nothing installed, no build, unless a test says otherwise). */
    readonly installer: Fake<InstallerPort>;
}

/** The release the harness's admin runs (M6 installer). */
export const ADMIN_RELEASE = '1.0.0+abc1234';
/** Its build time (finding 39 of 2026-11-01). */
export const ADMIN_RELEASE_TIME = 1_761_955_200;

function fakeInstaller(): Fake<InstallerPort> {
    return {
        observe: vi
            .fn<InstallerPort['observe']>()
            .mockResolvedValue({ installed: { complete: false, release: null }, build: null, progress: null, blocker: null }),
        submit: vi.fn<InstallerPort['submit']>().mockImplementation((target) =>
            Promise.resolve({
                id: `build-${target}-0001`,
                status: 'QUEUED',
                steps: [],
                tags: ['hcm-install', `hcm-${target}`, 'hcm-r-1-0-0-abc1234'],
                substitutions: {},
            }),
        ),
        buildLog: vi.fn<InstallerPort['buildLog']>().mockResolvedValue([]),
        localBlocker: vi.fn<InstallerPort['localBlocker']>().mockResolvedValue(null),
        consoleUrl: vi
            .fn<InstallerPort['consoleUrl']>()
            .mockImplementation((id) => `https://console.cloud.google.com/cloud-build/builds/${id}`),
    };
}

function fakeCloud(): Fake<SetupCloud> {
    return {
        disabledApis: vi.fn<SetupCloud['disabledApis']>().mockResolvedValue([]),
        enableApis: vi.fn<SetupCloud['enableApis']>().mockResolvedValue(undefined),
        observeBilling: vi.fn<SetupCloud['observeBilling']>().mockResolvedValue({ linkedAccount: null, accounts: [] }),
        linkBilling: vi.fn<SetupCloud['linkBilling']>().mockResolvedValue(undefined),
        ensureBudget: vi
            .fn<SetupCloud['ensureBudget']>()
            .mockResolvedValue({ budgetId: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC/budgets/b-1' }),
        provision: vi.fn<SetupCloud['provision']>().mockResolvedValue([]),
        doctor: vi.fn<SetupCloud['doctor']>().mockResolvedValue([]),
        deployment: vi.fn<SetupCloud['deployment']>().mockResolvedValue({ ready: 0, total: 32, failed: [] }),
        disablePageChanges: vi.fn<SetupCloud['disablePageChanges']>().mockResolvedValue({ pageChangesEnabled: false }),
        setCrashAlerts: vi.fn<SetupCloud['setCrashAlerts']>().mockImplementation((_access, enabled) => Promise.resolve({ enabled })),
        createMeasurementReports: vi.fn<SetupCloud['createMeasurementReports']>().mockResolvedValue({ created: 14, skipped: 0 }),
    };
}

function fakeBackend(): Fake<SetupBackend> {
    return {
        status: vi.fn<SetupBackend['status']>().mockResolvedValue(statusView()),
        selfTest: vi.fn<SetupBackend['selfTest']>().mockResolvedValue({ checks: [], status: statusView() }),
        recordCloud: vi.fn<SetupBackend['recordCloud']>().mockResolvedValue({ status: statusView() }),
        createCity: vi.fn<SetupBackend['createCity']>().mockResolvedValue({ created: true }),
        saveMapbox: vi.fn<SetupBackend['saveMapbox']>(),
        saveUsgs: vi.fn<SetupBackend['saveUsgs']>(),
        rotatePublicToken: vi.fn<SetupBackend['rotatePublicToken']>(),
        analyticsConfig: vi.fn<SetupBackend['analyticsConfig']>(),
        listGroups: vi.fn<SetupBackend['listGroups']>().mockResolvedValue({ groups: [] }),
    };
}

export function createHarness(): Harness {
    const clock = new FakeClock();
    const visibility = new FakeVisibility();
    const session = new FakeSession();
    const google = new FakeGoogle(clock);
    const cloud = fakeCloud();
    const backend = fakeBackend();
    const importer: Fake<SetupLegacyImport> = {
        detect: vi.fn<SetupLegacyImport['detect']>().mockResolvedValue({ done: 0, total: 45, failed: [] }),
        run: vi.fn<SetupLegacyImport['run']>().mockResolvedValue({ done: 45, total: 45, failed: [] }),
    };
    const sources: Fake<SetupSourcesPort> = {
        read: vi.fn<SetupSourcesPort['read']>().mockResolvedValue({}),
        save: vi.fn<SetupSourcesPort['save']>().mockResolvedValue(undefined),
        country: vi.fn<SetupSourcesPort['country']>().mockResolvedValue(null),
    };
    const host: Fake<SetupHost> = {
        projectId: PROJECT_ID,
        projectNumber: '123456789012',
        authDomain: `${PROJECT_ID}.firebaseapp.com`,
        cityId: 'bucharest',
        github: true,
        cityBBox: [25.96, 44.33, 26.23, 44.54],
        serverDeployed: vi.fn<SetupHost['serverDeployed']>().mockResolvedValue(true),
        release: ADMIN_RELEASE,
        releaseTime: ADMIN_RELEASE_TIME,
        siteAddress: `https://${PROJECT_ID}.web.app/`,
    };
    const logs = createRecordingSink();
    const log = createLogger('admin', { sink: logs.sink, minLevel: 'debug' }).child('setup');
    const notify = vi.fn<SetupDeps['notify']>();
    const installer = fakeInstaller();
    const deps: SetupDeps = { host, google, cloud, backend, importer, sources, clock, visibility, session, log, notify, installer };
    return { deps, clock, visibility, session, google, cloud, backend, importer, sources, host, logs, notify, installer };
}
