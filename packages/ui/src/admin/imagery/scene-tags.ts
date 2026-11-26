/**
 * A scene card's chips of its usefulness (the owner's report of 2026-11-13): **Not useful** once the owner marked it, else
 * **Probably cloudy over the city: N %** when its browse image shows `CLOUDY_CITY_PERCENT` or more of the city clouded. In the
 * Imagery area's chunk; the scene page's section is `scene-unusable.ts`, a chunk of its own.
 */
import { CLOUDY_CITY_PERCENT, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { SceneItemPort } from './imagery-port.js';
import { numberText } from './imagery-text.js';

/** The share of the city clouded, when the frame is probably cloudy over it. */
function cloudyShare(scene: SceneItemPort): number | null {
    return scene.cloudCity !== null && scene.cloudCity >= CLOUDY_CITY_PERCENT ? scene.cloudCity : null;
}

function percentText(locale: UiLocale, percent: number): string {
    return numberText(locale, percent, 0);
}

/** The card's chips: Not useful, or Probably cloudy over the city: N %. */
export function usefulnessTags(locale: UiLocale, scene: SceneItemPort): TemplateResult {
    if (scene.unusable !== null) {
        return html`<span class="tag" data-tone="error" data-state="unusable"
            >${contentText(locale, 'adminContent.imagery.unusable.tag')}</span
        >`;
    }
    const share = cloudyShare(scene);
    return share === null
        ? EMPTY
        : html`<span class="tag" data-tone="wait" data-state="cloudy"
              >${contentText(locale, 'adminContent.imagery.cloudy.tag', { percent: percentText(locale, share) })}</span
          >`;
}
