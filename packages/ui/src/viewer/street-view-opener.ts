import { translate, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

/** Keep both entry points as native links so the browser can offer split view, including from the keyboard. */
export function openStreetView(url: string, locale: ViewerLocale, closeMenu?: () => void): TemplateResult {
    const label = translate(locale, 'mapMenu.streetView');
    const hint = html`<small id="street-view-hint">${translate(locale, 'mapMenu.streetViewHint')}</small>`;
    if (closeMenu === undefined) {
        return html`<a href=${url} target="_blank" rel="noopener noreferrer" aria-describedby="street-view-hint">${label}</a> ${hint}`;
    }
    return html`<a
            class="item"
            role="menuitem"
            data-item="street-view"
            href=${url}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby="street-view-hint"
            @click=${closeMenu}
            ><hcm-icon name="travel_explore"></hcm-icon><span>${label}</span></a
        >
        ${hint}`;
}
