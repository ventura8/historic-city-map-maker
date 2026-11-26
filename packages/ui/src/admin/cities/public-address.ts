/**
 * A city's public map on the project's Firebase Hosting site (`docs/research/M6-interfaces.md` §2.4, CR-M6-17): the
 * admin is served under `/admin/` of that same site, so the address is the admin's own origin with the city id as its
 * path, `https://<project>.web.app/<id>/` (Hosting answers any city id with the generic city page; the project's first
 * city is also at the root). No repository step is needed any more: New city's done screen and Settings → Publishing
 * show it as a link.
 */
import { css, html, type TemplateResult } from 'lit';

import type { UiLocale } from '@hcm/shared';

import { contentText } from '../shell/text.js';

/** `https://<origin>/<cityId>/` for the admin page whose base URL is `base` (`https://<project>.web.app/admin/`). */
export function publicCityAddress(cityId: string, base: string): string {
    return new URL(`/${cityId}/`, base).href;
}

/** The city's public address as a link that opens a new tab (the address is its text). */
export function publicAddressLink(locale: UiLocale, cityId: string, base: string = document.baseURI): TemplateResult {
    const address = publicCityAddress(cityId, base);
    return html`<a class="public-address" data-public-address href=${address} target="_blank" rel="noopener noreferrer"
        >${address}<span class="visually-hidden"> ${contentText(locale, 'adminContent.cities.newTab')}</span></a
    >`;
}

/** A 48 px target on its own line; a long address wraps anywhere rather than widening a phone's page. */
export const publicAddressStyles = css`
    a.public-address {
        display: flex;
        align-items: center;
        inline-size: fit-content;
        max-inline-size: 100%;
        min-block-size: 48px;
        color: var(--md-sys-color-primary);
        overflow-wrap: anywhere;
    }
`;
