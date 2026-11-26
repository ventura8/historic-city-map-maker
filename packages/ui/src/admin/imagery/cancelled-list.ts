/**
 * t130: Work's versions their own job stopped before the map (Snap my points with too few matching points, or a Cancel),
 * folded under a closed "Cancelled versions" below the live ones, so they never mix with the work that waits.
 * t131: each row's Remove opens a warning that it goes for good, and Remove for good deletes it through the same
 * `imagery.deleteVersion` as the version page's Delete.
 */
import { html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { VersionItemPort } from './imagery-port.js';

/** The row's Remove: a disclosure with the warning and the one button that deletes (none on a read-only page). */
function removeControl(context: ImageryContext, version: VersionItemPort): TemplateResult {
    const intents = context.intents;
    if (context.readOnly || intents?.removeVersion === undefined) {
        return EMPTY;
    }
    const { locale } = context;
    return html`<details class="remove" data-remove=${version.id}>
        <summary>${contentText(locale, 'adminContent.imagery.removeVersion')}</summary>
        <p class="note">${contentText(locale, 'adminContent.imagery.removeVersionWarning')}</p>
        <hcm-button variant="outlined" icon="delete_forever" data-remove-confirm @click=${() => void intents.removeVersion?.(version.id)}
            >${contentText(locale, 'adminContent.imagery.removeVersionConfirm')}</hcm-button
        >
    </details>`;
}

/** The folded group, closed at first; nothing when no version was cancelled. */
export function cancelledGroup(
    context: ImageryContext,
    row: (version: VersionItemPort, extra: TemplateResult) => TemplateResult,
): TemplateResult {
    const items = context.view.cancelled?.items ?? [];
    if (items.length === 0) {
        return EMPTY;
    }
    const { locale } = context;
    return html`<section class="section" aria-labelledby="imagery-cancelled">
        <details data-cancelled-versions>
            <summary>
                <h3 id="imagery-cancelled">${contentText(locale, 'adminContent.imagery.cancelled', { count: String(items.length) })}</h3>
            </summary>
            <p class="note">${contentText(locale, 'adminContent.imagery.cancelledNote')}</p>
            <ul class="rows">
                ${items.map((version) => row(version, removeControl(context, version)))}
            </ul>
        </details>
    </section>`;
}
