/** The start page's element: what each screen shows and which intent each control calls (`docs/research/M14-start-your-map.md`). */
import { translateStart, type StartKey } from '@hcm/shared';
import type { LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import {
    defineHcmStartPage,
    HCM_START_PAGE_TAG,
    type HcmStartPage,
    type StartPagePort,
    type StartPageView,
} from '../../src/start/hcm-start-page.js';

const t = (key: StartKey, params?: Readonly<Record<string, string>>): string => translateStart('en', key, params);

const VIEW: StartPageView = {
    screen: 'intro',
    locale: 'en',
    form: {
        nameRo: '',
        nameEn: '',
        cityId: '',
        area: { west: '', south: '', east: '', north: '' },
        create: true,
        projectId: '',
        picked: '',
    },
    projects: null,
    notice: null,
    steps: { project: 'done', firebase: 'working', webApp: 'waiting', site: 'waiting', files: 'waiting', release: 'failed' },
    files: { done: 1, total: 3 },
    failure: null,
    busy: false,
    plan: { projectId: 'fostul-bacau', city: { name: { ro: 'Bacău' } } },
    providerWaiting: false,
    providerUnreadable: false,
    command: 'npx create-historic-city@1 self-host',
};

interface Rendered {
    readonly page: HcmStartPage;
    readonly calls: unknown[][];
    readonly root: ShadowRoot;
    readonly change: (next: Partial<StartPageView>) => Promise<void>;
}

function shadowOf(page: HcmStartPage): ShadowRoot {
    const { shadowRoot } = page;
    if (shadowRoot === null) {
        throw new Error('no shadow root');
    }
    return shadowRoot;
}

async function rendered(
    view: Partial<StartPageView>,
    problems: Partial<ReturnType<StartPagePort['problems']>> = {},
    extra: { readonly censusBox?: () => readonly [number, number, number, number] | null } = {},
): Promise<Rendered> {
    defineHcmStartPage();
    const calls: unknown[][] = [];
    const listeners = new Set<() => void>();
    let current: StartPageView = { ...VIEW, ...view };
    const intents = new Proxy(
        {},
        {
            get:
                (_target, name) =>
                (...args: unknown[]) =>
                    calls.push([name, ...args]),
        },
    ) as StartPagePort['intents'];
    const page = document.createElement(HCM_START_PAGE_TAG) as HcmStartPage;
    page.port = {
        get view() {
            return current;
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        intents,
        problems: () => ({ cityId: null, area: null, projectId: null, ready: true, ...problems }),
        ...extra,
    };
    document.body.append(page);
    await page.updateComplete;
    return {
        page,
        calls,
        root: shadowOf(page),
        change: async (next) => {
            current = { ...current, ...next };
            listeners.forEach((listener) => {
                listener();
            });
            await page.updateComplete;
        },
    };
}

afterEach(() => {
    document.body.replaceChildren();
});

const input = (root: ShadowRoot, id: string): HTMLInputElement => root.getElementById(id) as HTMLInputElement;
const type = (element: HTMLInputElement | HTMLSelectElement, value: string, name = 'input'): void => {
    element.value = value;
    element.dispatchEvent(new Event(name, { bubbles: true }));
};

/** The start page's language list (a native select in `<hcm-start-language>`). */
async function languageList(root: ParentNode): Promise<HTMLSelectElement> {
    const language = root.querySelector<LitElement>('hcm-start-language');
    await language?.updateComplete;
    const select = language?.shadowRoot?.querySelector('select');
    if (select === null || select === undefined) {
        throw new Error('no language list');
    }
    return select;
}

describe('hcm-start-page', () => {
    it('happyPath_theIntroExplainsThenAsksGoogle', async () => {
        const { root, calls } = await rendered({});
        expect(root.textContent).toContain(t('start.cost.budget'));
        expect(root.textContent).toContain(t('start.consent.warning'));
        expect(root.textContent).toContain(VIEW.command);
        root.querySelector<HTMLButtonElement>('button.filled')?.click();
        expect(calls).toEqual([['signIn']]);
    });

    it('happyPath_theLanguageListSaysWhichIsOnAndOffersEveryLanguage', async () => {
        const { root, calls } = await rendered({});
        const select = await languageList(root);
        expect(select.value).toBe('en');
        expect(select.options).toHaveLength(25);
        expect(select.querySelector('option[value="fa"]')?.getAttribute('lang')).toBe('fa');
        select.value = 'fr';
        select.dispatchEvent(new Event('change'));
        // The list keeps the page's language until the page has switched.
        expect(select.value).toBe('en');
        expect(calls).toEqual([['setLocale', 'fr']]);
        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('badPath_anUnknownLanguageIsNotChosen_andARightToLeftPageTurns', async () => {
        const { root, calls } = await rendered({ locale: 'ur' });
        const select = await languageList(root);
        const unknown = document.createElement('option');
        unknown.value = 'sv';
        select.append(unknown);
        select.value = 'sv';
        select.dispatchEvent(new Event('change'));
        expect(calls).toEqual([]);
        expect(document.documentElement.dir).toBe('rtl');
        // No Urdu file holds the start page's texts: they show in English and say so.
        expect(root.querySelector('main')?.getAttribute('lang')).toBe('en');
        expect(document.documentElement.lang).toBe('ur');
    });

    it('happyPath_theNoticeOfARefusedConsent', async () => {
        const { root } = await rendered({ notice: 'start.signedOut.denied' });
        expect(root.querySelector('[role="alert"]')?.textContent).toBe(t('start.signedOut.denied'));
    });

    it('badPath_theClosedScreenHasNoButton', async () => {
        const { root } = await rendered({ screen: 'closed' });
        expect(root.querySelector('[data-state="closed"]')?.textContent).toContain(VIEW.command);
        expect(root.querySelector('button.filled')).toBeNull();
    });

    it('happyPath_theFormsFieldsCallTheirIntents', async () => {
        const { root, calls, page } = await rendered({ screen: 'plan' });
        type(input(root, 'name-ro'), 'Bacău');
        type(input(root, 'name-en'), 'Bacau');
        type(input(root, 'city-id'), 'bacau');
        type(input(root, 'edge-west'), '26');
        type(input(root, 'project-id'), 'fostul-bacau');
        root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(calls).toEqual([
            ['setName', 'Bacău'],
            ['setNameEn', 'Bacau'],
            ['setCityId', 'bacau'],
            ['setEdge', 'west', '26'],
            ['setProjectId', 'fostul-bacau'],
            ['go'],
        ]);
        expect(page.shadowRoot?.querySelector('button[type="submit"]')?.textContent).toContain(t('start.plan.go'));
    });

    it('badPath_theFormSaysWhatItCannotTake', async () => {
        const { root } = await rendered(
            { screen: 'plan' },
            { cityId: 'start.plan.cityIdInvalid', area: 'start.plan.areaTooBig', projectId: 'start.plan.projectIdInvalid', ready: false },
        );
        expect(root.querySelector('#city-id-problem')?.textContent).toBe(t('start.plan.cityIdInvalid'));
        expect(input(root, 'project-id').getAttribute('aria-invalid')).toBe('true');
        expect(root.querySelector('[data-area-problem]')?.textContent).toBe(t('start.plan.areaTooBig'));
        expect(root.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    });

    it('happyPath_anExistingProjectIsPickedFromTheList', async () => {
        const { root, calls, change } = await rendered({ screen: 'plan', form: { ...VIEW.form, create: false } });
        expect(root.querySelector('[data-no-projects]')?.textContent).toBe('…');
        await change({ projects: [] });
        expect(root.querySelector('[data-no-projects]')?.textContent).toBe(t('start.plan.pickNone'));
        await change({ projects: [{ projectId: 'one-project', displayName: 'One' }] });
        const select = root.querySelector<HTMLSelectElement>('select');
        if (select === null) {
            throw new Error('no list');
        }
        type(select, 'one-project', 'change');
        expect(calls).toEqual([['setPicked', 'one-project']]);
        expect(root.querySelector('button[type="submit"]')?.textContent).toContain(t('start.plan.goExisting'));
        root.querySelector<HTMLInputElement>('input[type="radio"]')?.dispatchEvent(new Event('change'));
        expect(calls.at(-1)).toEqual(['setCreate', true]);
    });
});

describe('hcm-start-page, the run', () => {
    it('happyPath_theRunShowsEachStep', async () => {
        const { root } = await rendered({ screen: 'work' });
        expect(root.querySelector('[data-step="firebase"]')?.getAttribute('data-state')).toBe('working');
        expect(root.querySelector('[data-step="files"]')?.textContent).toContain(t('start.step.files', { done: '1', total: '3' }));
        expect(root.querySelector('[data-step="release"]')?.textContent).toContain(t('start.step.state.failed'));
    });

    it.each([
        ['again', 'start.tryAgain'],
        ['consent', 'start.continue'],
    ] as const)('badPath_aFailureWithItsAction_%s', async (action, key) => {
        const { root, calls } = await rendered({
            screen: 'work',
            failure: {
                key: 'start.failure.terms',
                action,
                link: { key: 'start.failure.termsLink', url: 'https://console.firebase.google.com/' },
            },
        });
        expect(root.querySelector('[role="alert"] a')?.getAttribute('rel')).toBe('noopener noreferrer');
        const button = root.querySelector<HTMLButtonElement>('[role="alert"] button');
        expect(button?.textContent).toContain(t(key));
        button?.click();
        expect(calls).toEqual([['tryAgain']]);
    });

    it('badPath_aFailureThatGoesBackToTheFormHasNoButton', async () => {
        const { root } = await rendered({ screen: 'plan', failure: { key: 'start.failure.quota', action: 'form' } });
        expect(root.querySelector('[role="alert"]')?.textContent).toContain(t('start.failure.quota'));
        expect(root.querySelector('[role="alert"] button')).toBeNull();
    });

    it('happyPath_theConsoleStepAndItsCheck', async () => {
        const { root, calls, change } = await rendered({ screen: 'provider' });
        expect(root.querySelector('a')?.getAttribute('href')).toBe(
            'https://console.firebase.google.com/project/fostul-bacau/authentication/providers',
        );
        expect(root.querySelector('[data-provider-waiting]')).toBeNull();
        root.querySelector<HTMLButtonElement>('button.filled')?.click();
        expect(calls).toEqual([['checkProvider']]);
        await change({ providerWaiting: true });
        expect(root.querySelector('[data-provider-waiting]')?.textContent).toBe(t('start.provider.waiting'));
    });

    it('happyPath_theProviderStepShowsTheAddressWhateverTheReadSays', async () => {
        const { root } = await rendered({ screen: 'provider' });
        const address = 'https://fostul-bacau.web.app/admin/';
        expect(root.querySelector('[data-open-admin]')?.getAttribute('href')).toBe(address);
        expect(root.textContent).toContain(t('start.provider.address', { address }));
        expect(root.querySelector('[data-provider-unreadable]')).toBeNull();
    });

    it('badPath_aProviderThatCannotBeReadIsNotCalledNotOn', async () => {
        const { root } = await rendered({ screen: 'provider', providerUnreadable: true });
        expect(root.querySelector('[data-provider-unreadable]')?.textContent).toBe(t('start.provider.unreadable'));
        expect(root.querySelector('[data-provider-waiting]')).toBeNull();
        expect(root.querySelector('[data-open-admin]')).not.toBeNull();
    });

    it('a11y_theWorkingStepIsSaidInOnePoliteRegion_withoutTheFileCount', async () => {
        const { root, change } = await rendered({ screen: 'work' });
        const status = (): Element | null => root.querySelector('[role="status"][data-progress]');
        expect(status()?.textContent).toBe(t('start.work.now', { step: t('start.step.firebase') }));
        const region = status();
        await change({ steps: { ...VIEW.steps, firebase: 'done', files: 'working' }, files: { done: 2, total: 3 } });
        expect(status()).toBe(region);
        expect(status()?.textContent).toBe(t('start.work.now', { step: t('start.step.filesShort') }));
        await change({ steps: { ...VIEW.steps, firebase: 'failed' } });
        expect(status()?.textContent).toBe('');
    });

    it('a11y_aNewScreenTakesFocusAtItsHeading_theFirstDoesNot', async () => {
        const { page, root, change } = await rendered({ screen: 'plan' });
        expect(root.activeElement).toBeNull();
        await change({ screen: 'work' });
        await page.updateComplete;
        expect(root.activeElement?.tagName).toBe('H1');
        expect(root.activeElement?.textContent).toBe(t('start.work.title'));
        await change({ steps: { ...VIEW.steps, files: 'working' } });
        expect(root.activeElement?.tagName).toBe('H1');
    });

    it('a11y_aProblemIsAnnouncedAndTiedToItsFields', async () => {
        const { root } = await rendered({ screen: 'plan' }, { area: 'start.plan.areaTooBig', cityId: 'start.plan.cityIdInvalid' });
        const west = root.querySelector('#edge-west');
        expect(west?.getAttribute('aria-invalid')).toBe('true');
        expect(west?.getAttribute('aria-describedby')).toBe('area-problem');
        expect(root.querySelector('#area-problem')?.textContent).toBe(t('start.plan.areaTooBig'));
        expect(root.querySelector('#area-problem')?.closest('[role="status"]')).not.toBeNull();
        expect(root.querySelector('#city-id-problem')?.closest('[role="status"]')).not.toBeNull();
    });

    it('a11y_theRegionsAreThereBeforeAnyProblem', async () => {
        const { root } = await rendered({ screen: 'plan' });
        expect(root.querySelector('#edge-west')?.getAttribute('aria-invalid')).toBe('false');
        expect(root.querySelector('#edge-west')?.hasAttribute('aria-describedby')).toBe(false);
        expect(root.querySelector('#area-problem')).toBeNull();
        expect(root.querySelector('[data-area-status][role="status"]')).not.toBeNull();
        expect(root.querySelector('[data-field-status="name-ro"][role="status"]')).not.toBeNull();
    });

    it('edge_screensWithoutAPlanOrWithTheFormsValues', async () => {
        for (const screen of ['provider', 'done'] as const) {
            const { root } = await rendered({ screen, plan: null });
            expect(root.querySelector('[data-open-admin]')?.getAttribute('href')).toBe('https://.web.app/admin/');
            document.body.replaceChildren();
        }
        const { root } = await rendered({ screen: 'plan', form: { ...VIEW.form, cityId: 'bacau', projectId: 'harta-bacau' } });
        expect(root.textContent).toContain(t('start.plan.cityIdHelp', { cityId: 'bacau' }));
        expect(root.textContent).toContain(t('start.plan.projectIdHelp', { projectId: 'harta-bacau' }));
    });

    it('happyPath_theDoneScreenLinksTheAdmin', async () => {
        const { root } = await rendered({ screen: 'done' });
        expect(root.querySelector('[data-open-admin]')?.getAttribute('href')).toBe('https://fostul-bacau.web.app/admin/');
        expect(root.textContent).toContain(t('start.done.next', { city: 'Bacău' }));
    });

    it('edge_noPortRendersNothingAndAMovedPageFollowsItsPort', async () => {
        defineHcmStartPage();
        const page = document.createElement(HCM_START_PAGE_TAG) as HcmStartPage;
        document.body.append(page);
        await page.updateComplete;
        expect(page.shadowRoot?.querySelector('main')).toBeNull();
        page.remove();
        expect(page.isConnected).toBe(false);
    });
});

describe('the imagery census on the plan (M29)', () => {
    it('is left out without a census, waits for the rectangle, then searches the rectangle', async () => {
        expect((await rendered({ screen: 'plan' })).root.querySelector('hcm-imagery-census')).toBeNull();
        document.body.replaceChildren();
        let box: readonly [number, number, number, number] | null = null;
        const { root, change } = await rendered({ screen: 'plan' }, {}, { censusBox: () => box });
        const census = root.querySelector('hcm-imagery-census') as
            | (Element & { box: readonly [number, number, number, number] | null; locale: string })
            | null;
        expect(census?.box).toBeNull();
        box = [26.85, 46.53, 26.97, 46.6];
        await change({});
        expect(census?.box).toEqual(box);
        expect(census?.locale).toBe('en');
    });
});
