/**
 * Lesson 759: a superseded version's way back to the map. While its own tiles are still in the public bucket (`publicUrl`), the page
 * offers **Make this version the live one** (`imagery.makeLive`, asked first); once they were removed after the grace, it says so and
 * points at Calibrate again, which makes new tiles. A version published through Mapbox has no own tiles: the same note.
 */
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { VersionPagePort, VersionViewPort } from './imagery-port.js';
import { when } from './when.js';

/** The button while the version's tiles are still public, the note once they are gone; nothing for a version that is not superseded. */
export function makeLiveAction(context: ImageryContext, page: VersionPagePort, version: VersionViewPort | null): TemplateResult {
    return when(version?.state === 'superseded', () =>
        version?.publicUrl === null
            ? html`<p class="tiles-gone">${contentText(context.locale, 'adminContent.imagery.makeLiveGone')}</p>`
            : html`<hcm-button
                  variant="tonal"
                  icon="restore"
                  ?disabled=${page.acting !== null || context.readOnly}
                  @click=${() => {
                      context.ask('makeLive');
                  }}
                  >${contentText(context.locale, 'adminContent.imagery.makeLive')}</hcm-button
              >`,
    );
}
