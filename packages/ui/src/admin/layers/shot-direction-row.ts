/**
 * A satellite or aerial layer's shot direction in the layer editor (V93, the owner 2026-11-23): `<hcm-shot-direction>`
 * (`hcm-shot-direction.ts`, a side chunk the layers page defines once it is): the compass dial, the degrees typed, Clear
 * and the USGS scene's direction. A drawn map has no shot direction: the row is not shown for one.
 */
import type { LayerDoc, UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { MapPort } from '../../map/map-port.js';
import { contentText } from '../shell/text.js';
import type { LayerEditorPort, LayersIntentsPort, MapStatusPort } from './layers-port.js';
import type { ShotDirectionRowInput } from './hcm-shot-direction.js';

/** The part of the editor's context these rows read (a narrow copy: `layer-editor.ts` imports this file). */
export interface ShotRowContext {
    readonly locale: UiLocale;
    readonly intents: LayersIntentsPort | null;
    readonly announce: (text: string) => void;
    readonly map: { readonly status: MapStatusPort };
    readonly readOnly: boolean;
}

export function shotDirectionRow(input: ShotDirectionRowInput): TemplateResult {
    return input.layer.kind === 'map' ? html`` : html`<hcm-shot-direction .input=${input}></hcm-shot-direction>`;
}

const KIND_CHOICES = ['map', 'aerial', 'satellite'] as const satisfies readonly LayerDoc['kind'][];

/** Live 2026-11-22: what the layer is (a drawn map, an aerial photo, a satellite image); the viewer's manifest follows it. */
export function kindRow(context: ShotRowContext, layer: LayerDoc): TemplateResult {
    const { locale, intents } = context;
    const label = contentText(locale, 'adminContent.layers.kind');
    return html`<p class="note" id="layer-kind">${label}</p>
        <hcm-segmented-button
            data-layer-kind
            .label=${label}
            .options=${KIND_CHOICES.map((value) => ({ value, label: contentText(locale, `adminContent.layers.kind.${value}`) }))}
            .value=${layer.kind}
            @hcm-change=${(event: CustomEvent<{ value: LayerDoc['kind'] }>) => {
                intents?.edit({ kind: event.detail.value });
            }}
        ></hcm-segmented-button>`;
}

function previewMap(context: ShotRowContext): MapPort | null {
    return context.intents?.compassMap?.() ?? null;
}

/** V93: a satellite or aerial image's shot direction, the dial and the degrees; its USGS scene's direction offered. */
export function shotRow(context: ShotRowContext, editor: LayerEditorPort, layer: LayerDoc): TemplateResult {
    return shotDirectionRow({
        ...{ locale: context.locale, layer, suggestion: editor.shotSuggestion, readOnly: context.readOnly },
        mapReady: context.map.status === 'ready' && context.intents?.mapBearing !== undefined,
        compassMap: previewMap(context),
        bearing: () => context.intents?.mapBearing?.() ?? null,
        announce: context.announce,
        change: (shotDirection) => {
            context.intents?.edit({ shotDirection });
        },
    });
}
