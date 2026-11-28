import { viewerLocaleOf, wrapBearing, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';
import { guard } from 'lit/directives/guard.js';

import { nativeMap } from '../../map/mapbox-adapter.js';
import type { MapPort } from '../../map/map-port.js';
import type { CameraSource } from '../../viewer/hcm-compass.js';

function cameraSource(port: MapPort): CameraSource {
    return {
        watchCamera(listener) {
            const moved = ({ bearing }: { bearing: number }): void => {
                listener({ bearing: wrapBearing(bearing), pitch: nativeMap(port)?.getPitch() ?? 0 });
            };
            moved(port.getView());
            return port.on('move', moved);
        },
    };
}

/** In the editor's control row, outside the canvas and its attribution. */
export function adminCompass(port: MapPort | null | undefined, locale: UiLocale): TemplateResult {
    if (port === null || port === undefined) {
        return html``;
    }
    return html`<hcm-compass
        .locale=${viewerLocaleOf(locale) ?? 'en'}
        .source=${guard([port], () => cameraSource(port))}
        @click=${() => {
            port.flyTo({ bearing: 0 }, { animate: false, pitch: 0 });
        }}
    ></hcm-compass>`;
}
