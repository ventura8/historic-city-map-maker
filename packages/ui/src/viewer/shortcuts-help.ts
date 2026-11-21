/**
 * The help panel's content (docs/research/viewer-input.md §2), a mode of `<hcm-about-dialog>`: the keys, the switch that
 * turns them off (WCAG 2.1.4, character key shortcuts) and the gamepad's buttons.
 */
import { translate, type ViewerLocale, type MessageKey } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { SHORTCUT_ROWS } from './viewer-keyboard.js';

const PAD_LINES: readonly MessageKey[] = ['input.padMove', 'input.padFocus', 'input.padActs'];

function keyCap(key: string): TemplateResult {
    return html`<kbd>${key}</kbd> `;
}

function shortcutRow(keys: readonly string[], label: string): TemplateResult {
    return html`<li>${keys.map(keyCap)}${label}</li>`;
}

export function renderShortcutsHelp(
    locale: ViewerLocale,
    enabled: boolean,
    onToggle: (event: CustomEvent<{ readonly checked: boolean }>) => void,
): TemplateResult {
    const toggle = translate(locale, 'input.toggle');
    return html`<div class="details">
        <section>
            <p>${toggle} <hcm-switch .checked=${enabled} .label=${toggle} @hcm-change=${onToggle}></hcm-switch></p>
            <ul>
                ${SHORTCUT_ROWS.map(([keys, label]) => shortcutRow(keys, translate(locale, label)))}
            </ul>
            <p class="supporting">${translate(locale, 'input.note')}</p>
        </section>
        <section>
            <h3>${translate(locale, 'input.padTitle')}</h3>
            <ul>
                ${PAD_LINES.map((line) => html`<li>${translate(locale, line)}</li>`)}
            </ul>
        </section>
    </div>`;
}
