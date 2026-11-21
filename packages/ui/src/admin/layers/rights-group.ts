/**
 * The layer editor's rights (`docs/research/M20-import-local.md` §7; the owner, 2026-11-22): a drawn map's licence and its
 * author, corrected after the import. Changing the licence also swaps the licence named in the attribution, the credit line
 * the public map shows once Update the map runs. "Not set" leaves the layer without rights (USGS frames, linked layers).
 */
import { LAYER_LICENSES, type LayerDoc, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { LayersIntentsPort } from './layers-port.js';

interface RightsContext {
    readonly locale: UiLocale;
    readonly intents: LayersIntentsPort | null;
    readonly readOnly: boolean;
}

/** The licence picker: "Not set" and the five licences a published layer may carry. */
export function licenceSelect(context: RightsContext, layer: LayerDoc): TemplateResult {
    const { locale, intents } = context;
    const current = layer.rights?.licence ?? '';
    const change = (event: Event): void => {
        intents?.setField('rights.licence', (event.target as HTMLSelectElement).value);
    };
    return html`<div class="field">
        <label for="layer-rights-licence">${contentText(locale, 'adminContent.layers.licence')}</label>
        <select id="layer-rights-licence" aria-describedby="layer-rights-licence-help" ?disabled=${context.readOnly} @change=${change}>
            <option value="" ?selected=${current === ''}>${contentText(locale, 'adminContent.layers.licence.none')}</option>
            ${LAYER_LICENSES.map(
                (licence) =>
                    html`<option value=${licence} ?selected=${current === licence}>
                        ${contentText(locale, `adminContent.layers.licence.${licence}`)}
                    </option>`,
            )}
        </select>
        <span class="note" id="layer-rights-licence-help">${contentText(locale, 'adminContent.layers.licenceHelp')}</span>
    </div>`;
}
