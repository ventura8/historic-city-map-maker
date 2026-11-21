/**
 * The Sources card's country finder (M28, `docs/research/M28-sources.md` §10): where the city's country keeps its old maps,
 * air photos and satellite images, as `ops.tick` last wrote the list. Each place shows its kind, online or in person, free or
 * paid with the published figures, the years, what to ask for and its website; then a guided setup for the online part
 * (account, key, what to do on the site, the site's state, where it comes into the app) and a guide for the visit (the way
 * there in Google Maps, the hours, the contact, the request ready to send by email, the fees, the import afterwards).
 * Nothing to copy by hand: every step is a link or a button. Text only (the places are data, never HTML).
 */
import { directionsUrl, requestMailUrl, type CountryPlace, type ImportRoute } from '@hcm/shared/sources';
import { html, nothing, type TemplateResult } from 'lit';

import type { CountryFinderView } from './setup-port.js';
import { actionLink, sourcesKey, type SourcesText } from './sources-parts.js';

/** The texts a place's data holds in Romanian and English, in the page's language (English for any other). */
type PickText = (text: { readonly ro: string; readonly en: string }) => string;

export interface FinderContext {
    readonly t: SourcesText;
    readonly pick: PickText;
    readonly day: (iso: string) => string;
    /** The country's name in the page's language. */
    readonly countryName: (code: string) => string;
}

const IMPORT_LINKS: Readonly<Record<ImportRoute, string>> = {
    imageryUpload: '#/imagery/upload',
    localImport: '#/imagery/upload',
    photos: '#/photos',
};

function importLink(c: FinderContext, route: ImportRoute): TemplateResult {
    return actionLink(c.t(sourcesKey(`adminSources.import.${route}`)), IMPORT_LINKS[route], false);
}

function heading(c: FinderContext, key: string): TemplateResult {
    return html`<h5 class="label-large">${c.t(sourcesKey(key))}</h5>`;
}

function siteState(c: FinderContext, place: CountryPlace, refreshedAt: string | null): string {
    if (place.reachable === undefined || refreshedAt === null) {
        return c.t('adminSources.online.unchecked');
    }
    return place.reachable ? c.t('adminSources.online.reachable', { date: c.day(refreshedAt) }) : c.t('adminSources.finder.unreachable');
}

function onlineGuide(c: FinderContext, place: CountryPlace, refreshedAt: string | null): TemplateResult {
    const online = place.online;
    if (online === undefined) {
        return html``;
    }
    const account =
        online.signupUrl === undefined
            ? html`<p>${c.t('adminSources.online.noAccount')}</p>`
            : actionLink(c.t('adminSources.online.signUp'), online.signupUrl, true);
    return html`<details class="details" data-guide="online">
        <summary>${c.t('adminSources.online.title')}</summary>
        <div class="detail-body">
            ${heading(c, 'adminSources.online.account')} ${account} ${heading(c, 'adminSources.online.key')}
            <p>${c.t(sourcesKey(`adminSources.online.key.${online.key}`))}</p>
            ${heading(c, 'adminSources.online.do')}
            <p>${c.pick(online.howTo)}</p>
            ${heading(c, 'adminSources.online.check')}
            <p role="status">${siteState(c, place, refreshedAt)}</p>
            ${heading(c, 'adminSources.online.import')} ${importLink(c, online.importRoute)}
        </div>
    </details>`;
}

function contact(c: FinderContext, offline: NonNullable<CountryPlace['offline']>): TemplateResult {
    const phone =
        offline.phone === undefined
            ? nothing
            : actionLink(c.t('adminSources.offline.call', { phone: offline.phone }), `tel:${offline.phone.replace(/[^0-9+]/g, '')}`, false);
    return html`${heading(c, 'adminSources.offline.contact')}
        <div class="actions">${phone}</div>`;
}

function request(c: FinderContext, offline: NonNullable<CountryPlace['offline']>, city: string): TemplateResult {
    const filled = { subject: offline.request.subject.replaceAll('{city}', city), body: offline.request.body.replaceAll('{city}', city) };
    const send =
        offline.email === undefined
            ? html`<p class="note">${c.t('adminSources.offline.noEmail')}</p>
                  <div class="actions">
                      <button
                          class="action"
                          type="button"
                          @click=${() => {
                              window.print();
                          }}
                      >
                          ${c.t('adminSources.offline.print')}
                      </button>
                  </div>`
            : html`<div class="actions">
                  ${actionLink(c.t('adminSources.offline.send'), requestMailUrl(offline.email, filled), false)}
              </div>`;
    return html`${heading(c, 'adminSources.offline.request')}
        <p class="note">${c.t('adminSources.offline.requestNote')} ${c.pick(offline.requestMeaning)}</p>
        <blockquote class="letter">
            <p class="title-small">${filled.subject}</p>
            <p class="letter-body">${filled.body}</p>
        </blockquote>
        ${send}`;
}

