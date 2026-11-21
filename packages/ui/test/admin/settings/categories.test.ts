import { translateAdminContent } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { HcmIconPicker } from '../../../src/admin/settings/hcm-icon-picker.js';
import type { CategoryEditorPort, SettingsIntentsPort, SettingsViewState } from '../../../src/admin/settings/settings-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { page, settingsState } from '../layers/fixtures.js';
import { nth } from '../ops/fixtures.js';
import { cleanup, deep, deepAll, deepText, defineAll, mount, updated } from '../shell/fake-app.js';

function area(state: SettingsViewState): FakeArea<SettingsViewState, SettingsIntentsPort> {
    return new FakeArea<SettingsViewState, SettingsIntentsPort>(state, {
        saveCategory: Promise.resolve('scoli'),
        confirmDeleteCategory: Promise.resolve(true),
        askDeleteCategory: Promise.resolve(),
        moveCategory: Promise.resolve(null),
        moveCategoryTo: Promise.resolve(null),
        addStarterCategories: Promise.resolve({ ok: true }),
    });
}

function calls(store: FakeArea<SettingsViewState, SettingsIntentsPort>): readonly string[] {
    return store.calls.filter((call) => !call.startsWith('open ['));
}

function editor(overrides: Partial<CategoryEditorPort> = {}): CategoryEditorPort {
    return {
        id: 'cladiri',
        isNew: false,
        notFound: false,
        value: { label: { ro: 'Clădiri', en: 'Buildings' }, icon: 'domain', color: '#8b5e3c', defaultOpacity: 0.7, order: 0 },
        dirty: false,
        issues: [],
        saving: false,
        conflict: null,
        gone: false,
        proposedColor: null,
        ...overrides,
    };
}

function categoriesState(overrides: Partial<SettingsViewState> = {}): SettingsViewState {
    return { ...settingsState(), section: 'categories', ...overrides };
}

