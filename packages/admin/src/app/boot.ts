/**
 * The admin's boot (`docs/research/M2b-interfaces.md` §1.4): the web configuration first (unreadable or invalid: the
 * `configMissing` screen with Reload, nothing else runs), then the optional runtime file, then the ports and `mount`.
 */
import type { Logger, UiLocale } from '@hcm/shared';

import { ContentRegistry } from '../content/registry.js';
import { NO_GATE, type AdminState, type NoticeInput } from '../state/state.js';
import { LANGUAGE_KEY, resolveAdminLocale } from '../state/locale.js';
import { Store } from '../state/store.js';
import { firstShown } from '../state/ui-language.js';
import type { ProjectConfig } from '../provision/project-config.js';
import { loadProject, loadRuntime, loadWebConfig, type AdminRuntime, type FirebaseWebConfig } from './config.js';
import { mount, storedTheme, themeIntents, type AdminApp, type AdminDeps, type AdminIntents } from './mount.js';
import type { HashLocation, KeyValueStore } from './ports.js';
import { adminLanguage } from './language.js';
import { AdminTelemetry } from './telemetry.js';

export interface BootEnvironment<Setup, SetupIntents> {
    readonly fetch: typeof fetch;
    readonly location: HashLocation;
    readonly local: KeyValueStore;
    readonly languages: readonly string[];
    readonly log: Logger;
    /**
     * Every other dependency of `mount`, built once the configuration is known (the Firebase app needs it); `project` is
     * the page's `project.json`, or null without one.
     */
    readonly build: (
        config: FirebaseWebConfig,
        runtime: AdminRuntime,
        project: ProjectConfig | null,
    ) => Omit<AdminDeps<Setup, SetupIntents>, 'config' | 'runtime'>;
}

const NOTHING = (): Promise<void> => Promise.resolve();

/** No editor area: the configuration is missing, so no page can open. */
const NO_CONTENT = new ContentRegistry({}, () => {
    throw new Error('no content services without a configuration');
}).stores;

type MissingEnvironment = Pick<BootEnvironment<null, null>, 'fetch' | 'location' | 'local' | 'languages' | 'log'>;

function missingState(env: MissingEnvironment): AdminState<null> {
    return {
        auth: 'configMissing',
        mode: null,
        user: null,
        role: null,
        busy: false,
        gate: NO_GATE,
        route: { id: 'setup', params: [] },
        destinations: [],
        locale: firstShown(wantedLocale(env)),
        theme: storedTheme(env.local),
        consent: 'unknown',
        analytics: false,
        windowClass: 'compact',
        notice: null,
        leaving: null,
        revoked: false,
        newRelease: null,
        people: {},
        unread: null,
        cities: [],
        cityId: null,
        projectOwner: false,
        setupReady: null,
        projectId: '',
        authDomain: '',
        setup: null,
    };
}

function wantedLocale(env: MissingEnvironment): UiLocale {
    return resolveAdminLocale(env.location.search(), env.local.get(LANGUAGE_KEY), env.languages);
}

/** The app of a page without a readable web configuration: its screen, Reload, the language and the theme. */
export function configMissingApp(env: MissingEnvironment): AdminApp<null, null> {
    const initial = missingState(env);
    const store = new Store(initial, env.log);
    const shell = {
        update: (patch: Partial<AdminState<null>>): void => {
            store.update(patch);
        },
        notice: (input: NoticeInput) => ({ ...input, id: 1 }),
    };
    const language = adminLanguage({ fetch: env.fetch, local: env.local, shell });
    void language.start(wantedLocale(env));
    const intents: AdminIntents<null> = {
        ...{ signIn: NOTHING, signOut: NOTHING, claim: NOTHING, join: NOTHING, retry: NOTHING, enableApi: NOTHING, leavePage: NOTHING },
        stayOnPage: () => undefined,
        reload: () => {
            env.location.reload();
        },
        navigate: () => undefined,
        switchCity: () => undefined,
        refreshCities: NOTHING,
        setLocale: (locale) => {
            void language.choose(locale);
        },
        ...themeIntents(
            env.local,
            () => store.state.theme,
            (patch) => {
                store.update(patch);
            },
        ),
        ...{ previewTheme: () => undefined, setConsent: () => undefined, dismissNotice: () => undefined, setWindowClass: () => undefined },
        setup: null,
    };
    const telemetry = new AdminTelemetry({
        local: env.local,
        analytics: null,
        errors: { report: () => undefined },
        clearCookies: () => undefined,
        log: env.log,
    });
    return {
        get state() {
            return store.state;
        },
        subscribe: (listener) => store.subscribe(listener),
        intents,
        loadPage: () => Promise.resolve(null),
        telemetry,
        content: NO_CONTENT,
        hasUnsavedChanges: () => false,
        destroy: () => undefined,
    };
}

/** §1.4 steps 1–3 (and the project file); the probe and the rest happen in `mount`. */
export async function bootAdmin<Setup, SetupIntents>(
    env: BootEnvironment<Setup, SetupIntents>,
): Promise<AdminApp<Setup, SetupIntents> | AdminApp<null, null>> {
    const config = await loadWebConfig(env.fetch);
    if (config === null) {
        env.log.error('the Firebase web configuration is missing or invalid');
        return configMissingApp(env);
    }
    const [runtime, project] = await Promise.all([loadRuntime(env.fetch), loadProject(env.fetch)]);
    env.log.info('admin booting', {
        projectId: config.projectId,
        release: runtime.release,
        startUp: runtime.startUp === true,
        appCheck: runtime.appCheckSiteKey !== undefined,
        project: project !== null,
    });
    return mount({ ...env.build(config, runtime, project), config, runtime });
}