function offlineGuide(c: FinderContext, place: CountryPlace, city: string): TemplateResult {
    const offline = place.offline;
    if (offline === undefined) {
        return html``;
    }
    return html`<details class="details" data-guide="offline">
        <summary>${c.t('adminSources.offline.title')}</summary>
        <div class="detail-body">
            ${heading(c, 'adminSources.offline.where')}
            <p>${offline.address}</p>
            <div class="actions">${actionLink(c.t('adminSources.offline.directions'), directionsUrl(offline.address), true)}</div>
            ${heading(c, 'adminSources.offline.hours')}
            <p>${c.pick(offline.hours)}</p>
            ${contact(c, offline)} ${heading(c, 'adminSources.offline.access')}
            <p>${c.pick(offline.access)}</p>
            ${request(c, offline, city)} ${heading(c, 'adminSources.offline.fees')}
            <p>${c.pick(offline.fees)}</p>
            ${heading(c, 'adminSources.offline.after')}
            <p>${c.t('adminSources.offline.afterText')}</p>
            ${importLink(c, offline.importRoute)}
        </div>
    </details>`;
}

/** "old maps, city plans · Years: 1700–1958", or nothing when the place says neither. */
function scope(c: FinderContext, place: CountryPlace): TemplateResult | typeof nothing {
    const materials = place.materials.map((material) => c.t(sourcesKey(`adminSources.material.${material}`)));
    const years =
        place.years === undefined ? [] : [c.t('adminSources.finder.years', { from: String(place.years.from), to: String(place.years.to) })];
    const parts = [materials.join(', '), ...years].filter((part) => part !== '');
    return parts.length === 0 ? nothing : html`<p class="note">${parts.join(' · ')}</p>`;
}

function paragraph(
    c: FinderContext,
    key: string,
    text: { readonly ro: string; readonly en: string } | undefined,
): TemplateResult | typeof nothing {
    return text === undefined
        ? nothing
        : html`${heading(c, key)}
              <p>${c.pick(text)}</p>`;
}

function facts(c: FinderContext, place: CountryPlace): TemplateResult {
    return html`<p class="chips">
            <span class="tag label-medium">${c.t(sourcesKey(`adminSources.kind.${place.kind}`))}</span>
            <span class="tag label-medium">${c.t(sourcesKey(`adminSources.access.${place.access}`))}</span>
            <span class="account label-medium">${c.t(sourcesKey(`adminSources.cost.${place.cost}`))}</span>
        </p>
        ${scope(c, place)} ${paragraph(c, 'adminSources.finder.costs', place.costNote)}
        ${paragraph(c, 'adminSources.finder.holdings', place.holdings)}`;
}

function placeCard(c: FinderContext, place: CountryPlace, finder: CountryFinderView): TemplateResult {
    const unreachable = place.reachable === false ? html`<p class="note">${c.t('adminSources.finder.unreachable')}</p>` : nothing;
    return html`<li class="source" data-place=${place.id}>
        <h4 class="title-small">${c.pick(place.name)}</h4>
        ${facts(c, place)} ${actionLink(c.t('adminSources.finder.site'), place.url, true)} ${unreachable}
        ${onlineGuide(c, place, finder.refreshedAt)} ${offlineGuide(c, place, finder.cityName ?? '')}
    </li>`;
}

/** Who checked the list and when its websites were checked; nothing before its first refresh. */
function provenance(c: FinderContext, finder: CountryFinderView): TemplateResult {
    if (finder.refreshedAt === null) {
        return html``;
    }
    const refreshed = c.day(finder.refreshedAt);
    const date = finder.factsCheckedOn === null ? refreshed : c.day(finder.factsCheckedOn);
    const said =
        finder.origin === 'curated'
            ? c.t('adminSources.finder.curated', { date, refreshed })
            : c.t('adminSources.finder.researched', { refreshed });
    return html`<p class="note">${said}</p>`;
}

function body(c: FinderContext, finder: CountryFinderView): TemplateResult {
    if (finder.state !== 'ready') {
        const key = sourcesKey(`adminSources.finder.${finder.state}`);
        return html`<p class="note" role="status">${c.t(key)}</p>`;
    }
    return html`${provenance(c, finder)}
        <ul class="group">
            ${finder.places.map((place) => placeCard(c, place, finder))}
        </ul>`;
}

/** The finder's section: its title names the country once the list is read. */
export function countryFinder(c: FinderContext, finder: CountryFinderView): TemplateResult {
    const title =
        finder.country === null
            ? c.t('adminSources.finder.titleNoCountry')
            : c.t('adminSources.finder.title', { country: c.countryName(finder.country) });
    return html`<section aria-labelledby="sources-finder" data-finder=${finder.state}>
        <h3 id="sources-finder" class="title-medium">${title}</h3>
        <p class="note">${c.t('adminSources.finder.intro')}</p>
        ${body(c, finder)}
    </section>`;
}