describe('<hcm-settings-page> categories', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theCategoriesInOrderWithTheirSwatchesAndAdd', async () => {
        const settings = area(categoriesState());
        const { app, element } = await page('settings', settings, { params: ['categories'] });

        expect(deepAll(element, '.reorder-row a.row').map((row) => row.getAttribute('href'))).toEqual([
            '#/settings/categories/cladiri',
            '#/settings/categories/biserici',
        ]);
        expect(deep(element, '.swatch').style.getPropertyValue('--swatch')).toBe('#8b5e3c');
        // The swatch leads both lines of its row (M3 list item), never inline in the name (the review screenshots).
        const first = nth(deepAll(element, '.reorder-row'), 0);
        const rects = ['.swatch', '.row-title', '.row-detail'].map((part) => deep(first, part).getBoundingClientRect());
        const [swatch, title, detail] = [nth(rects, 0), nth(rects, 1), nth(rects, 2)];
        const middle = (swatch.top + swatch.bottom) / 2;
        expect(swatch.right).toBeLessThan(title.left);
        expect(title.left).toBe(detail.left);
        expect([middle > title.top, middle < detail.bottom]).toEqual([true, true]);
        nth(deepAll(nth(deepAll(element, '.reorder-row'), 1), 'hcm-icon-button'), 0).click();
        deep(deep(deep(element, '.pane > .actions'), 'hcm-button'), 'button').click();

        expect(calls(settings)).toEqual(['moveCategory "biserici" "up"']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"settings","params":["categories","_new"]}']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_atTheLimitAddIsReplacedByTheLimit', async () => {
        const { element } = await page('settings', area(categoriesState({ canAddCategory: false })), {
            params: ['categories'],
            locale: 'ro',
        });
        expect(deepText(element)).toContain('Ai atins limita de 50 categorii.');
    });

    it('happyPath_oneClickAddsTheStarterCategoriesTheCityLacks', async () => {
        const settings = area(categoriesState({ startersMissing: 3 }));
        const { element } = await page('settings', settings, { params: ['categories'] });
        const starters = deep(element, 'hcm-button.add-starters');

        expect(starters.textContent.trim()).toBe('Add the starter categories');
        expect((starters as HTMLElement & { disabled: boolean }).disabled).toBe(false);
        expect(deepAll(element, '.starters-present')).toEqual([]);
        deep(starters, 'button').click();

        expect(calls(settings)).toEqual(['addStarterCategories']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_everyStarterIsHereSoTheActionIsOffWithTheReason', async () => {
        const off = (target: HTMLElement): boolean => (target as HTMLElement & { disabled: boolean }).disabled;
        const settings = area(categoriesState({ startersMissing: 0 }));
        const { element } = await page('settings', settings, { params: ['categories'], locale: 'ro' });

        expect(off(deep(element, 'hcm-button.add-starters'))).toBe(true);
        expect(deep(element, '.starters-present').textContent).toBe('Toate categoriile de pornire sunt deja aici.');
        deep(deep(element, 'hcm-button.add-starters'), 'button').click();
        expect(calls(settings)).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);

        settings.set({ startersMissing: 2, addingStarters: true });
        await updated(element);
        expect(off(deep(element, 'hcm-button.add-starters'))).toBe(true);
        expect(deepAll(element, '.starters-present')).toEqual([]);
    });

    it('badPath_aRevokedAdminCannotAddTheStarters', async () => {
        const { element } = await page('settings', area(categoriesState()), { params: ['categories'], revoked: true });

        expect((deep(element, 'hcm-button.add-starters') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('happyPath_theEditorsNamesIconColourAndOpacity', async () => {
        const settings = area(categoriesState({ category: editor({ dirty: true }) }));
        const { element } = await page('settings', settings, { params: ['categories', 'cladiri'] });

        await userEvent.type(deep(element, '#category-label-en'), 's');
        const picker = deep(element, 'hcm-icon-picker');
        deep(picker, '[data-icon="church"]').click();
        await userEvent.type(deep(element, '#category-color'), '0');
        const slider = deep(element, 'hcm-slider');
        slider.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 30 }, bubbles: true, composed: true }));
        deep(nth(deepAll(element, '.save-bar hcm-button'), 1), 'button').click();
        deep(nth(deepAll(element, '.save-bar hcm-button'), 0), 'button').click();
        await updated(element);

        expect(calls(settings)).toEqual([
            'setCategoryLabel "en" "Buildingss"',
            'editCategory {"icon":"church"}',
            'editCategory {"color":"#8b5e3c0"}',
            'setCategoryOpacity 30',
            'saveCategory',
            'discardCategory',
        ]);
        expect(deep(element, '.visually-hidden[role="status"]').textContent).toBe('Buildings: 30 %');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aNewCategoryOpensUnderItsIdOnceSaved', async () => {
        const settings = area(categoriesState({ category: editor({ id: '_new', isNew: true, dirty: true }) }));
        const { app, element } = await page('settings', settings, { params: ['categories', '_new'] });

        expect(deep(element, 'h2[data-detail-heading]').textContent).toBe('New category');
        expect(deepText(element)).not.toContain('Delete the category');
        deep(nth(deepAll(element, '.save-bar hcm-button'), 1), 'button').click();
        await updated(element);
        await updated(element);

        expect(app.named('navigate')).toEqual(['navigate {"id":"settings","params":["categories","scoli"]}']);
    });

    it('badPath_anUnreadableColourProposesATone', async () => {
        const settings = area(
            categoriesState({
                category: editor({
                    proposedColor: '#7a5c00',
                    value: { label: { ro: 'Clădiri' }, icon: 'domain', color: '#ffe082', defaultOpacity: 0.7, order: 0 },
                }),
            }),
        );
        const { element } = await page('settings', settings, { params: ['categories', 'cladiri'] });

        expect(deepText(element)).toContain('The white icon does not read on this colour.');
        deep(deep(deep(element, '.alert'), 'hcm-button'), 'button').click();
        expect(calls(settings)).toEqual(['useProposedColor']);
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-settings-page> category states', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_aConflictNotFoundAndLoading', async () => {
        const conflict = { by: 'x', at: 'y', fields: ['color'] };
        const settings = area(categoriesState({ category: editor({ conflict }) }));
        const { element } = await page('settings', settings, { params: ['categories', 'cladiri'] });
        for (const button of deepAll(deep(element, '.alert'), 'hcm-button')) {
            deep(button, 'button').click();
        }
        expect(calls(settings)).toEqual(['keepMine', 'takeTheirs']);

        settings.set({ category: editor({ notFound: true }) });
        await updated(element);
        expect(deep(element, '[slot="detail"] h2').textContent).toBe('This category does not exist.');
        settings.set({ category: editor({ value: null }) });
        await updated(element);
        expect(deep(element, '[slot="detail"] h2').textContent).toBe('Place categories');
        deep(element, 'hcm-list-detail').dispatchEvent(new CustomEvent('hcm-back'));
    });

    it('badPath_aRevokedAdminsCategoryIsReadOnly', async () => {
        const off = (target: HTMLElement): boolean => (target as HTMLElement & { disabled: boolean }).disabled;
        const settings = area(categoriesState({ category: editor({ dirty: true, proposedColor: '#5a3e2b' }) }));
        const { element } = await page('settings', settings, { params: ['categories', 'cladiri'], revoked: true });
        const detail = deep(element, '[slot="detail"]');

        expect(deepAll(detail, '.save-bar hcm-button').map(off)).toEqual([true, true]);
        expect(deepAll(detail, 'input:not([type="color"])').every((field) => (field as HTMLInputElement).readOnly)).toBe(true);
        expect(deepAll(detail, 'input[type="color"], hcm-slider, hcm-icon-picker, .alert hcm-button, .actions hcm-button').every(off)).toBe(
            true,
        );
        expect(deepAll(deep(detail, 'hcm-icon-picker'), '[role="radio"]').every((radio) => (radio as HTMLButtonElement).disabled)).toBe(
            true,
        );

        settings.set({ category: null });
        await updated(element);
        expect(off(deep(deep(element, '[slot="detail"] .actions'), 'hcm-button'))).toBe(true);
        expect(deepAll(element, '.reorder-row .moves')).toEqual([]);
    });

    it('happyPath_deletingACategoryInUseAsksWhereItsPlacesGo', async () => {
        const deletion = { phase: 'confirm', id: 'cladiri', label: 'Clădiri', inUse: 3, target: null } as const;
        const settings = area(categoriesState({ category: editor(), categoryDeletion: deletion }));
        const { app, element } = await page('settings', settings, { params: ['categories', 'cladiri'] });

        expect(deepText(element)).toContain('Places use it: 3.');
        expect((deep(element, 'hcm-dialog') as HTMLElement & { headline: string }).headline).toBe('Delete the category “Buildings”?');
        const select = deep(element, '#delete-target') as HTMLSelectElement;
        expect([...select.options].map((option) => option.value)).toEqual(['', 'biserici']);
        select.value = 'biserici';
        select.dispatchEvent(new Event('change'));
        select.value = '';
        select.dispatchEvent(new Event('change'));
        const confirm = (): HTMLButtonElement => deep(deep(element, 'hcm-dialog > hcm-button.confirm'), 'button') as HTMLButtonElement;
        expect(confirm().disabled).toBe(true);
        settings.set({ categoryDeletion: { ...deletion, target: 'biserici' } });
        await updated(element);
        expect(confirm().disabled).toBe(false);
        confirm().click();
        await updated(element);
        await updated(element);
        deep(deep(element, 'hcm-dialog > hcm-button'), 'button').click();
        deep(element, 'hcm-dialog').dispatchEvent(new CustomEvent('hcm-close', { detail: { returnValue: 'scrim' } }));
        deep(deep(deep(element, '.pane > .actions:last-of-type'), 'hcm-button'), 'button').click();

        expect(calls(settings)).toEqual([
            'setDeleteTarget "biserici"',
            'setDeleteTarget null',
            'confirmDeleteCategory',
            'cancelDeleteCategory',
            'cancelDeleteCategory',
            'askDeleteCategory',
        ]);
        expect(app.named('navigate')).toEqual(['navigate {"id":"settings","params":["categories"]}']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aCategoryNotInUseOrNotCountedAsksOnlyForTheConfirmation', async () => {
        const deletion = { phase: 'confirm', id: 'cladiri', label: 'Clădiri', inUse: 0, target: null } as const;
        const settings = area(categoriesState({ category: editor(), categoryDeletion: deletion }));
        const { element } = await page('settings', settings, { params: ['categories', 'cladiri'] });
        expect(deepAll(element, '#delete-target')).toHaveLength(0);
        settings.set({ categoryDeletion: { ...deletion, id: 'unlisted', inUse: null } });
        await updated(element);
        expect(deepAll(element, '#delete-target')).toHaveLength(1);
        expect((deep(element, 'hcm-dialog') as HTMLElement & { headline: string }).headline).toBe('Delete the category “Clădiri”?');
    });
});

