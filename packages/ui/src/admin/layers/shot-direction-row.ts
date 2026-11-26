/**
 * A satellite or aerial layer's shot direction in the layer editor (V93, the owner 2026-11-23): `<hcm-shot-direction>`
 * (`hcm-shot-direction.ts`, a side chunk the layers page defines once it is): the compass dial, the degrees typed, Clear
 * and the USGS scene's direction. A drawn map has no shot direction: the row is not shown for one.
 */
import { html, type TemplateResult } from 'lit';

import type { ShotDirectionRowInput } from './hcm-shot-direction.js';

export function shotDirectionRow(input: ShotDirectionRowInput): TemplateResult {
    return input.layer.kind === 'map' ? html`` : html`<hcm-shot-direction .input=${input}></hcm-shot-direction>`;
}
