import type { Page } from '@playwright/test';
import { VIEWER_LOCALES, type ViewerLocale } from '@hcm/shared';
import { VIEWER_CATALOGUES } from '@hcm/shared/viewer-catalogues';

/**
 * The i18n leak check of the tour (docs/research/design-review-testability.md §4.3): no raw message id on the page, and
 * in a page of one language no text that only another language's catalogue has (an English word in a Romanian page, a
 * Romanian one in a German page). The keys and texts are the viewer's catalogues (`VIEWER_CATALOGUES`, the files the
 * engine fetches: the main family and the map labels'); a text with a placeholder is never compared.
 */

/** Every message key of the viewer. */
const MESSAGE_KEYS: ReadonlySet<string> = new Set(Object.keys(VIEWER_CATALOGUES.ro));

function placeholderFree(locale: ViewerLocale): string[] {
    return Object.values(VIEWER_CATALOGUES[locale]).filter((text) => !text.includes('{'));
}

/**
 * The texts of the other languages that `lang`'s catalogue does not have: shown in a page of `lang`, they leaked. A key a
 * language being translated lacks shows in English by design (docs/I18N.md → Fallback): that English text is its own.
 */
function foreignTexts(lang: ViewerLocale): ReadonlySet<string> {
    const own = new Set(Object.values({ ...VIEWER_CATALOGUES.en, ...VIEWER_CATALOGUES[lang] }));
    const others = VIEWER_LOCALES.filter((locale) => locale !== lang).flatMap(placeholderFree);
    return new Set(others.filter((text) => !own.has(text)));
}

/**
 * Runs in the page: every visible text node and accessible name, open shadow roots included; with `lang`, none inside an
 * element marked as another language (through shadow hosts, as `lang` is inherited) (a city's English text in a German page names its `lang`: it is no leak).
 */
function textsInPage(lang: string | null): string[] {
    const texts: string[] = [];
    // The language an element inherits in the composed tree, as the browser and a screen reader read it: `lang` reaches
    // into a shadow root from its host (an admin page inside the shell's `lang="en"` area is English).
    const markedOf = (element: Element): string | null => {
        let at: Element | null = element;
        while (at !== null) {
            const marked = at.closest('[lang]');
            if (marked !== null) {
                return marked.getAttribute('lang');
            }
            const root = at.getRootNode();
            at = root instanceof ShadowRoot ? root.host : null;
        }
        return null;
    };
    const visit = (root: Document | ShadowRoot): void => {
        for (const element of Array.from(root.querySelectorAll('*'))) {
            const marked = markedOf(element) ?? lang;
            const visible = element.checkVisibility() && (lang === null || marked === lang);
            for (const node of Array.from(element.childNodes)) {
                if (visible && node.nodeType === Node.TEXT_NODE) {
                    texts.push((node.textContent ?? '').trim());
                }
            }
            if (visible) {
                texts.push(element.getAttribute('aria-label') ?? '', element.getAttribute('aria-valuetext') ?? '');
            }
            if (element.shadowRoot !== null) {
                visit(element.shadowRoot);
            }
        }
    };
    visit(document);
    return texts.filter((text) => text !== '');
}

/** The visible texts and accessible names of `page` (with `lang`, those of that language only). */
export async function pageTexts(page: Page, lang: ViewerLocale | null = null): Promise<string[]> {
    return page.evaluate(textsInPage, lang);
}

/** What leaked on `page`: raw message keys, and the texts only another language's catalogue has. */
export async function i18nLeaks(page: Page, lang: ViewerLocale): Promise<string[]> {
    const foreign = foreignTexts(lang);
    const texts = await pageTexts(page, lang);
    return texts.filter((text) => MESSAGE_KEYS.has(text) || foreign.has(text));
}
