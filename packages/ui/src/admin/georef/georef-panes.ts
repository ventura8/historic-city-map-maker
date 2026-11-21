/**
 * The georeferencer's two panes (`docs/research/M3-interfaces.md` §10.4): the scan (`<hcm-scan-viewer>`, its numbered
 * markers and the keyboard's help) and the reference map (`<hcm-admin-map>` with the list of what it shows: OpenStreetMap,
 * Sentinel-2 or one of the city's published layers, and its credit), side by side from medium windows, one at a
 * time under a Scan | Map switch on compact ones.
 */
import { contentLocale, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { when, withValue } from '../imagery/when.js';
import { contentText } from '../shell/text.js';
import type { GeorefContext } from './georef-parts.js';
import type { GeorefViewState, HalfPairPort, PixelPositionPort, ReferenceKindPort, ScanCameraPort } from './georef-port.js';
import { badgeToneOf } from './marker-badge.js';
import type { ScanMarker } from './scan-draw.js';

const ATTRIBUTION = {
    osm: 'adminContent.georef.attribution.osm',
    s2: 'adminContent.georef.attribution.s2',
} as const satisfies Readonly<Record<ReferenceKindPort, string>>;

/** The scan's markers, numbered as the residual table numbers its rows (in the pairs' order). */
function markersOf(view: GeorefViewState): readonly ScanMarker[] {
    return view.pairs.map((pair, index) => ({
        id: pair.id,
        label: String(index + 1),
        pixel: pair.pixel,
        enabled: pair.enabled,
        tone: badgeToneOf(view.fit.residuals[pair.id], view.thresholdM),
    }));
}

/** The matcher's suggestions still to decide, labelled `a1`, `a2`, … as in their list (drawn dashed, M4 §2.5). */
function suggestionMarkersOf(view: GeorefViewState): readonly ScanMarker[] {
    return view.suggestions.pending.map((row) => ({ id: row.pair.id, label: row.label, pixel: row.pair.pixel, enabled: true }));
}

/** The half pair's scan end, when it began on the scan. */
function halfPixel(half: HalfPairPort | null): PixelPositionPort | null {
    return half !== null && 'pixel' in half ? half.pixel : null;
}

type Detail<T> = CustomEvent<T>;

/** One press of a turn button on the map: 15 degrees, as the scan pane's (`TURN_STEP`). */
const TURN_DEGREES = 15;

/** The scan pane's own turning (`<hcm-scan-viewer>`: its view lives in the element). */
interface TurningViewer {
    rotateBy(delta: number): boolean;
    upright(): boolean;
}

/** The scan viewer of the pane a button sits in. */
function viewerOf(event: Event): TurningViewer | null {
    return (
        (event.currentTarget as HTMLElement).closest('.scan-pane')?.querySelector<HTMLElement & TurningViewer>('hcm-scan-viewer') ?? null
    );
}

/** What a turn button does on its pane: `direction` -1 to the left, 1 to the right, 0 upright (the scan) or north up (the map). */
function turn(context: GeorefContext, pane: 'scan' | 'map', direction: -1 | 0 | 1): (event: Event) => void {
    if (pane === 'map') {
        return () => {
            context.intents?.rotateMap(direction === 0 ? null : direction * TURN_DEGREES);
        };
    }
    return (event) => {
        const viewer = viewerOf(event);
        if (direction === 0) {
            viewer?.upright();
        } else {
            viewer?.rotateBy((direction * TURN_DEGREES * Math.PI) / 180);
        }
    };
}

/** Turn left, Turn right and Upright (the scan) or North up (the map): each pane turns on its own, by button and by keyboard. */
function turnButtons(context: GeorefContext, pane: 'scan' | 'map'): TemplateResult {
    const { locale } = context;
    const button = (direction: -1 | 0 | 1, name: 'left' | 'right' | 'scanUp' | 'mapUp'): TemplateResult => {
        const label = contentText(locale, `adminContent.georef.turn.${name}`);
        return html`<hcm-button variant="text" data-turn=${name} @click=${turn(context, pane, direction)}>${label}</hcm-button>`;
    };
    const group = contentText(locale, `adminContent.georef.turn.${pane}`);
    return html`<div class="actions turn" role="group" aria-label=${group}>
        ${button(-1, 'left')} ${button(1, 'right')} ${button(0, pane === 'scan' ? 'scanUp' : 'mapUp')}
    </div>`;
}

function scanViewer(context: GeorefContext, scan: NonNullable<NonNullable<GeorefViewState['version']>['scan']>): TemplateResult {
    const { locale, view, intents } = context;
    return html`<hcm-scan-viewer
            .src=${view.scan.status === 'ready' ? view.scan.url : ''}
            .scanWidth=${scan.width}
            .scanHeight=${scan.height}
            .previewScale=${scan.previewScale}
            .markers=${markersOf(view)}
            .selected=${view.selected}
            .suggestions=${suggestionMarkersOf(view)}
            .selectedSuggestion=${view.suggestions.selected}
            .half=${halfPixel(view.half)}
            .ghost=${halfPixel(view.ghost)}
            .detail=${view.scanDetail}
            .follow=${view.scanFollow}
            .opening=${view.version?.opening ?? null}
            ?adding=${view.adding || view.moving !== null}
            .label=${contentText(locale, 'adminContent.georef.scanLabel')}
            .zoomInLabel=${contentText(locale, 'adminContent.map.zoomIn')}
            .zoomOutLabel=${contentText(locale, 'adminContent.map.zoomOut')}
            @hcm-pick=${(event: Detail<{ pixel: PixelPositionPort }>) => {
                intents?.pickScan(event.detail.pixel);
            }}
            @hcm-select=${(event: Detail<{ id: string | null }>) => {
                intents?.select(event.detail.id);
            }}
            @hcm-move=${(event: Detail<{ id: string; pixel: PixelPositionPort }>) => {
                intents?.movePixel(event.detail.id, event.detail.pixel);
            }}
            @hcm-delete=${(event: Detail<{ id: string }>) => {
                intents?.remove(event.detail.id);
            }}
            @hcm-escape=${() => {
                intents?.cancelHalf();
            }}
            @hcm-view=${(event: Detail<ScanCameraPort>) => {
                intents?.scanMoved(event.detail);
            }}
        ></hcm-scan-viewer>
        ${turnButtons(context, 'scan')}
        <p class="note">${contentText(locale, 'adminContent.georef.scanKeys')} ${contentText(locale, 'adminContent.georef.turn.keys')}</p>`;
}

/** M20 §19.12: what an archive series' scan pane says when it has no picture of its own, and the way to Fix the tiles. */
function seriesNote(context: GeorefContext, key: 'adminContent.georef.noScanSeries' | 'adminContent.georef.stitchedOnly'): TemplateResult {
    const id = context.view.version?.id ?? '';
    return html`<p class="note" data-state=${key === 'adminContent.georef.stitchedOnly' ? 'stitched-only' : 'no-scan-series'}>
        ${contentText(context.locale, key)}
        <a href=${`#/imagery/version/${id}`}>${contentText(context.locale, 'adminContent.georef.openSeries')}</a>
    </p>`;
}

function scanPane(context: GeorefContext): TemplateResult {
    const version = context.view.version;
    const scan = version?.scan ?? null;
    if (scan === null || context.view.scan.status === 'failed') {
        return version?.series === undefined
            ? html`<p class="note" data-state="no-scan">${contentText(context.locale, 'adminContent.georef.noScan')}</p>`
            : seriesNote(context, 'adminContent.georef.noScanSeries');
    }
    return html`${version?.series?.stitchedOnly === true ? seriesNote(context, 'adminContent.georef.stitchedOnly') : ''}${scanViewer(context, scan)}`;
}

/** The references the version has. */
function referencesOf(view: GeorefViewState): readonly ReferenceKindPort[] {
    const reference = view.version?.reference ?? null;
    if (reference === null) {
        return [];
    }
    return (['osm', 's2'] as const).filter((kind) => (kind === 'osm' ? reference.osmPath : reference.s2Path) !== null);
}

/** A published layer's name in the page's language (Romanian when it has no other): kept here so the panes' chunk imports no other area's texts. */
function layerName(layer: GeorefViewState['baseLayers'][number], locale: UiLocale): string {
    return contentLocale(locale) === 'en' ? (layer.label.en ?? layer.label.ro) : layer.label.ro;
}

/** One thing the map pane can show: a reference of the version, or a published layer of the city. */
interface MapChoice {
    readonly value: string;
    readonly label: string;
    readonly choose: (intents: NonNullable<GeorefContext['intents']>) => void;
}

function mapChoices({ locale, view }: GeorefContext): readonly MapChoice[] {
    const references = referencesOf(view).map((kind) => ({
        value: `reference:${kind}`,
        label: contentText(locale, `adminContent.georef.reference.${kind}`),
        choose: (intents: NonNullable<GeorefContext['intents']>): void => {
            intents.setBase(null);
            intents.setReference(kind);
        },
    }));
    const layers = view.baseLayers.map((layer) => ({
        value: `layer:${layer.id}`,
        label: contentText(locale, 'adminContent.georef.shows.layer', { name: layerName(layer, locale), year: String(layer.year) }),
        choose: (intents: NonNullable<GeorefContext['intents']>): void => {
            intents.setBase(layer.id);
        },
    }));
    return [...references, ...layers];
}

/** What the map pane shows now, as a choice's value. */
function shownValue(view: GeorefViewState): string {
    return view.base === null ? `reference:${String(view.reference)}` : `layer:${view.base}`;
}

/**
 * The map shows: OpenStreetMap, Sentinel-2 or one of the city's published layers (align 1914 on the 1911 plan). A native list: the
 * keyboard and a screen reader have it as it is. Shown once there is more than one thing to show.
 */
function mapShows(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    const choices = mapChoices(context);
    const shown = shownValue(view);
    const change = (event: Event): void => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        const choice = choices.find((item) => item.value === value);
        if (choice !== undefined && intents !== null) {
            choice.choose(intents);
        }
    };
    return when(
        choices.length > 1,
        () =>
            html`<div class="field shows">
                <label for="map-shows">${contentText(locale, 'adminContent.georef.shows.map')}</label>
                <select id="map-shows" @change=${change}>
                    ${choices.map((choice) => html`<option value=${choice.value} ?selected=${choice.value === shown}>${choice.label}</option>`)}
                </select>
            </div>`,
    );
}

/** The Sentinel-2 item's year, for its attribution ('' when unknown). */
function s2Year(view: GeorefViewState): string {
    return view.version?.reference?.s2Date?.slice(0, 4) ?? '';
}

/** The credit of what the map shows: the published layer's name and year, else the reference's. */
function attribution(locale: UiLocale, view: GeorefViewState): string {
    const layer = view.baseLayers.find((item) => item.id === view.base);
    if (layer !== undefined) {
        return contentText(locale, 'adminContent.georef.shows.layerNote', {
            name: layerName(layer, locale),
            year: String(layer.year),
        });
    }
    const reference = view.reference;
    if (reference === null) {
        return contentText(locale, 'adminContent.georef.noReference');
    }
    return contentText(locale, ATTRIBUTION[reference], { year: s2Year(view) });
}

function mapPane(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    return html`${mapShows(context)}
        <hcm-admin-map
            .status=${view.map}
            .locale=${locale}
            .cssUrl=${context.mapCss}
            @hcm-map-host=${(event: Detail<{ container: HTMLElement }>) => {
                intents?.attachMap(event.detail.container);
            }}
            @hcm-zoom=${(event: Detail<{ delta: number }>) => {
                intents?.zoomBy(event.detail.delta);
            }}
            @hcm-map-focus=${(event: Detail<{ focused: boolean }>) => {
                intents?.setMapFocus(event.detail.focused);
            }}
            @hcm-map-nudge=${(event: Detail<{ dx: number; dy: number }>) => {
                intents?.nudgeMap(event.detail.dx, event.detail.dy);
            }}
            @hcm-map-delete=${() => {
                removeSelected(context);
            }}
        ></hcm-admin-map>
        ${turnButtons(context, 'map')}
        <p class="note">${attribution(locale, view)}</p>`;
}

function paneSwitch(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    const options = [
        { value: 'scan', label: contentText(locale, 'adminContent.georef.pane.scan') },
        { value: 'map', label: contentText(locale, 'adminContent.georef.pane.map') },
    ];
    return when(
        context.compact,
        () =>
            html`<hcm-segmented-button
                .options=${options}
                .value=${view.pane}
                .label=${contentText(locale, 'adminContent.georef.pane.label')}
                @hcm-change=${(event: Detail<{ value: 'scan' | 'map' }>) => {
                    intents?.setPane(event.detail.value);
                }}
            ></hcm-segmented-button>`,
    );
}

/** While a point picked up from the context menu waits for its place: which one, where to click, and Esc. */
function movingNote(context: GeorefContext): TemplateResult {
    const { locale, view } = context;
    return withValue(view.moving, (moving) => {
        const number = String(view.pairs.findIndex((pair) => pair.id === moving.id) + 1);
        return html`<p class="note" role="status" data-state="moving">
            ${contentText(locale, `adminContent.georef.menu.moving.${moving.pane}`, { number })}
        </p>`;
    });
}

/** The selected pair goes (the button beside the panes, Delete or Backspace on the map), unless nothing writes. */
function removeSelected({ view, intents, locked }: GeorefContext): void {
    if (view.selected !== null && !locked) {
        intents?.remove(view.selected);
    }
}

/** Delete pair N: shown while a pair is selected, so removing it never needs the table below. */
function deleteSelected(context: GeorefContext): TemplateResult {
    const { locale, view } = context;
    const index = view.pairs.findIndex((pair) => pair.id === view.selected);
    return when(
        index >= 0,
        () =>
            html`<hcm-button
                variant="outlined"
                icon="delete"
                data-action="delete-selected"
                ?disabled=${context.locked}
                @click=${() => {
                    removeSelected(context);
                }}
                >${contentText(locale, 'adminContent.georef.deleteSelected', { number: String(index + 1) })}</hcm-button
            >`,
    );
}

/** Link the views: on by default once a fit exists; without one it is off and says when it will work. */
function linkToggle(context: GeorefContext): TemplateResult {
    const { locale, view, intents } = context;
    const fitted = view.fit.refusal === null;
    return html`<div class="actions">
        <hcm-button
            variant="outlined"
            icon="link"
            data-action="link-views"
            .pressed=${fitted && view.linked}
            ?disabled=${!fitted}
            @click=${() => {
                intents?.setLinked(!view.linked);
            }}
            >${contentText(locale, 'adminContent.georef.linkViews')}</hcm-button
        >
        <hcm-button
            variant="outlined"
            icon="explore"
            data-action="rotate-together"
            .pressed=${fitted && view.rotateLinked}
            ?disabled=${!fitted}
            @click=${() => {
                intents?.setRotateLinked(!view.rotateLinked);
            }}
            >${contentText(locale, 'adminContent.georef.turn.together')}</hcm-button
        >
        ${deleteSelected(context)}
        ${when(!fitted, () => html`<span class="note" data-state="link-no-fit">${contentText(locale, 'adminContent.georef.linkViewsNoFit')}</span>`)}
    </div>`;
}

export function panes(context: GeorefContext): TemplateResult {
    return html`${paneSwitch(context)} ${linkToggle(context)} ${movingNote(context)}
        <div class="panes" ?data-compact=${context.compact} data-pane=${context.view.pane}>
            <div class="scan-pane">${scanPane(context)}</div>
            <div class="map-pane">${mapPane(context)}</div>
        </div>`;
}
