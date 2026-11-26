/**
 * Lesson 676: the USGS search's part of each dataset, live while it runs (`ops/harvest-{city}`) and in its answer: searching, how many
 * scenes it stored, or that it stopped early (USGS too slow, out of time, or not answering), what it kept, and that the rest is searched
 * again by itself, so a slow day never reads as "nothing found".
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { SearchPartPort } from './imagery-port.js';
import { datasetText } from './imagery-text.js';

function partText(locale: UiLocale, part: SearchPartPort): string {
    const dataset = datasetText(locale, part.dataset);
    if (part.state === 'queued') {
        return contentText(locale, 'adminContent.imagery.partQueued', { dataset });
    }
    if (part.state === 'searching') {
        return `${dataset}: ${contentText(locale, 'adminContent.imagery.searchingButton')}`;
    }
    const found = String(part.found);
    if (part.state === 'done') {
        return `${dataset}: ${found}`;
    }
    const key = part.reason === 'usgsFailed' ? 'adminContent.imagery.partRefused' : 'adminContent.imagery.partStopped';
    return contentText(locale, key, { dataset, found });
}

/** One line per searched dataset, or nothing before a search. */
export function searchParts(locale: UiLocale, parts: readonly SearchPartPort[] | undefined): TemplateResult {
    if (parts === undefined || parts.length === 0) {
        return html``;
    }
    return html`<ul class="note search-parts" data-search-parts>
        ${parts.map((part) => html`<li data-dataset=${part.dataset} data-part=${part.state}>${partText(locale, part)}</li>`)}
    </ul>`;
}
