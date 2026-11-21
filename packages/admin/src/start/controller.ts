/**
 * The start page's state (`docs/research/M14-start-your-map.md`): the screens, the form and the run. It holds the token
 * in memory only and asks the browser for nothing but through its ports, so the tests drive it end to end over the fake
 * upstreams. `<hcm-start-page>` renders the view and calls the intents.
 */
import { startConfigSchema, type UiLocale, type Logger, type StartConfig } from '@hcm/shared';

import type { Clock, KeyValueStore } from '../app/ports.js';
import { createGoogleTransport } from '../google/transport.js';
import { resolveAdminLocale } from '../state/locale.js';
import {
    firstShown,
    isBundled,
    latestLanguage,
    uiCatalogueLoader,
    type LanguageSwitch,
    type UiCatalogueLoader,
} from '../state/ui-language.js';
import { consentUrl, readConsentAnswer, type ConsentAnswer, type StartToken } from './consent.js';
import { deployStart, START_STEPS, type StartStepId } from './deploy.js';
import { startFailureOf } from './failure.js';
import { loadRelease, type FileTools } from './files.js';
import { nextProjectId, planOf, withCityId, withName, type AreaEdge, type StartForm } from './form.js';
import { createStartGoogle, type StartGoogle } from './google.js';
import { clearPlan, loadPlan, rememberState, savePlan, takeState, type StartPlan } from './plan.js';
import { INITIAL, NOTICE_OF_ANSWER, stepStateAt, WAITING_STEPS, type StartView, type StepState } from './view.js';

export interface StartIntents {
    setLocale(locale: UiLocale): void;
    signIn(): void;
    setName(name: string): void;
    setNameEn(name: string): void;
    setCityId(cityId: string): void;
    setEdge(edge: AreaEdge, value: string): void;
    setCreate(create: boolean): void;
    setProjectId(projectId: string): void;
    setPicked(projectId: string): void;
    go(): void;
    tryAgain(): void;
    checkProvider(): void;
}

export interface StartDeps {
    readonly fetch: typeof fetch;
    readonly tools: FileTools;
    readonly clock: Clock;
    readonly session: KeyValueStore;
    /** The visitor's language choice (`hcm:start:lang`): `localStorage`, kept after the tab is closed (try/catch inside). */
    readonly local: KeyValueStore;
    readonly log: Logger;
    /** The start site's address, the redirect URI (no fragment or query). */
    readonly baseUrl: string;
    readonly fragment: () => string;
    readonly clearFragment: () => void;
    readonly assign: (url: string) => void;
    readonly random: () => string;
    readonly search: string;
    readonly languages: readonly string[];
    readonly authorizeUrl: string;
    /** The e2e world's partition, for the consent stand-in. */
    readonly testId?: string;
    /** The terminal road (the catalogue names it with this command). */
    readonly command: string;
    /** The languages beyond Romanian and English (`docs/I18N.md` → Loading): the page's `i18n/` folder by default. */
    readonly loadTexts?: UiCatalogueLoader;
}

const CONFIG_FILE = 'start-config.json';
const LANGUAGE_KEY = 'hcm:start:lang';
/** The upload is the long part; a token this close to its end would stop in the middle. */
const MIN_TOKEN_LIFE_MS = 5 * 60_000;
export class StartController {
    readonly #deps: StartDeps;
    readonly #loadTexts: UiCatalogueLoader;
    readonly #wanted: UiLocale;
    readonly #listeners = new Set<() => void>();
    /** The page's first language and the picker's choices: the latest wins over a file still loading. */
    readonly #switchLanguage = latestLanguage();
    #view: StartView;
    #grant: StartToken | null = null;
    #config: StartConfig | null = null;

    readonly intents: StartIntents = {
        setLocale: (locale) => {
            void this.#switchLanguage(this.#language(true), locale);
        },
        signIn: () => {
            this.#consent();
        },
        setName: (name) => {
            this.#form(withName(this.#view.form, name));
        },
        setNameEn: (nameEn) => {
            this.#form({ ...this.#view.form, nameEn });
        },
        setCityId: (cityId) => {
            this.#form(withCityId(this.#view.form, cityId.trim().toLowerCase()));
        },
        setEdge: (edge, value) => {
            this.#form({ ...this.#view.form, area: { ...this.#view.form.area, [edge]: value } });
        },
        setCreate: (create) => {
            this.#form({ ...this.#view.form, create });
            if (!create) {
                void this.#loadProjects();
            }
        },
        setProjectId: (projectId) => {
            this.#form({ ...this.#view.form, projectId: projectId.trim().toLowerCase(), projectIdEdited: true });
        },
        setPicked: (picked) => {
            this.#form({ ...this.#view.form, picked });
        },
        go: () => {
            void this.#go();
        },
        tryAgain: () => {
            void this.#retry();
        },
        checkProvider: () => {
            void this.#checkProvider();
        },
    };

