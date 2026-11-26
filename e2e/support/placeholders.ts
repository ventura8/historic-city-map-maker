import type { Page } from '@playwright/test';

/**
 * The placeholder-text guard: after every test, the visible text of the page (shadow roots included, where the Lit
 * elements render) and its accessible names must not show a value that leaked from code: `undefined`, `null`, `NaN`,
 * `[object Object]`, or an i18n placeholder that was never filled (`{count}`, `translate` leaves unknown ones visible).
 */

const PLACEHOLDER_PATTERN = /\b(?:undefined|null|NaN)\b|\[object Object\]|\{[A-Za-z]\w*\}/;

/** Runs in the page: every visible text and every accessible-name attribute, walking into open shadow roots. */
function visibleTexts(): string[] {
    const texts: string[] = [];
    const attributes = ['aria-label', 'alt', 'title', 'placeholder', 'aria-valuetext'];
    const visit = (root: Document | ShadowRoot | Element): void => {
        for (const node of Array.from(root.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE && node.parentElement?.checkVisibility() === true) {
                texts.push(node.textContent ?? '');
            }
            if (node instanceof Element) {
                texts.push(...attributes.map((name) => node.getAttribute(name) ?? ''));
                if (node.shadowRoot !== null) {
                    visit(node.shadowRoot);
                }
                visit(node);
            }
        }
    };
    visit(document);
    return texts.map((text) => text.trim()).filter((text) => text !== '');
}

/** The texts of `page` that show a leaked placeholder (empty for a closed or blank page). */
export async function leakedPlaceholders(page: Page): Promise<string[]> {
    if (page.isClosed() || page.url() === 'about:blank') {
        return [];
    }
    const texts = await page.evaluate(visibleTexts).catch(() => []);
    return texts.filter((text) => PLACEHOLDER_PATTERN.test(text));
}
