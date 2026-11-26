/**
 * Settings → Place categories, **Add the starter categories** (finding 41 of 2026-11-01): the starters the city lacks
 * in one click, off with the reason in a note below when every one is there. A module of its own: the bundle's
 * `starter-categories` chunk holds it with the starters' data and writes, which the place editor shares
 * (`packages/admin/vite.config.ts`, DECISIONS-for-review.md §78d).
 */
import { html, nothing, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { SectionContext } from './section-parts.js';

/** The button: off for a read-only admin, while the starters are written, and when every one is there. */
export function startersButton(context: SectionContext, present: boolean): TemplateResult {
    const { locale, view, intents } = context;
    return html`<hcm-button
        variant="outlined"
        icon="checklist"
        class="add-starters"
        ?disabled=${context.readOnly || present || view.addingStarters}
        @click=${() => {
            void intents?.addStarterCategories();
        }}
        >${contentText(locale, 'adminContent.settings.addStarters')}</hcm-button
    >`;
}

/** Why the button is off when every starter category is there; nothing otherwise. */
export function startersReason(context: SectionContext, present: boolean): TemplateResult | typeof nothing {
    return present
        ? html`<p class="note starters-present">${contentText(context.locale, 'adminContent.settings.startersPresent')}</p>`
        : nothing;
}
