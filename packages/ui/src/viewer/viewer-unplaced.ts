/** The sheet of the "Where was this taken?" gallery (M13, V40), modal or docked as the viewer's other sheets. */
import { translate, type Manifest, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { Placement } from './layout.js';
import { renderSheetFrame } from './sheet-frame.js';

/** What the sheet needs of the viewer's view. */
interface UnplacedView {
    readonly locale: ViewerLocale;
    readonly manifestUrl: string;
}

export function unplacedSheet(
    view: UnplacedView,
    manifest: Manifest,
    placement: Placement,
    onSheetClose: (event: Event) => void,
): TemplateResult {
    const content = html`<hcm-unplaced-gallery
        .photos=${manifest.unplaced ?? []}
        .locale=${view.locale}
        .manifestUrl=${view.manifestUrl}
        .contributeUrl=${manifest.contributeUrl ?? null}
    ></hcm-unplaced-gallery>`;
    const frame = {
        ...placement,
        label: translate(view.locale, 'unplaced.title'),
        closeLabel: translate(view.locale, 'action.close'),
        handleLabel: translate(view.locale, 'sheet.resize'),
        onClose: (): void => {
            onSheetClose(new CustomEvent('hcm-close'));
        },
    };
    return html`<div class="unplaced-sheet" ?inert=${placement.inert === true} @hcm-close=${onSheetClose}>
        ${renderSheetFrame(frame, content)}
    </div>`;
}
