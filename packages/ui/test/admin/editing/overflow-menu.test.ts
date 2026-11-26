import { axeViolations } from '@hcm/test-support/axe';
import { html, render } from 'lit';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineEditingElements } from '../../../src/admin/editing/define.js';
import { fieldName, fieldNames } from '../../../src/admin/editing/field-names.js';
import type { HcmOverflowMenu, OverflowAction } from '../../../src/admin/editing/hcm-overflow-menu.js';
import { deepActiveElement } from '../../../src/components/focus.js';
import { applyTheme } from '../../../src/theme/apply.js';
import { BASELINE_THEME } from '../../../src/theme/baseline.js';

const ACTIONS: readonly OverflowAction[] = [
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'redraw-point', label: 'Redraw as point', icon: 'place' },
    { id: 'redraw-area', label: 'Redraw as area', icon: 'pentagon', disabled: true },
];

async function settle(element: Element): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await (element as Partial<{ updateComplete: Promise<unknown> }>).updateComplete;
    }
}

async function menu(actions: readonly OverflowAction[] = ACTIONS): Promise<HcmOverflowMenu> {
    const host = document.createElement('div');
    document.body.append(host);
    applyTheme(host, BASELINE_THEME, 'light', false);
    render(html`<hcm-overflow-menu label="More actions" close-label="Close" .actions=${actions}></hcm-overflow-menu>`, host);
    const element = host.firstElementChild as HcmOverflowMenu;
    await settle(element);
    return element;
}

function opener(element: HcmOverflowMenu): HTMLElement {
    const button = element.shadowRoot?.querySelector<HTMLElement>('hcm-icon-button');
    if (button === null || button === undefined) {
        throw new Error('no menu button');
    }
    return button;
}

function item(element: HcmOverflowMenu, id: string): HTMLElement & { disabled: boolean } {
    const found = element.shadowRoot?.querySelector<HTMLElement & { disabled: boolean }>(`[data-action="${id}"]`);
    if (found === null || found === undefined) {
        throw new Error(`no action ${id}`);
    }
    return found;
}

describe('<hcm-overflow-menu>', () => {
    beforeAll(() => {
        defineEditingElements();
    });
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theButtonOpensTheActionsAndAChoiceClosesThemBeforeItIsFired', async () => {
        const element = await menu();
        const chosen: string[] = [];
        element.addEventListener('hcm-action', (event) => chosen.push((event as CustomEvent<{ readonly id: string }>).detail.id));

        opener(element).click();
        await settle(element);
        const violations = await axeViolations(element);
        const labels = [...(element.shadowRoot?.querySelectorAll('hcm-button') ?? [])].map((button) => button.textContent.trim());
        expect(element.open).toBe(true);
        expect(labels).toEqual(['History', 'Redraw as point', 'Redraw as area']);
        expect(item(element, 'redraw-area').disabled).toBe(true);
        expect(violations).toEqual([]);

        item(element, 'history').click();
        await settle(element);

        expect(element.open).toBe(false);
        expect(chosen).toEqual(['history']);
    });

    it('badPath_escapeChoosesNothingAndGivesTheFocusBack', async () => {
        const element = await menu();
        const chosen: string[] = [];
        element.addEventListener('hcm-action', () => chosen.push('chosen'));
        opener(element).focus();

        opener(element).click();
        await settle(element);
        await userEvent.keyboard('{Escape}');
        await settle(element);
        const active = deepActiveElement(document);

        expect(element.open).toBe(false);
        expect(chosen).toEqual([]);
        expect(active?.closest('hcm-icon-button') ?? (active?.getRootNode() as ShadowRoot | null)?.host).toBe(opener(element));
    });

    it('badPath_withEveryActionDisabledTheButtonIsDisabled', async () => {
        const element = await menu(ACTIONS.map((action) => ({ ...action, disabled: true })));

        expect((opener(element) as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });
});

describe('fieldName', () => {
    it('happyPath_aStoredFieldIsNamedAsTheFormsNameIt', () => {
        expect(fieldName('en', 'defaultVisible')).toBe('Shown at start');
        expect(fieldName('ro', 'title')).toBe('Titlul');
        expect(fieldNames('en', ['title', 'updatedAt'])).toBe('Title, Changed on');
    });

    it('badPath_aFieldTheCatalogueDoesNotKnowKeepsItsStoredName', () => {
        expect(fieldName('en', 'tilesetId')).toBe('tilesetId');
        expect(fieldNames('ro', [])).toBe('');
    });
});
