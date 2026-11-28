import { translate, type Layer, type Overlay, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { TimelineOrientation } from './hcm-timeline.js';
import type { YearOpacity } from './timeline-opacity.js';
import type { TimelineStop } from './timeline-model.js';
import type { DatesOpenDetail } from './timeline-dates.js';
import { dateItems, frontOfYear } from './timeline-dates.js';
import { opacitySheet } from './opacity-sheet.js';
import { EMPTY } from './empty.js';

/** What the dock's template needs from one render of the viewer. */
/** What the date menu needs from the timeline's dock (`timeline-dock.ts`), named here so the two modules form no cycle. */
export interface DateMenuDock {
    readonly dates: DatesOpenDetail | null;
    readonly peek: boolean;
    sidePanel(year: number): TemplateResult | null;
    sheetModel(): Parameters<typeof opacitySheet>[0];
    readonly controls: () => DOMRect[];
    readonly keepDates: () => void;
    readonly onMenuPointer: (event: CustomEvent<{ readonly inside: boolean }>) => void;
    readonly closeDates: () => void;
}

export interface DockView {
    readonly front?: string | null;
    readonly stops: readonly TimelineStop[];
    readonly year: number | null;
    readonly locale: ViewerLocale;
    readonly orientation: TimelineOrientation;
    readonly layers: readonly Layer[];
    readonly collapsed: boolean;
    /** The selected year's front layer for the opacity card above the thumb (`timeline-opacity.ts`); null: none. */
    readonly opacity: YearOpacity | null;
    /** Design B: only the photos near the year are drawn, so the selected year's pill carries a dot. */
    readonly near?: number | null;
}

/** The year panel's two actions: a date picked (to the front, V13) and a layer shown or hidden by its checkbox (2026-11-24). */
export interface DateMenuHandlers {
    readonly onDatePick: (event: CustomEvent<{ readonly layerId: string }>) => void;
    readonly onDateShow: (event: CustomEvent<{ readonly layerId: string; readonly visible: boolean }>) => void;
}

/** The historical layers that are on: each has its tick in the year panel. */
export function shownLayers(overlays: readonly Overlay[]): ReadonlySet<string> {
    return new Set(overlays.filter((overlay) => overlay.kind === 'raster' && overlay.visible).map((overlay) => overlay.id));
}

/** The date picker of the year the dock asked for, else the year's opacity sheet when it is open (`opacity-sheet.ts`). */
export function dateMenu(
    view: Pick<DockView, 'locale' | 'layers' | 'orientation'> & { readonly front: string | null; readonly shown?: ReadonlySet<string> },
    dock: DateMenuDock,
    on: DateMenuHandlers,
): TemplateResult {
    const dates = dock.dates;
    if (dates === null) {
        return opacitySheet(dock.sheetModel());
    }
    const side = dock.sidePanel(dates.year);
    return html`<hcm-date-menu
        .items=${dateItems(view.layers, dates.year, view.locale)}
        .selected=${frontOfYear(view.layers, dates.year, view.front)}
        .shown=${view.shown ?? new Set<string>()}
        .label=${translate(view.locale, 'timeline.dates', { year: String(dates.year) })}
        .anchor=${dates.anchor}
        .avoid=${dock.controls}
        .vertical=${view.orientation === 'vertical'}
        .peek=${dock.peek || dates.step !== undefined}
        .side=${side !== null}
        .showLabel=${(name: string) => translate(view.locale, 'timeline.showOnMap', { name })}
        @hcm-date-pick=${(event: CustomEvent<{ readonly layerId: string }>) => {
            dock.keepDates();
            on.onDatePick(event);
        }}
        @hcm-date-show=${on.onDateShow}
        @hcm-date-menu-pointer=${dock.onMenuPointer}
        @hcm-close=${dock.closeDates}
        >${side ?? EMPTY}</hcm-date-menu
    >`;
}

/** The date menu and the opacity sheet and its scrim: presses there are the dock's, not the map's. */
export function isPopup(target: Element): boolean {
    return target.localName === 'hcm-date-menu' || target.matches('.opacity-sheet, .opacity-scrim');
}

export interface TimelineHandlers extends Pick<DateMenuHandlers, 'onDatePick'> {
    readonly onYearChange: (event: CustomEvent) => void;
    readonly onOverlayOpacity: (event: CustomEvent) => void;
}
