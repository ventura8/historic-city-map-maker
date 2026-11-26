/**
 * M27 (`docs/research/M27-lost-streets.md`): how a POI category shows in the public map's Layers panel, in its editor's
 * "In the Layers panel" group: shown when the map opens (off: hidden until the visitor turns it on, as the Disappeared
 * streets are), pinned to the panel's top strip (below Compare and Map labels, above the historical layers), and the credit
 * of its data (`OpenHistoricalMap (CC0)`), shown under the list while the category is visible and in each place's sheet.
 */
import type { TemplateResult } from 'lit';
import { html } from 'lit';

import { field, issueAt } from '../layers/form-parts.js';
import { contentText } from '../shell/text.js';
import type { SectionContext } from './section-parts.js';
import type { CategoryEditorPort, CategoryValuePort } from './settings-port.js';

type DisplayKey = 'adminContent.settings.categoryShownAtStart' | 'adminContent.settings.categoryPinned';

function displaySwitch(context: SectionContext, key: DisplayKey, checked: boolean, change: (checked: boolean) => void): TemplateResult {
    const label = contentText(context.locale, key);
    return html`<div class="switch-row">
        <span aria-hidden="true">${label}</span>
        <hcm-switch
            .checked=${checked}
            ?disabled=${context.readOnly}
            label=${label}
            @hcm-change=${(event: Event) => {
                change((event as CustomEvent<{ checked: boolean }>).detail.checked);
            }}
        ></hcm-switch>
    </div>`;
}

/** The group: two switches and the credit field; an emptied credit is removed, never saved as blank. */
export function categoryDisplay(context: SectionContext, category: CategoryEditorPort, value: CategoryValuePort): TemplateResult {
    const { locale, intents } = context;
    return html`<section class="group">
        <h3>${contentText(locale, 'adminContent.settings.categoryDisplay')}</h3>
        ${displaySwitch(context, 'adminContent.settings.categoryShownAtStart', value.defaultVisible !== false, (checked) => {
            intents?.editCategory({ defaultVisible: checked });
        })}
        ${displaySwitch(context, 'adminContent.settings.categoryPinned', value.pinned === true, (checked) => {
            intents?.editCategory({ pinned: checked });
        })}
        ${field(locale, {
            id: 'category-attribution',
            label: contentText(locale, 'adminContent.settings.categoryAttribution'),
            help: contentText(locale, 'adminContent.settings.categoryAttributionHelp'),
            value: value.attribution ?? '',
            issue: issueAt(category.issues, 'attribution'),
            readOnly: context.readOnly,
            onInput: (text) => {
                const trimmed = text.trim();
                intents?.editCategory({ attribution: trimmed === '' ? undefined : text });
            },
        })}
    </section>`;
}
