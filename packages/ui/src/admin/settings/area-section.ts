/**
 * The area section (`docs/research/M2c-interfaces.md` §8.5; behaviour A19): the four edges of the city's bounds, the
 * start view and the zoom limits as number fields, and the photos and places smaller bounds would leave out, each a
 * link to its editor (S-A19-BAD-BOUNDS-EXCLUDE-CONTENT). The page's map above shows the bounds as a rectangle:
 * **Draw the area on the map** takes two clicks, two opposite corners (Stop drawing in between), **Use this view** takes
 * the map's centre and zoom as the start view (`DECISIONS-for-review.md` §42a); both wait for the map, and the number
 * fields are the keyboard's way to the same (WCAG 2.1.1).
 */
import { translate, type CityDoc, type ValidationIssue } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { field, issueAt } from '../layers/form-parts.js';
import { contentText } from '../shell/text.js';
import { cityHead, cityOf, sectionTitle, type SectionContext } from './section-parts.js';
import type { AreaNumberFieldPort, OutsidePort } from './settings-port.js';

type FieldKey = Parameters<typeof contentText>[1];

const BOUNDS: readonly { readonly name: AreaNumberFieldPort; readonly key: FieldKey }[] = [
    { name: 'west', key: 'adminContent.settings.west' },
    { name: 'east', key: 'adminContent.settings.east' },
    { name: 'south', key: 'adminContent.settings.south' },
    { name: 'north', key: 'adminContent.settings.north' },
];

const VIEW: readonly { readonly name: AreaNumberFieldPort; readonly key: FieldKey }[] = [
    { name: 'lat', key: 'adminContent.settings.centerLat' },
    { name: 'lng', key: 'adminContent.settings.centerLng' },
    { name: 'zoom', key: 'adminContent.settings.zoom' },
    { name: 'minZoom', key: 'adminContent.settings.minZoom' },
    { name: 'maxZoom', key: 'adminContent.settings.maxZoom' },
];

/** A number as the field shows it ('' for none or a number being typed wrong). */
function shown(value: number | undefined): string {
    return value === undefined || Number.isNaN(value) ? '' : String(value);
}

function valueOf(city: CityDoc, name: AreaNumberFieldPort): number | undefined {
    const values: Readonly<Record<AreaNumberFieldPort, number | undefined>> = {
        ...city.bounds,
        lat: city.center?.lat,
        lng: city.center?.lng,
        zoom: city.zoom,
        minZoom: city.minZoom,
        maxZoom: city.maxZoom,
    };
    return values[name];
}

/** The id of the one message a problem of the whole bounds (no area, west east of east) is said in. */
const BOUNDS_ERROR_ID = 'area-bounds-error';

/** A problem of the bounds as a whole (path `bounds`), said once for the four edges, or null. */
function boundsIssue(context: SectionContext): ValidationIssue | null {
    return context.view.citySection.draft.issues.find((issue) => issue.path === 'bounds') ?? null;
}

/** Where an area field's problem sits in the city document. */
function pathOf(name: AreaNumberFieldPort): string {
    const paths: Readonly<Record<AreaNumberFieldPort, string>> = {
        ...{ west: 'bounds', east: 'bounds', south: 'bounds', north: 'bounds' },
        ...{ lat: 'center', lng: 'center', zoom: 'zoom', minZoom: 'minZoom', maxZoom: 'maxZoom' },
    };
    return paths[name];
}

/**
 * A field's problem: an edge's own (a value that is no number) is said at the edge, one of the four edges together is
 * said once below them (each edge still marked invalid and described by it), any other field's at the field.
 */
function issueOf(context: SectionContext, name: AreaNumberFieldPort): { issue: ValidationIssue | null; issueShownAt?: string } {
    const issues = context.view.citySection.draft.issues;
    const path = pathOf(name);
    if (path !== 'bounds') {
        return { issue: issueAt(issues, path) };
    }
    const own = issueAt(issues, `bounds.${name}`);
    const shared = boundsIssue(context);
    return own !== null || shared === null ? { issue: own } : { issue: shared, issueShownAt: BOUNDS_ERROR_ID };
}

