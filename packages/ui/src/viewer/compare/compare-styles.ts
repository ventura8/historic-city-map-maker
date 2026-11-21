/**
 * Styles of `<hcm-compare>` (M4, docs/research/M4-interfaces.md §3.5–§3.7). The host covers the viewer's map pane and lets
 * every pointer through; only the bar and the divider's handle take them. The second map is clipped to the right of the
 * divider and stays inert and transparent to pointers: the viewer's map, under it, takes every gesture and the second map
 * follows its camera, so the visitor drags, zooms and clicks either side alike, and Mapbox's logo and attribution of the
 * viewer's map (z-index 2 in mapbox-gl.css) stay on top of both sides at every divider position (the second map's own are
 * hidden: one logo and one attribution, Mapbox terms). The bar and the handle keep clear of the viewer's floating controls
 * through the custom properties the viewer defines (`--hcm-gutter`, `--hcm-map-chrome`, `--hcm-timeline-block`,
 * `--hcm-dock-gap`, and `--hcm-top-start` where the timeline stands on the leading edge), which reach this shadow root by
 * inheritance; they sit below the viewer's docks (z-index 10 and up).
 */
import { css } from 'lit';

export const compareStyles = css`
    :host {
        /* The handle's 48 px target keeps the gutter at the leading edge and, beside it, at the trailing one. */
        --hcm-compare-start: var(--hcm-gutter, 16px);
        --hcm-compare-end: calc(var(--hcm-gutter, 16px) + 48px);

        position: absolute;
        inset: 0;
        display: block;
        pointer-events: none;
    }

    .second {
        position: absolute;
        inset: 0;
        pointer-events: none;
        clip-path: inset(0 0 0 var(--hcm-compare-at, 50%));
    }

    .second .mapboxgl-control-container {
        display: none;
    }

    /* A compact window's toggle: the parked second map keeps its size (a map sized to nothing would warn) but is not seen. */
    :host([mode='toggle']) .second {
        visibility: hidden;
    }

    .line {
        position: absolute;
        z-index: 3;
        inset-block: 0 var(--hcm-map-chrome, 42px);
        inset-inline-start: clamp(0px, calc(var(--hcm-compare-at, 50%) - 2px), calc(100% - 4px));
        inline-size: 4px;
        background: var(--md-sys-color-surface-container-lowest);
        box-shadow: 0 0 0 1px var(--md-sys-color-outline);
    }

    /*
     * Above the middle of the map, ending 16 px before it: its centre stays the map's (a tap there is a tap on the map),
     * and the handle keeps clear of what lies at the map's foot. Below the middle it touched the timeline lying there on
     * a phone held landscape (412 px), lifted out of its way it reached the centre or the chip, and 32 px above the
     * middle the bar, two rows tall under the tour's text spacing, reached it (the tour).
     */
    .handle {
        position: absolute;
        z-index: 3;
        inset-block-start: calc(50% - 64px);
        inset-inline-start: clamp(var(--hcm-compare-start), calc(var(--hcm-compare-at, 50%) - 24px), calc(100% - var(--hcm-compare-end)));
        display: grid;
        place-items: center;
        box-sizing: border-box;
        inline-size: 48px;
        block-size: 48px;
        border: 1px solid var(--md-sys-color-outline);
        border-radius: var(--md-sys-shape-corner-full);
        background: var(--md-sys-color-primary-container);
        color: var(--md-sys-color-on-primary-container);
        box-shadow: var(--md-sys-elevation-level3);
        cursor: ew-resize;
        pointer-events: auto;
        touch-action: none;
    }

    .bar {
        position: absolute;
        z-index: 4;
        inset-block-start: calc(var(--hcm-gutter, 16px) + env(safe-area-inset-top, 0px));
        inset-inline: var(--hcm-top-start, var(--hcm-gutter, 16px)) var(--hcm-gutter, 16px);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
        inline-size: fit-content;
        max-inline-size: 560px;
        min-block-size: 56px;
        margin-inline: auto;
        padding: 4px 4px 4px 16px;
        border-radius: var(--md-sys-shape-corner-extra-large);
        background: var(--md-sys-color-surface-container);
        color: var(--md-sys-color-on-surface);
        box-shadow: var(--md-sys-elevation-level2);
        pointer-events: auto;
    }

    /* A compact window: the bar spans the map between the gutters, the toggle on its own row above the chooser. */
    :host([mode='toggle']) .bar {
        inline-size: auto;
        padding-inline-start: 4px;
    }

    :host([mode='toggle']) hcm-segmented-button {
        flex: 1 1 100%;
    }

    .side {
        font-size: var(--md-sys-typescale-label-large-size);
        font-weight: var(--md-sys-typescale-label-large-weight);
        line-height: var(--md-sys-typescale-label-large-line-height);
        overflow-wrap: anywhere;
    }

    .side hcm-icon {
        vertical-align: middle;
        margin-inline-end: 8px;
    }

    /* The chooser shrinks with the bar (its options' text is the browser's to fit), never past the map's edge. */
    select {
        flex: 1 1 auto;
        min-inline-size: 0;
        min-block-size: 48px;
        max-inline-size: 100%;
        padding-inline: 12px;
        border: 1px solid var(--md-sys-color-outline);
        border-radius: var(--md-sys-shape-corner-small);
        background: var(--md-sys-color-surface-container-highest);
        color: var(--md-sys-color-on-surface);
        font: inherit;
        font-size: var(--md-sys-typescale-body-large-size);
    }

    .credit {
        flex-basis: 100%;
        margin: 0;
        padding-block-end: 8px;
        padding-inline-end: 16px;
        color: var(--md-sys-color-on-surface-variant);
        font-size: var(--md-sys-typescale-body-small-size);
        line-height: var(--md-sys-typescale-body-small-line-height);
    }

    :host([mode='toggle']) .credit {
        padding-inline-start: 12px;
    }
`;
