/**
 * The parts of `<hcm-timeline>` the owner asked for on 2026-11-14: bigger year labels standing and on a compact window
 * (M3 label large, 14 px; 13 px lying elsewhere), a dot per year on the lying rail (the selected one's bigger, on the
 * pill's lower edge) and the scroll hint's edge buttons (`timeline-edges.ts`).
 */
import { css } from 'lit';

export const timelineExtraStyles = css`
    /* Bigger years where the eye is further or the screen small: standing, and on a compact window (M3 label large). */
    :host([orientation='vertical']) .stop {
        font-size: var(--md-sys-typescale-label-large-size, 0.875rem);
        line-height: 20px;
    }

    @media (width < 600px) {
        .stop {
            font-size: var(--md-sys-typescale-label-large-size, 0.875rem);
        }
    }

    /* Lying, every year is a dot on the rail under its label; the selected one's is bigger, on the pill's lower edge. */
    :host(:not([orientation='vertical'])) .stop::before {
        position: absolute;
        inset-block-start: 1px;
        inset-inline-start: 50%;
        box-sizing: border-box;
        inline-size: 6px;
        block-size: 6px;
        border-radius: 50%;
        background: var(--md-sys-color-on-surface-variant, GrayText);
        transform: translateX(var(--hcm-x));
        content: '';
    }

    :host(:not([orientation='vertical'])) .stop.selected::before {
        inset-block-start: 19px;
        inline-size: 10px;
        block-size: 10px;
        border: 2px solid var(--md-sys-color-surface-container, Canvas);
        background: var(--md-sys-color-primary, Highlight);
        z-index: 1;
    }

    /*
     * The scroll hint's buttons: 48 px targets over each edge with years beyond (its fade), an arrow over the
     * furthest year hidden that way; lying, on the rail and the labels' row at either end; standing, at the top and
     * the bottom of the card.
     */
    .edge {
        --hcm-icon-size: 20px;

        position: absolute;
        inset-block-start: 12px;
        z-index: 1;
        display: grid;
        place-items: center;
        align-content: center;
        box-sizing: border-box;
        min-inline-size: 48px;
        min-block-size: 64px;
        padding: 0 2px;
        border: none;
        border-radius: var(--md-sys-shape-corner-medium, 12px);
        background: var(--md-sys-color-surface-container, Canvas);
        color: var(--md-sys-color-on-surface-variant, CanvasText);
        font: inherit;
        font-size: 12px;
        line-height: 16px;
        cursor: pointer;
    }

    .edge:hover {
        background: color-mix(in srgb, var(--md-sys-color-on-surface, CanvasText) 8%, var(--md-sys-color-surface-container, Canvas));
    }

    .edge:focus-visible {
        outline: 3px solid var(--md-sys-color-secondary, Highlight);
        outline-offset: -3px;
    }

    .edge-start {
        inset-inline-start: 0;
    }

    .edge-end {
        inset-inline-end: 0;
    }

    .edge-year {
        white-space: nowrap;
    }

    :host([orientation='vertical']) .edge {
        inset-inline: 0;
        inset-block-start: auto;
        min-block-size: 48px;
        margin-inline: auto;
        inline-size: 60px;
    }

    :host([orientation='vertical']) .edge-start {
        inset-block-start: 0;
    }

    :host([orientation='vertical']) .edge-end {
        inset-block-end: 0;
    }

    /* The selected year's opacity card (timeline-opacity.ts): placed against the card above the thumb like the year chip. */
    .opacity {
        position: absolute;
        z-index: 2;
        display: flex;
        align-items: center;
        box-sizing: border-box;
        inline-size: 208px;
        min-block-size: 56px;
        padding: 0 16px;
        border: 1px solid var(--md-sys-color-outline-variant, CanvasText);
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-surface-container-highest, Canvas);
        color: var(--md-sys-color-on-surface, CanvasText);
        box-shadow: var(--md-sys-elevation-level2, none);
    }

    /* The caret under a lying timeline's card, over the selected year's pill (--hcm-caret, timeline-opacity.ts). */
    :host(:not([orientation='vertical'])) .opacity::after {
        position: absolute;
        inset-block-end: -7px;
        inset-inline-start: var(--hcm-caret, 50%);
        box-sizing: border-box;
        inline-size: 12px;
        block-size: 12px;
        border: solid var(--md-sys-color-outline-variant, CanvasText);
        border-width: 0 1px 1px 0;
        background: var(--md-sys-color-surface-container-highest, Canvas);
        content: '';
        pointer-events: none;
        translate: -50% 0;
        rotate: 45deg;
    }

    :host(:dir(rtl):not([orientation='vertical'])) .opacity::after {
        translate: 50% 0;
    }

    /* Narrow screens: the card is a sheet at the foot (below), with no pill to point at. */
    @media (width < 600px) {
        :host(:not([orientation='vertical'])) .opacity::after {
            display: none;
        }
    }

    /* The year's date menu is open: its sliders sit beside it (hcm-date-menu.ts), not this card (one of each, no overlap). */
    :host([dates-open]) .opacity {
        display: none;
    }

    .opacity[hidden] {
        display: none;
    }

    .opacity hcm-slider {
        flex: 1;
        min-inline-size: 0;
    }

    /* Design B: only the photos near the year show; a dot on the selected year's pill says so (the owner, 2026-11-15). */
    :host([near-year]) .thumb::after {
        position: absolute;
        inset-block-start: -4px;
        inset-inline-end: -4px;
        box-sizing: border-box;
        inline-size: 12px;
        block-size: 12px;
        border: 2px solid var(--md-sys-color-surface, Canvas);
        border-radius: 50%;
        background: var(--md-sys-color-primary, Highlight);
        content: '';
    }

    /* A year of several layers: "all" first, then a row per layer, each its date above its slider; 8 px apart, so two
       handles at the same value keep WCAG 2.5.8's 24 px of space (axe, the tour at 1440 px). */
    .opacity.several {
        flex-direction: column;
        gap: 8px;
        align-items: stretch;
        inline-size: 240px;
        padding-block: 8px;
    }

    .opacity-row {
        display: flex;
        flex-direction: column;
    }

    .opacity-name {
        font-size: var(--md-sys-typescale-body-small-size, 12px);
        line-height: var(--md-sys-typescale-body-small-line-height, 16px);
    }

    /* The open phone card's Opacity button (timeline-opacity.ts opacityOpener): just past the card, beside a standing one at
       its foot (a year's date menu opens by the pill, near its top), above a lying one near its end (the compass is over its start, the photos chip at its very end). */
    .opacity-open {
        position: absolute;
        inset-block-end: calc(100% + 8px);
        inset-inline-end: 64px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
        min-block-size: 48px;
        padding-inline: 12px 16px;
        border: 1px solid var(--md-sys-color-outline-variant, CanvasText);
        border-radius: var(--md-sys-shape-corner-full, 9999px);
        background: var(--md-sys-color-surface-container-highest, Canvas);
        color: var(--md-sys-color-on-surface, CanvasText);
        font: inherit;
        cursor: pointer;
    }

    .opacity-open:focus-visible {
        outline: 3px solid var(--md-sys-color-secondary, Highlight);
        outline-offset: 2px;
    }

    :host([orientation='vertical']) .opacity-open {
        inset-block: auto 0;
        inset-inline: calc(100% + 8px) auto;
    }

    /* Narrow screens: a sheet at the foot of the map, over the place timeline-opacity.ts gives it beside the thumb (its inline
       left and top, hence !important), between the standing timeline and the column of the zoom buttons and the menu, above
       Mapbox's legal line (the tour's occlusion and legal checks); a press elsewhere (the Layers button too) closes it, so it
       never lies over the Layers panel. */
    @media (width < 600px) {
        .opacity,
        .opacity.several {
            position: fixed;
            z-index: 4;
            inset: auto 80px calc(48px + env(safe-area-inset-bottom, 0px)) !important;
            inline-size: auto;
            padding: 8px 16px;
            border-radius: var(--md-sys-shape-corner-extra-large, 28px);
        }
    }

    /* Touch screens: a small half-filled disc at the start corner of the selected pill (the end one is the near-year dot)
       says it holds an opacity card (tap or long-press). */
    @media (pointer: coarse) {
        :host([fadable]) .thumb::before {
            position: absolute;
            inset-block-start: -4px;
            inset-inline-start: -4px;
            inline-size: 12px;
            block-size: 12px;
            border: 1px solid var(--md-sys-color-on-primary, Canvas);
            border-radius: 50%;
            background: linear-gradient(90deg, var(--md-sys-color-primary, Highlight) 50%, transparent 50%);
            content: '';
            pointer-events: none;
        }
    }

    /* Forced colours (Windows contrast themes): a button's own pair, its edge in its text colour. */
    @media (forced-colors: active) {
        .edge,
        .opacity,
        .opacity-open {
            border: 2px solid ButtonText;
            background: ButtonFace;
            color: ButtonText;
        }
    }
`;
