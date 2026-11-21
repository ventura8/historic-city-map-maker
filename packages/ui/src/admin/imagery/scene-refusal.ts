/**
 * What the scene's page and its order card share (M3 and M4, `docs/research/M4-interfaces.md` §1.7): Setup's USGS step,
 * and the last refusal of an action on a scene (Import on the page, an order action on its card) as an alert. A leaf
 * module: the Imagery area's chunk and the order card's chunk share it.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText, noticeOf } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { ImageryViewState, SceneItemPort } from './imagery-port.js';
import { withValue } from './when.js';

/** Setup's USGS step, where the credentials are pasted and the M2M access is watched. */
export function usgsSetupLink(locale: UiLocale): TemplateResult {
    return html`<p><a href="#/setup/usgs">${contentText(locale, 'adminContent.imagery.openUsgsSetup')}</a></p>`;
}

type SceneRefusalPort = ImageryViewState['importRefusal'];

/** `refused`, when it is this scene's, as an alert (nothing otherwise). */
export function sceneRefusal(context: ImageryContext, refused: SceneRefusalPort, scene: SceneItemPort): TemplateResult {
    return withValue(
        refused?.id === scene.id ? refused.notice : null,
        (notice) =>
            html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(context.locale, notice)}</span></p>`,
    );
}
