/**
 * The year's opacity card as a modal sheet on a phone (the owner, 2026-11-16): the open timeline card's Opacity button, a
 * long press on the pill or a tap on the selected one ask for it (`hcm-opacity-sheet`, `timeline-opacity.ts`). Like the date
 * menu it lies over a transparent scrim, outside the frame, which is inert under it (`TimelineDock.modal`), so the Tab round
 * stays in its sliders and its Close button (beside them: Tab goes round without climbing back up a column); a press on
 * the scrim, the Close button, Esc or the gamepad's B close it and the focus goes back to the timeline. Its
 * sliders are the card's (`timeline-opacity-card.ts`) and send the Layers panel's `hcm-overlay-opacity` through the dock.
 */
import { translate, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { opacitySliders, type YearOpacity } from './timeline-opacity-card.js';

/** What the sheet needs from the dock. */
export interface OpacitySheetModel {
    readonly year: YearOpacity;
    readonly locale: ViewerLocale;
    readonly close: () => void;
    readonly send: (event: CustomEvent) => void;
}

/** Sends the sliders' events to the viewer's opacity handler (the sheet is not inside the timeline that listens for them). */
function relay(send: (event: CustomEvent) => void): EventTarget {
    const target = new EventTarget();
    target.addEventListener('hcm-overlay-opacity', (event) => {
        send(event as CustomEvent);
    });
    return target;
}

/** Tab and Shift+Tab go round the sheet's sliders: the modal keeps the focus (the tour's modal-escape check). */
function keepTab(event: KeyboardEvent): void {
    const sheet = event.currentTarget as HTMLElement;
    const stops = [...sheet.querySelectorAll<HTMLElement>('hcm-slider, .opacity-close')];
    const at = stops.findIndex((stop) => stop.matches(':focus-within, :focus'));
    const next = stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];
    event.preventDefault();
    next?.focus();
}

/** The year's sliders for the date menu's side (`hcm-date-menu.ts`): the same rows, sent through the dock. */
export function sliderPanel(year: YearOpacity, locale: ViewerLocale, send: (event: CustomEvent) => void): TemplateResult {
    return html`<div class="opacity-sliders">${opacitySliders(year, locale, relay(send))}</div>`;
}

/** The scrim and the sheet, or nothing while closed. */
export function opacitySheet(model: OpacitySheetModel | null): TemplateResult {
    if (model === null) {
        return EMPTY;
    }
    const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            model.close();
        } else if (event.key === 'Tab') {
            keepTab(event);
        }
    };
    return html`<div class="opacity-scrim" @pointerdown=${model.close}></div>
        <div
            class="opacity-sheet"
            role="dialog"
            aria-modal="true"
            aria-label=${translate(model.locale, 'layers.opacity', { name: String(model.year.year) })}
            @keydown=${onKey}
        >
            <div class="opacity-sliders">${opacitySliders(model.year, model.locale, relay(model.send))}</div>
            <button
                type="button"
                class="opacity-close touch-target"
                aria-label=${translate(model.locale, 'action.close')}
                @click=${model.close}
            >
                <hcm-icon name="close" aria-hidden="true"></hcm-icon>
            </button>
        </div>`;
}