function numberField(
    context: SectionContext,
    city: CityDoc,
    spec: { readonly name: AreaNumberFieldPort; readonly key: FieldKey },
): TemplateResult {
    return field(context.locale, {
        id: `area-${spec.name}`,
        label: contentText(context.locale, spec.key),
        value: shown(valueOf(city, spec.name)),
        ...issueOf(context, spec.name),
        inputMode: 'decimal',
        readOnly: context.readOnly,
        onInput: (text) => {
            context.intents?.setNumber(spec.name, text);
        },
    });
}

function outsideItem(context: SectionContext, item: OutsidePort): TemplateResult {
    const key = item.kind === 'photo' ? 'adminContent.settings.outsidePhoto' : 'adminContent.settings.outsidePoi';
    const href = ['#', item.kind === 'photo' ? 'photos' : 'pois', item.id].join('/');
    return html`<li><a href=${href}>${contentText(context.locale, key, { title: item.title })}</a></li>`;
}

function outsideList(context: SectionContext, outside: readonly OutsidePort[]): TemplateResult | typeof nothing {
    const { locale } = context;
    return outside.length === 0
        ? nothing
        : html`<div class="alert" role="alert">
              <hcm-icon name="warning"></hcm-icon>
              <div class="alert-body">
                  <span>${contentText(locale, 'adminContent.settings.outside')}</span>
                  <ul>
                      ${outside.map((item) => outsideItem(context, item))}
                  </ul>
              </div>
          </div>`;
}

/** What the map's tools say while a rectangle is drawn. */
const DRAWING_KEYS = { first: 'adminContent.settings.drawFirst', second: 'adminContent.settings.drawSecond' } as const;

/** Draw the area and Use this view, and where a rectangle being drawn is. */
function mapTools(context: SectionContext): TemplateResult {
    const { locale, intents, view } = context;
    const off = view.map.status !== 'ready' || context.readOnly;
    const drawing = view.map.drawing;
    return html`<div class="actions map-tools">
            <hcm-button
                variant="tonal"
                icon="crop_free"
                class="draw-area"
                .pressed=${drawing !== null}
                ?disabled=${off}
                @click=${() => intents?.drawBounds()}
                >${contentText(locale, drawing === null ? 'adminContent.settings.drawArea' : 'adminContent.settings.drawCancel')}</hcm-button
            >
            <hcm-button variant="text" icon="my_location" class="use-view" ?disabled=${off} @click=${() => intents?.useMapView()}
                >${contentText(locale, 'adminContent.settings.useView')}</hcm-button
            >
        </div>
        <p class="note status" role="status">${drawing === null ? '' : contentText(locale, DRAWING_KEYS[drawing])}</p>`;
}

function boundsError(context: SectionContext): TemplateResult | typeof nothing {
    const issue = boundsIssue(context);
    return issue === null ? nothing : html`<p class="shared-error" id=${BOUNDS_ERROR_ID}>${translate(context.locale, issue.code)}</p>`;
}

export function areaSection(context: SectionContext): TemplateResult {
    const { locale } = context;
    const city = cityOf(context);
    if (city === null) {
        return html`<h2 tabindex="-1" data-detail-heading>${sectionTitle(locale, 'area')}</h2>`;
    }
    const state = context.view.citySection;
    return html`${cityHead(context, sectionTitle(locale, 'area'))}
        <section class="group">
            <h3>${contentText(locale, 'adminContent.settings.bounds')}</h3>
            <p class="note">${contentText(locale, 'adminContent.settings.boundsHelp')}</p>
            ${mapTools(context)}
            <div class="fields">${BOUNDS.map((spec) => numberField(context, city, spec))}</div>
            ${boundsError(context)}
            <p class="note status" role="status">${state.checking ? contentText(locale, 'adminContent.settings.checking') : ''}</p>
            ${outsideList(context, state.outside)}
        </section>
        <section class="group">
            <h3>${contentText(locale, 'adminContent.settings.startView')}</h3>
            <div class="fields">${VIEW.map((spec) => numberField(context, city, spec))}</div>
        </section>`;
}
