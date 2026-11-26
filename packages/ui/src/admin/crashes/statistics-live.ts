/**
 * The Statistics view's live sections (§203): Google Analytics' numbers (`statistics-numbers.ts`) and the period's error
 * groups (`statistics-crashes.ts`), a chunk of its own that `statistics-view.ts` loads the first time the view shows, so
 * the crashes page stays within its budget.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { CrashesViewState } from './crashes-port.js';
import { crashesSection } from './statistics-crashes.js';
import { statisticsLiveStyles } from './statistics-live-styles.js';
import { numbersSection, type NumbersContext } from './statistics-numbers.js';

/** What the sections need beyond the page's state: the project, the intents and the view's names of wizards and steps. */
export type LiveContext = Omit<NumbersContext, 'locale' | 'state'> & { readonly groupUrl: (groupId: string) => string };

/** The live sections' styles, which the crashes page adopts once this chunk is there. */
export const liveStyles = statisticsLiveStyles;

export function liveSections(locale: UiLocale, view: CrashesViewState, context: LiveContext): TemplateResult {
    const numbers = numbersSection({ ...context, locale, state: view.statistics });
    return html`${numbers} ${crashesSection(locale, view, context.intents, context.groupUrl)}`;
}
