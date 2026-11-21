/** Who made a photo, under which licence, and who added it (M13 §5): the same lines wherever a photo shows, as CC BY asks. */
import { translate, type ViewerLocale, type Photo, type UnplacedPhoto } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { licenseText } from './text.js';

function line(text: string | undefined): TemplateResult | typeof nothing {
    return text === undefined ? nothing : html`<p>${text}</p>`;
}

export function creditLine(credit: string | undefined, locale: ViewerLocale): TemplateResult | typeof nothing {
    return line(credit === undefined ? undefined : translate(locale, 'photo.credit', { name: credit }));
}

export function photoRights(photo: Photo | UnplacedPhoto, locale: ViewerLocale): TemplateResult {
    const { author, rightsHolder: holder } = photo;
    return html`${line(author === undefined ? undefined : translate(locale, 'photo.author', { author }))}
        <p>${licenseText(photo.license, locale)}</p>
        ${line(holder === undefined ? undefined : translate(locale, 'photo.rightsHolder', { holder }))}
        ${photo.rightsReview === true ? html`<p class="note">${translate(locale, 'photo.rightsReview')}</p>` : nothing}
        ${creditLine(photo.credit, locale)}`;
}
