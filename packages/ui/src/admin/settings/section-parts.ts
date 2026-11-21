/**
 * What every settings section shares: its context (the language, the area's state and intents, the page's addresses
 * and its polite region) and the top of a section that edits the city (heading, save row, conflict banner).
 */
import type { CityDoc, UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { WhoPort } from '../editing/conflict.js';
import { conflictBanner, saveBar, saveStateOf } from '../layers/form-parts.js';
import { contentText } from '../shell/text.js';
import type { SettingsIntentsPort, SettingsSectionPort, SettingsViewState } from './settings-port.js';

export interface SectionContext {
    readonly locale: UiLocale;
    readonly view: SettingsViewState;
    readonly intents: SettingsIntentsPort | null;
    /** `#/settings/<params>`. */
    readonly href: (params: readonly string[]) => string;
    /** Opens `#/settings/<params>`. */
    readonly go: (params: readonly string[]) => void;
    /** Says a settled change in the page's polite region. */
    readonly announce: (text: string) => void;
    /** A revoked admin's page (`DECISIONS-for-review.md` §42d): every field read-only, every control that writes off. */
    readonly readOnly: boolean;
    /** Who reads the page and the admins' names: a conflict names who saved. */
    readonly who: WhoPort;
    /** Renders the page again (a lazy section's chunk arrived: M5's export card). */
    readonly refresh: () => void;
    /** M6: the city the page edits (its public address on the project's Hosting site), when the shell knows it. */
    readonly cityId?: string | null;
}

export const SETTINGS_SAVE_TEXTS = {
    saved: 'adminContent.settings.state.saved',
    unsaved: 'adminContent.settings.state.unsaved',
    saving: 'adminContent.settings.state.saving',
} as const;

export const SETTINGS_CONFLICT_TEXTS = {
    conflict: 'adminContent.settings.conflict',
    keepMine: 'adminContent.settings.keepMine',
    takeTheirs: 'adminContent.settings.takeTheirs',
} as const;

/** The heading, save row and conflict banner of a section that edits the city document. */
export function cityHead(context: SectionContext, title: string): TemplateResult {
    const { locale, intents } = context;
    const draft = context.view.citySection.draft;
    const state = { ...saveStateOf({ ...draft, dirty: draft.dirty.length > 0 }), readOnly: context.readOnly };
    const handlers = {
        save: () => {
            void intents?.saveSection();
        },
        discard: () => {
            intents?.discardSection();
        },
    };
    return html`<h2 tabindex="-1" data-detail-heading>${title}</h2>
        ${saveBar(locale, SETTINGS_SAVE_TEXTS, state, handlers)}
        ${conflictBanner(locale, SETTINGS_CONFLICT_TEXTS, draft.conflict, {
            keepMine: () => {
                intents?.keepMine();
            },
            takeTheirs: () => {
                intents?.takeTheirs();
            },
            who: context.who,
            readOnly: context.readOnly,
        })}`;
}

/** The city as the open section edits it, or null before it is read. */
export function cityOf(context: SectionContext): CityDoc | null {
    return context.view.citySection.draft.value;
}

/** A section heading's text. */
export function sectionTitle(
    locale: UiLocale,
    section: 'area' | 'texts' | 'theme' | 'icon' | 'imagery' | 'publish' | 'categories' | 'overlays',
): string {
    return contentText(locale, `adminContent.settings.section.${section}`);
}

/** A section row's title and hint (M5's export names itself in its own catalogue, `adminContent.export.*`). */
export function sectionRowTexts(locale: UiLocale, section: SettingsSectionPort): { readonly title: string; readonly hint: string } {
    if (section === 'export') {
        return { title: contentText(locale, 'adminContent.export.title'), hint: contentText(locale, 'adminContent.export.intro') };
    }
    if (section === 'budget') {
        return { title: contentText(locale, 'adminContent.budgets.title'), hint: contentText(locale, 'adminContent.budgets.intro') };
    }
    return { title: sectionTitle(locale, section), hint: contentText(locale, `adminContent.settings.section.${section}Hint`) };
}
