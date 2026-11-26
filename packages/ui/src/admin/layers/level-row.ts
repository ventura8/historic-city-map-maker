/**
 * A building plan's level in the layer editor (`docs/research/M17-stories.md` §14): its order (0 the ground floor, -1 a
 * basement, 0.5 a mezzanine) and its Romanian name. Both empty, the layer is an ordinary map; a field writes when the
 * admin leaves it, so a half-typed number is never read.
 */
import type { LayerDoc, UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';

type Level = NonNullable<LayerDoc['level']>;

/** The level from the typed order and name: both needed, else none (an unreadable order is none too). */
export function levelOf(order: string, name: string, english: string | undefined): Level | undefined {
    const value = Number(order.trim().replace(',', '.'));
    const label = name.trim();
    if (order.trim() === '' || !Number.isFinite(value) || label === '') {
        return undefined;
    }
    return english === undefined ? { order: value, label: { ro: label } } : { order: value, label: { ro: label, en: english } };
}

export interface LevelRowInput {
    readonly locale: UiLocale;
    readonly level: Level | undefined;
    readonly readOnly: boolean;
    readonly change: (level: Level | undefined) => void;
}

export function levelRow(input: LevelRowInput): TemplateResult {
    const { locale, level } = input;
    let order = level === undefined ? '' : String(level.order);
    let name = level?.label.ro ?? '';
    const commit = (): void => {
        input.change(levelOf(order, name, level?.label.en));
    };
    return html`<div class="field level">
            <label for="layer-level-order">${contentText(locale, 'adminContent.layers.level.order')}</label>
            <input
                id="layer-level-order"
                inputmode="decimal"
                autocomplete="off"
                aria-describedby="layer-level-hint"
                ?readonly=${input.readOnly}
                .value=${order}
                @change=${(event: Event) => {
                    order = (event.target as HTMLInputElement).value;
                    commit();
                }}
            />
        </div>
        <div class="field level">
            <label for="layer-level-label">${contentText(locale, 'adminContent.layers.level.label')}</label>
            <input
                id="layer-level-label"
                autocomplete="off"
                aria-describedby="layer-level-hint"
                ?readonly=${input.readOnly}
                .value=${name}
                @change=${(event: Event) => {
                    name = (event.target as HTMLInputElement).value;
                    commit();
                }}
            />
        </div>
        <p class="note" id="layer-level-hint">${contentText(locale, 'adminContent.layers.level.hint')}</p>`;
}