describe('<hcm-settings-page> category list edges', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_anUnbundledIconIsDrawnAsThePinAndTheListsMoreAndTryAgain', async () => {
        const base = categoriesState();
        const items = [{ ...nth(base.categories.items, 0), icon: 'rocket', bundled: false }];
        const settings = area({ ...base, categories: { ...base.categories, items, hasMore: true } });
        const { element } = await page('settings', settings, { params: ['categories'] });

        expect(deep(element, '.swatch hcm-icon').getAttribute('name')).toBe('location_on');
        deep(deep(element, '.more'), 'button').click();
        settings.set({ categories: { ...base.categories, status: 'error', failure: { kind: 'failed', code: 'x' } } });
        await updated(element);
        deep(deep(element, '[slot="detail"] .pane .pane'), 'hcm-button').click();
        expect(calls(settings)).toEqual(['retry']);
    });

    it('happyPath_theColourPickerSetsTheColour', async () => {
        const settings = area(categoriesState({ category: editor() }));
        const { element } = await page('settings', settings, { params: ['categories', 'cladiri'] });
        const picker = deep(element, '#category-color-picker') as HTMLInputElement;

        picker.value = '#123456';
        picker.dispatchEvent(new Event('input'));

        expect(calls(settings)).toEqual(['editCategory {"color":"#123456"}']);
    });
});

