import { translate, type Photo, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { externalLink } from './markdown.js';
import { photoSourceText } from './text.js';

/** Where the photo comes from: a plain link, opened in a new tab (`externalLink`). */
export function photoSource({ source }: Photo, locale: ViewerLocale): TemplateResult {
    return source === undefined
        ? EMPTY
        : html`<p class="source">${translate(locale, 'photo.source')} ${externalLink(source.url, photoSourceText(source))}</p>`;
}
