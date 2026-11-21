import type { ThemeTokens } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { THEME_ATTRIBUTE, applyTheme, clearTheme, themeRules, writeThemeSheet } from '../../src/theme/apply.js';
import { BASELINE_THEME } from '../../src/theme/baseline.js';
import { REDUCED_MOTION_TOKENS } from '../../src/theme/system.js';

const PRIMARY = '--md-sys-color-primary';

function tokens(): ThemeTokens {
    const scheme = (value: string): Record<string, string> => ({ [PRIMARY]: value });
    return { light: scheme('#000001'), dark: scheme('#000002'), highContrastLight: scheme('#000003'), highContrastDark: scheme('#000004') };
}

function primaryOf(element: Element): string {
    return getComputedStyle(element).getPropertyValue(PRIMARY).trim();
}

class ThemedHost extends LitElement {
    override render(): TemplateResult {
        return html`<span>themed</span>`;
    }
}
customElements.define('hcm-test-themed-host', ThemedHost);

const created: HTMLElement[] = [];

function element(tag = 'div'): HTMLElement {
    const node = document.createElement(tag);
    document.body.append(node);
    created.push(node);
    return node;
}

describe('themeRules', () => {
    it('happyPath_systemFollowsColourSchemeAndContrastPreferences', () => {
        const rules = themeRules(tokens(), 'system', false);

        expect(rules.map((rule) => rule.media)).toEqual([
            null,
            '(prefers-color-scheme: dark)',
            '(prefers-contrast: more)',
            '(prefers-color-scheme: dark) and (prefers-contrast: more)',
            '(prefers-reduced-motion: reduce)',
        ]);
        expect(rules.map((rule) => rule.declarations[PRIMARY])).toEqual(['#000001', '#000002', '#000003', '#000004', undefined]);
        expect(rules[0]?.declarations['color-scheme']).toBe('light dark');
        expect(rules[4]?.declarations).toBe(REDUCED_MOTION_TOKENS);
    });

    it('happyPath_aFixedModeStillFollowsPrefersContrast', () => {
        const rules = themeRules(tokens(), 'dark', false);

        expect(rules.map((rule) => [rule.media, rule.declarations[PRIMARY]])).toEqual([
            [null, '#000002'],
            ['(prefers-contrast: more)', '#000004'],
            ['(prefers-reduced-motion: reduce)', undefined],
        ]);
        expect(rules[0]?.declarations['color-scheme']).toBe('only dark');
    });

    it('badPath_aChosenLightSchemeIsOnlyLightSoChromesDarkThemeForSitesLeavesItAlone', () => {
        expect(themeRules(tokens(), 'light', false)[0]?.declarations['color-scheme']).toBe('only light');
        expect(themeRules(tokens(), 'light', true)[0]?.declarations['color-scheme']).toBe('only light');
    });

    it('happyPath_forcedHighContrastNeedsNoContrastQuery', () => {
        expect(themeRules(tokens(), 'light', true).map((rule) => [rule.media, rule.declarations[PRIMARY]])).toEqual([
            [null, '#000003'],
            ['(prefers-reduced-motion: reduce)', undefined],
        ]);
        expect(themeRules(tokens(), 'system', true).map((rule) => rule.declarations[PRIMARY])).toEqual(['#000003', '#000004', undefined]);
    });
});

describe('applyTheme', () => {
    afterEach(() => {
        for (const node of created.splice(0)) {
            clearTheme(node);
        }
        document.body.replaceChildren();
    });

    it('happyPath_aLightDomTargetGetsItsTokensThroughTheDocument', () => {
        const target = element();
        const child = target.appendChild(document.createElement('span'));

        applyTheme(target, tokens(), 'light', false);

        expect(target.getAttribute(THEME_ATTRIBUTE)).toMatch(/^\d+$/);
        expect(primaryOf(child)).toBe('#000001');
        expect(getComputedStyle(target).getPropertyValue('--md-sys-shape-corner-full').trim()).toBe('9999px');
        expect(getComputedStyle(target).colorScheme).toBe('light only');
    });

    it('happyPath_aShadowHostIsThemedThroughHost', async () => {
        const host = element('hcm-test-themed-host') as ThemedHost;
        await host.updateComplete;

        applyTheme(host, tokens(), 'dark', false);

        expect(host.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
        expect(primaryOf(host)).toBe('#000002');
        expect(host.shadowRoot?.adoptedStyleSheets).toHaveLength(1);
    });

    it('happyPath_applyingAgainReplacesTheThemeInPlace', () => {
        const target = element();
        applyTheme(target, tokens(), 'light', false);
        const sheets = document.adoptedStyleSheets.length;

        applyTheme(target, BASELINE_THEME, 'light', true);

        expect(document.adoptedStyleSheets).toHaveLength(sheets);
        expect(primaryOf(target)).toBe(BASELINE_THEME.highContrastLight[PRIMARY]);
    });

    it('happyPath_clearThemeRemovesTheSheetAndTheAttribute', () => {
        const target = element();
        applyTheme(target, tokens(), 'light', false);

        clearTheme(target);
        clearTheme(target);

        expect(target.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
        expect(primaryOf(target)).toBe('');
    });

    it('badPath_aHostileTokenValueCannotEscapeItsDeclaration', () => {
        const sheet = new CSSStyleSheet();

        writeThemeSheet(sheet, ':host', [
            { media: null, declarations: { [PRIMARY]: 'red} :host{display:none', '--md-sys-color-secondary': '#123456' } },
        ]);

        expect(sheet.cssRules).toHaveLength(1);
        expect(sheet.cssRules[0]?.cssText).not.toContain('display: none');
        expect(sheet.cssRules[0]?.cssText).toContain('--md-sys-color-secondary: #123456');
    });

    it('badPath_aSelectorThatIsNotAStyleRuleGetsNoDeclarations', () => {
        const sheet = new CSSStyleSheet();

        writeThemeSheet(sheet, '@font-face', [{ media: null, declarations: { [PRIMARY]: '#000001' } }]);

        expect(sheet.cssRules).toHaveLength(1);
        expect(sheet.cssRules[0]?.cssText).not.toContain(PRIMARY);
    });
});
