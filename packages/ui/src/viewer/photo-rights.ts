/** Who made a photo, under which licence, and who added it (M13 §5): the same lines wherever a photo shows, as CC BY asks. */
import { LICENSE_URLS, translate, type License, type ViewerLocale, type Photo, type UnplacedPhoto } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { licenseText } from './text.js';

function line(text: string | undefined): TemplateResult | typeof nothing {
    return text === undefined ? nothing : html`<p>${text}</p>`;
}

export function creditLine(credit: string | undefined, locale: ViewerLocale): TemplateResult | typeof nothing {
    return line(credit === undefined ? undefined : translate(locale, 'photo.credit', { name: credit }));
}

/** The licence's name, linked to its legal code when it has one (Creative Commons asks for the link). */
function licenseLine(license: License, locale: ViewerLocale): TemplateResult {
    const url = LICENSE_URLS[license];
    const text = licenseText(license, locale);
    return url === undefined ? html`<p>${text}</p>` : html`<p><a href=${url} target="_blank" rel="license noopener">${text}</a></p>`;
}

export function photoRights(photo: Photo | UnplacedPhoto, locale: ViewerLocale): TemplateResult {
    const { author, rightsHolder: holder } = photo;
    return html`${line(author === undefined ? undefined : translate(locale, 'photo.author', { author }))}
    ${licenseLine(photo.license, locale)} ${line(holder === undefined ? undefined : translate(locale, 'photo.rightsHolder', { holder }))}
    ${photo.rightsReview === true ? html`<p class="note">${translate(locale, 'photo.rightsReview')}</p>` : nothing}
    ${creditLine(photo.credit, locale)}`;
}
