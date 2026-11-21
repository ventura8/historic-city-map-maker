/** A scene's or a version's page the address names and nobody has, and the way back to the list. */
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';

export function notFoundPane(context: ImageryContext, heading: Parameters<typeof contentText>[1]): TemplateResult {
    return html`<div class="pane">
        <h2 tabindex="-1" data-detail-heading>${contentText(context.locale, heading)}</h2>
        <p><a href=${context.href([])}>${contentText(context.locale, 'adminContent.imagery.backToList')}</a></p>
    </div>`;
}
