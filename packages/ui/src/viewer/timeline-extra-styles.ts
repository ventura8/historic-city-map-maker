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

    /* Forced colours (Windows contrast themes): a button's own pair, its edge in its text colour. */
    @media (forced-colors: active) {
        .edge,
        .opacity {
            border: 2px solid ButtonText;
            background: ButtonFace;
            color: ButtonText;
        }
    }
`;