    constructor(deps: StartDeps) {
        this.#deps = deps;
        this.#wanted = resolveAdminLocale(deps.search, deps.local.get(LANGUAGE_KEY), deps.languages);
        this.#loadTexts = deps.loadTexts ?? uiCatalogueLoader(deps.fetch, 'i18n/');
        // A language beyond the bundled two shows once its texts are here (`start`); English before.
        this.#view = { ...INITIAL, command: deps.command, locale: firstShown(this.#wanted) };
    }

    /** The page's first language, when it is not bundled: fetched as the page starts. */
    #startLanguage(): void {
        if (!isBundled(this.#wanted)) {
            void this.#switchLanguage(this.#language(false), this.#wanted);
        }
    }

    /** The switch to a language: shown once its texts are here (and remembered, when the visitor chose it), else a notice. */
    #language(remember: boolean): LanguageSwitch {
        return {
            load: this.#loadTexts,
            apply: (locale) => {
                if (remember) {
                    this.#deps.local.set(LANGUAGE_KEY, locale);
                }
                this.#update({ locale });
            },
            unavailable: () => {
                this.#update({ notice: 'start.languageUnavailable' });
            },
        };
    }

    get view(): StartView {
        return this.#view;
    }

    subscribe(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /** Reads the configuration and Google's answer, if the address carries one, and opens the right screen. */
    async start(): Promise<void> {
        this.#startLanguage();
        const fragment = this.#deps.fragment();
        this.#deps.clearFragment();
        this.#config = await this.#readConfig();
        if (this.#config?.oauthClientId === undefined) {
            this.#update({ screen: 'closed' });
            return;
        }
        await this.#open(readConsentAnswer(fragment, takeState(this.#deps.session), this.#deps.clock.now()));
    }

    async #open(answer: ConsentAnswer): Promise<void> {
        const plan = loadPlan(this.#deps.session);
        if (answer.kind === 'granted') {
            this.#grant = answer.grant;
            await this.#afterConsent(plan);
        } else if (answer.kind !== 'none') {
            this.#update({ notice: NOTICE_OF_ANSWER[answer.kind] });
        } else if (plan !== null) {
            this.#reloaded(plan);
        }
    }

    /** A reload: the plan is here, the token is not (it never leaves memory). After the release only the provider is left. */
    #reloaded(plan: StartPlan): void {
        if (plan.released === true) {
            this.#update({ screen: 'provider', plan });
            return;
        }
        this.#update({ screen: 'work', plan, failure: { key: 'start.failure.expired', action: 'consent' } });
    }

    #update(patch: Partial<StartView>): void {
        this.#view = { ...this.#view, ...patch };
        this.#listeners.forEach((listener) => {
            listener();
        });
    }

    #form(form: StartForm): void {
        this.#update({ form });
    }

    async #readConfig(): Promise<StartConfig | null> {
        const response = await this.#deps
            .fetch(new URL(CONFIG_FILE, this.#deps.baseUrl).toString(), { cache: 'no-cache' })
            .catch(() => null);
        const body: unknown = response?.ok === true ? await response.json().catch(() => null) : null;
        const parsed = startConfigSchema.safeParse(body);
        return parsed.success ? parsed.data : null;
    }

    #consent(): void {
        const deps = this.#deps;
        const state = deps.random();
        rememberState(deps.session, state);
        deps.assign(
            consentUrl({
                authorizeUrl: deps.authorizeUrl,
                clientId: this.#config?.oauthClientId ?? '',
                redirectUri: deps.baseUrl,
                state,
                ...(deps.testId === undefined ? {} : { testId: deps.testId }),
            }),
        );
    }

    async #afterConsent(plan: StartPlan | null): Promise<void> {
        if (plan === null) {
            this.#update({ screen: 'plan' });
            return;
        }
        if (plan.released === true) {
            // The site may have moved on since (M14 §7): a new consent only reads the provider again, it never releases.
            this.#update({ plan });
            await this.#checkProvider();
            return;
        }
        await this.#run(plan);
    }

    #google(): StartGoogle {
        const deps = this.#deps;
        return createStartGoogle(
            createGoogleTransport({
                fetch: (...args) => deps.fetch(...args),
                token: () => this.#grant?.token ?? null,
                sleep: (ms) =>
                    new Promise((resolve) => {
                        deps.clock.setTimeout(resolve, ms);
                    }),
                log: deps.log.child('google'),
            }),
        );
    }

    async #loadProjects(): Promise<void> {
        if (this.#view.projects !== null) {
            return;
        }
        try {
            this.#update({ projects: await this.#google().listProjects() });
        } catch (error) {
            this.#deps.log.warn('the projects could not be listed', { error: String(error) });
            this.#update({ projects: [] });
        }
    }

    async #go(): Promise<void> {
        const plan = planOf(this.#view.form);
        if (plan === null) {
            return;
        }
        savePlan(this.#deps.session, plan);
        await this.#run(plan);
    }

    async #retry(): Promise<void> {
        const { failure, plan } = this.#view;
        if (failure?.action === 'consent' || !this.#tokenLives()) {
            this.#consent();
            return;
        }
        if (plan !== null) {
            await this.#run(plan);
        }
    }

    #tokenLives(): boolean {
        return this.#grant !== null && this.#grant.expiresAt - this.#deps.clock.now() >= MIN_TOKEN_LIFE_MS;
    }

    async #run(plan: StartPlan): Promise<void> {
        if (!this.#tokenLives()) {
            this.#update({ screen: 'work', plan, failure: { key: 'start.failure.expired', action: 'consent' } });
            return;
        }
        this.#update({ screen: 'work', plan, failure: null, busy: true, steps: WAITING_STEPS, files: { done: 0, total: 0 } });
        let current: StartStepId = 'project';
        const google = this.#google();
        try {
            const release = await loadRelease(this.#deps.tools, this.#deps.baseUrl, this.#config?.release ?? '');
            await deployStart(
                {
                    google,
                    tools: this.#deps.tools,
                    clock: this.#deps.clock,
                    baseUrl: this.#deps.baseUrl,
                    release,
                    onStep: (step) => {
                        current = step;
                        this.#mark(step);
                    },
                    onFiles: (done, total) => {
                        this.#update({ files: { done, total } });
                    },
                },
                plan,
                () => this.#grant?.token ?? null,
            );
        } catch (error) {
            this.#failed(error, current, plan);
            return;
        }
        const released: StartPlan = { ...plan, released: true };
        savePlan(this.#deps.session, released);
        this.#update({ busy: false, plan: released, steps: { ...this.#view.steps, release: 'done' } });
        await this.#checkProvider();
    }

    /** `step` is under way and every step before it is done. */
    #mark(step: StartStepId): void {
        const index = START_STEPS.indexOf(step);
        const steps = Object.fromEntries(START_STEPS.map((id, position) => [id, stepStateAt(position, index)])) as Record<
            StartStepId,
            StepState
        >;
        this.#update({ steps });
    }

    #failed(error: unknown, step: StartStepId, plan: StartPlan): void {
        const failure = startFailureOf(error, {
            step,
            projectId: plan.projectId,
            create: plan.create,
            command: this.#deps.command,
        });
        this.#deps.log.warn('a start step failed', { step, key: failure.key });
        const steps = { ...this.#view.steps, [step]: 'failed' as const };
        if (failure.action === 'form') {
            // The form says why, with what it can offer: a taken id gives way to a free one.
            const form =
                failure.key === 'start.failure.taken'
                    ? { ...this.#view.form, projectId: nextProjectId(plan.projectId), projectIdEdited: true }
                    : this.#view.form;
            clearPlan(this.#deps.session);
            this.#update({ screen: 'plan', form, failure, busy: false, steps, plan: null });
            return;
        }
        this.#update({ failure, busy: false, steps });
    }

    async #checkProvider(): Promise<void> {
        const { plan } = this.#view;
        if (plan === null) {
            return;
        }
        if (!this.#tokenLives()) {
            this.#consent();
            return;
        }
        this.#showProvider(await this.#providerOn(plan.projectId));
    }

    #showProvider(read: 'on' | 'off' | 'unreadable'): void {
        if (read === 'on') {
            clearPlan(this.#deps.session);
            this.#update({ screen: 'done', providerWaiting: false, providerUnreadable: false });
            return;
        }
        this.#update({
            screen: 'provider',
            providerWaiting: read === 'off' && this.#view.screen === 'provider',
            providerUnreadable: read === 'unreadable',
        });
    }

    /** Whether Google sign-in is on; a read that fails is said apart from "not yet", and Check again reads again. */
    async #providerOn(projectId: string): Promise<'on' | 'off' | 'unreadable'> {
        try {
            return (await this.#google().googleSignInOn(projectId)) ? 'on' : 'off';
        } catch (error) {
            this.#deps.log.warn('the sign-in provider could not be read', { error: String(error) });
            return 'unreadable';
        }
    }
}
