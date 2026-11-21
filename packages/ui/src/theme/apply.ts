/**
 * Applies a city theme to a host element: the scheme's `--md-sys-color-*` tokens plus the system tokens
 * (`system.ts`) as custom properties that every kit element inside inherits. The rules go into one constructable
 * stylesheet per target (adopted by its shadow root, or by the document for a light-DOM target), built through the
 * CSSOM, so a token value can never break out of its declaration and no inline `<style>` is needed (strict CSP).
 */
import type { ThemeTokens } from '@hcm/shared';

import { REDUCED_MOTION_TOKENS, SYSTEM_TOKENS, type TokenMap } from './system.js';

export type ThemeMode = 'light' | 'dark' | 'system';

/** One rule of the theme sheet: its declarations, under a media query or none. */
export interface ThemeRule {
    readonly media: string | null;
    readonly declarations: TokenMap;
}

const DARK = '(prefers-color-scheme: dark)';
const MORE_CONTRAST = '(prefers-contrast: more)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * The `color-scheme` of each mode. A chosen light or dark scheme is `only`: Chrome's dark theme for sites (Android, when
 * the system is dark) repaints every element whose used scheme is light, inverting its dark text to a light tone while it
 * keeps a tinted background such as the primary container. The light theme's FAB and menu items read #33406D on #BAC7FD
 * in every style the page can query, yet were painted pale lilac on lilac (the Pixel 9 Pro review, P2); `only light` tells
 * the browser the page owns its colours. `system` declares both schemes and so is painted dark by the page itself.
 */
const COLOR_SCHEMES: Readonly<Record<ThemeMode, string>> = { light: 'only light', dark: 'only dark', system: 'light dark' };

/** The data attribute that names a light-DOM target in the document-level sheet. */
export const THEME_ATTRIBUTE = 'data-hcm-theme';

interface Applied {
    readonly sheet: CSSStyleSheet;
    readonly container: DocumentOrShadowRoot;
    readonly selector: string;
}

const applied = new WeakMap<HTMLElement, Applied>();
let nextThemeId = 1;

function scheme(tokens: ThemeTokens, dark: boolean, highContrast: boolean): TokenMap {
    if (highContrast) {
        return dark ? tokens.highContrastDark : tokens.highContrastLight;
    }
    return dark ? tokens.dark : tokens.light;
}

/**
 * The rules of a theme, in cascade order (a later rule wins). `system` follows `prefers-color-scheme`; every mode
 * follows `prefers-contrast: more` (the high-contrast scheme of the active mode) unless `highContrast` forces it, and
 * `prefers-reduced-motion: reduce` turns the spatial springs off.
 */
export function themeRules(tokens: ThemeTokens, mode: ThemeMode, highContrast: boolean): ThemeRule[] {
    const dark = mode === 'dark';
    const colorScheme = COLOR_SCHEMES[mode];
    const base = { ...SYSTEM_TOKENS, ...scheme(tokens, dark, highContrast), 'color-scheme': colorScheme };
    const systemDark: ThemeRule[] = mode === 'system' ? [{ media: DARK, declarations: scheme(tokens, true, highContrast) }] : [];
    return [
        { media: null, declarations: base },
        ...systemDark,
        ...(highContrast ? [] : contrastRules(tokens, mode)),
        { media: REDUCED_MOTION, declarations: REDUCED_MOTION_TOKENS },
    ];
}

/** `prefers-contrast: more` switches to the high-contrast scheme of the active mode (both modes under `system`). */
function contrastRules(tokens: ThemeTokens, mode: ThemeMode): ThemeRule[] {
    const rules: ThemeRule[] = [{ media: MORE_CONTRAST, declarations: scheme(tokens, mode === 'dark', true) }];
    if (mode === 'system') {
        rules.push({ media: `${DARK} and ${MORE_CONTRAST}`, declarations: scheme(tokens, true, true) });
    }
    return rules;
}

/** The declarations of a style rule, or of the style rule inside a media rule; null for any other rule. */
function styleOf(rule: CSSRule | undefined): CSSStyleDeclaration | null {
    const inner = rule instanceof CSSMediaRule ? rule.cssRules[0] : rule;
    return inner instanceof CSSStyleRule ? inner.style : null;
}

/** Rewrites `sheet` with `rules` for `selector`; values are set through the CSSOM, never parsed as CSS text. */
export function writeThemeSheet(sheet: CSSStyleSheet, selector: string, rules: readonly ThemeRule[]): void {
    sheet.replaceSync('');
    for (const rule of rules) {
        const text = rule.media === null ? `${selector} {}` : `@media ${rule.media} { ${selector} {} }`;
        const style = styleOf(sheet.cssRules[sheet.insertRule(text, sheet.cssRules.length)]);
        for (const [name, value] of Object.entries(rule.declarations)) {
            style?.setProperty(name, value);
        }
    }
}

/** A shadow host is themed through `:host` in its own root; a light-DOM element through a data attribute. */
function selectorFor(target: HTMLElement): string {
    if (target.shadowRoot !== null) {
        return ':host';
    }
    const id = String(nextThemeId++);
    target.setAttribute(THEME_ATTRIBUTE, id);
    return `[${THEME_ATTRIBUTE}="${id}"]`;
}

function adoptedFor(target: HTMLElement): Applied {
    const existing = applied.get(target);
    if (existing !== undefined) {
        return existing;
    }
    const container: DocumentOrShadowRoot = target.shadowRoot ?? target.ownerDocument;
    const sheet = new CSSStyleSheet();
    container.adoptedStyleSheets = [...container.adoptedStyleSheets, sheet];
    const entry = { sheet, container, selector: selectorFor(target) };
    applied.set(target, entry);
    return entry;
}

/**
 * Sets the theme of `target` (call it after the element is connected, so a Lit host already has its shadow root).
 * Calling it again replaces the previous theme of the same target in place.
 */
export function applyTheme(target: HTMLElement, tokens: ThemeTokens, mode: ThemeMode, highContrast: boolean): void {
    const { sheet, selector } = adoptedFor(target);
    writeThemeSheet(sheet, selector, themeRules(tokens, mode, highContrast));
}

/** Removes the theme `applyTheme` set on `target`; a target without one is left alone. */
export function clearTheme(target: HTMLElement): void {
    const entry = applied.get(target);
    if (entry !== undefined) {
        entry.container.adoptedStyleSheets = entry.container.adoptedStyleSheets.filter((sheet) => sheet !== entry.sheet);
        applied.delete(target);
    }
    target.removeAttribute(THEME_ATTRIBUTE);
}