describe('<hcm-icon-picker>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    const LABELS = Object.fromEntries(
        ['domain', 'church', 'account_balance', 'water', 'add_road'].map((icon) => [
            icon,
            translateAdminContent('en', `adminContent.settings.icon.${icon}` as never),
        ]),
    );

    it('happyPath_oneTabStopAndTheArrowKeysChoose', async () => {
        const picker = await mount<HcmIconPicker>(
            html`<hcm-icon-picker value="domain" label="Icon" .labels=${LABELS}></hcm-icon-picker>`,
            400,
        );
        const changes: string[] = [];
        picker.addEventListener('hcm-change', (event) => changes.push((event as CustomEvent<{ value: string }>).detail.value));

        const radios = deepAll(picker, '[role="radio"]');
        expect(radios.filter((radio) => radio.tabIndex === 0).map((radio) => radio.dataset['icon'])).toEqual(['domain']);
        deep(picker, '[data-icon="domain"]').focus();
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.keyboard('{ArrowLeft}');
        await userEvent.keyboard('{End}');
        await userEvent.keyboard('{Home}');
        await userEvent.keyboard('{ArrowDown}');
        await userEvent.keyboard('{ArrowUp}');
        await userEvent.keyboard('a');

        expect(changes).toEqual(['domain_disabled', 'domain', 'water', 'account_balance', expect.any(String), 'account_balance']);
        expect(await axeViolations(picker)).toEqual([]);
    });

    it('badPath_aDisabledPickerChoosesNothing', async () => {
        const picker = await mount<HcmIconPicker>(html`<hcm-icon-picker disabled value="church" .labels=${{}}></hcm-icon-picker>`);
        const changes: string[] = [];
        picker.addEventListener('hcm-change', () => changes.push('change'));

        nth(deepAll(picker, '[role="radio"]'), 0).click();

        expect(changes).toEqual([]);
        expect(picker.value).toBe('church');
    });

    it('badPath_anIconOutsideTheBundleStaysAndIsExplained', async () => {
        const picker = await mount<HcmIconPicker>(
            html`<hcm-icon-picker value="rocket" label="Icon" unbundled-text="Drawn as the pin"></hcm-icon-picker>`,
            400,
        );

        expect(deepAll(picker, '[aria-checked="true"]')).toHaveLength(0);
        expect(nth(deepAll(picker, '[role="radio"]'), 0).tabIndex).toBe(0);
        expect(deepText(picker)).toContain('Drawn as the pin');
        deep(picker, '[data-icon="rocket"], [data-icon="account_balance"]').click();
        deep(picker, '[data-icon="account_balance"]').click();
        expect(picker.value).toBe('account_balance');
    });
});

describe('<hcm-settings-page> a category in the Layers panel (M27)', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_hiddenAtStartPinnedAndCreditedForTheDisappearedStreets @S-A155-HAPPY-DISPLAY', async () => {
        const settings = area(categoriesState({ category: editor({ dirty: true }) }));
        const { element } = await page('settings', settings, { params: ['categories', 'cladiri'] });
        const [shown, pinned] = deepAll(element, '.switch-row hcm-switch');

        expect((shown as HTMLElement & { checked: boolean }).checked).toBe(true);
        expect((pinned as HTMLElement & { checked: boolean }).checked).toBe(false);
        for (const [toggle, checked] of [
            [shown, false],
            [pinned, true],
        ] as const) {
            toggle?.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked }, bubbles: true, composed: true }));
        }
        await userEvent.type(deep(element, '#category-attribution'), 'OSM');
        await updated(element);

        expect(calls(settings).slice(0, 2)).toEqual(['editCategory {"defaultVisible":false}', 'editCategory {"pinned":true}']);
        expect(calls(settings).at(-1)).toMatch(/^editCategory \{"attribution":"\S+"\}$/u);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anEmptiedCreditIsRemovedNotSavedBlank @S-A155-BAD-BLANK-CREDIT', async () => {
        const value = { ...editor().value, defaultVisible: false, pinned: true, attribution: ' ' } as CategoryEditorPort['value'];
        const settings = area(categoriesState({ category: editor({ value, dirty: true }) }));
        const { element } = await page('settings', settings, { params: ['categories', 'cladiri'] });
        const input = deep(element, '#category-attribution') as HTMLInputElement;

        await userEvent.clear(input);
        await updated(element);

        expect(calls(settings).at(-1)).toBe('editCategory {}');
        expect(deepText(element)).toContain(translateAdminContent('en', 'adminContent.settings.categoryPinned'));
    });
});
