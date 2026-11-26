/**
 * Styles of `<hcm-map-viewer>`. The host is a size container (`hcm-viewer`): window classes come from the viewer's own
 * box, never the browser window, so an embedded map adapts to the space it is given. The panes are a grid
 * (`data-layout` from `layoutFor`); the container queries set the gutters and pane widths of each class (M3: 16 dp on
 * compact, 24 dp from medium; supporting pane 360 px, 412 px from large; on extra-large a 360 px layers pane and a
 * 400 px detail pane). Floating controls keep a strip at the bottom of the map free for the Mapbox logo and
 * attribution (scenario V18) and respect the safe areas of notched phones. They stack with M3's 8 px between touch
 * targets: the strip, the timeline, the FAB, the "photos near this year" chip (the tour found the FAB on the timeline's
 * top edge and the timeline 2 px from the collapsed attribution on phones). A dock is only a box around its control:
 * the empty part of the toast dock and the FAB menu's let taps through to the map and the timeline.
 *
 * Inside the host, `.viewer` is a grid of one cell: the frame and the modal layer above it. The modal surfaces draw
 * above Mapbox's own logo and attribution, which move into the part of the map a modal sheet leaves in view (V18,
 * `legal-lift.ts`: `--hcm-legal-lift-*`).
 */
import { css } from 'lit';

import { dockStyles } from './dock-styles.js';
import { timelineDockStyles } from './timeline-dock-styles.js';
import { baseStyles, sheetStyles } from './shared-styles.js';

export const viewerStyles = [
    baseStyles,
    sheetStyles,
    css`
        :host {
            /* The kit's modal sheets cover the whole viewer, above the floating controls (z-index up to 26). */
            --hcm-sheet-z-index: 28;
            --hcm-gutter: 16px;

            /*
             * The strip at the foot of the map: Mapbox's collapsed attribution (24 px, 10 px from the edge; the logo is 23
             * px, 6 px from it) plus the 8 px every floating control keeps from it.
             */
            --hcm-map-chrome: 42px;

            /* M3: 8 dp between touch targets. */
            --hcm-dock-gap: 8px;

            /* The horizontal timeline's height (hcm-timeline: 8 + 48 + 28 px; standing, it is 8 + 52 + 8 px wide). */
            --hcm-timeline-block: 84px;
            --hcm-fab-size: 56px;
            --hcm-pane-leading: 360px;
            --hcm-pane-trailing: 360px;

            position: relative;
            display: block;
            box-sizing: border-box;
            inline-size: 100%;
            block-size: 100%;

            /* The shortest landscape phone with its bars is 270 px tall: a page that never scrolls (an app shell) shows it whole. */
            min-block-size: 240px;

            /*
             * clip, not hidden: a hidden box still scrolls from script (a row's scrollIntoView squeezed the app, 2026-11-16;
             * a sheet's focus scrolled the viewer by its height, which hid that Mapbox's legal line never rose: 2026-11-24).
             */
            overflow: clip;
            container: hcm-viewer / size;
            background: var(--md-sys-color-surface);
        }

        /*
         * Ten feet away (docs/research/viewer-input.md §6): a large screen without a fine pointer (a TV's browser, a games
         * console) gets a focus ring twice as thick, the kit's buttons and chips 48 px (M3's target, seen and not only
         * touched) and its text a quarter larger, read from across the room. The type tokens are set on the host by
         * applyTheme, so the larger ones go on the wrapper inside it.
         */
        @media (width >= 1200px) and (pointer: coarse), (width >= 1200px) and (pointer: none) {
            :host {
                --hcm-focus-ring-width: 6px;
                --hcm-control-size: 48px;
                --hcm-chip-size: 48px;
            }

            .viewer {
                --md-sys-typescale-label-small-size: 14px;
                --md-sys-typescale-label-large-size: 18px;
                --md-sys-typescale-label-large-line-height: 24px;
                --md-sys-typescale-body-small-size: 15px;
                --md-sys-typescale-body-small-line-height: 20px;
                --md-sys-typescale-body-medium-size: 18px;
                --md-sys-typescale-body-medium-line-height: 24px;
                --md-sys-typescale-body-large-size: 20px;
                --md-sys-typescale-body-large-line-height: 28px;
                --md-sys-typescale-title-small-size: 18px;
                --md-sys-typescale-title-small-line-height: 24px;
                --md-sys-typescale-title-medium-size: 20px;
                --md-sys-typescale-title-medium-line-height: 28px;
            }
        }

        /* A wrapper, not the host, is the grid: a page may set the element's own display (display: block). */
        .viewer {
            position: relative;
            display: grid;
            grid-template-rows: minmax(0, 1fr);
            grid-template-columns: minmax(0, 1fr);
            block-size: 100%;
        }

        /*
         * The modal surfaces' containing block; it lets pointers through to the map where no surface is open. Above the frame and everything in it, Mapbox's controls included (their z-index 2 drew the credits over the
         * lightbox, whose own z-index is auto: the Pixel 9 Pro review, P3) and the floating controls (z-index up to 26).
         */
        .modal-layer {
            position: relative;
            z-index: 30;
            grid-area: 1 / 1 / 2 / 2;
            pointer-events: none;
        }

        .modal-layer > * {
            pointer-events: auto;
        }

        /*
         * The date menu's host spans the viewer and lets pointers through (its scrim and its menu take them): its peek is not
         * modal, and the rule above, outside its shadow root, would beat its own \`:host\` (lesson 675: the peek's host took
         * every press over the map).
         */
        .modal-layer > hcm-date-menu {
            pointer-events: none;
        }

        /*
         * The standard Layers sheet leaves the map visible and usable, with no scrim (the owner, 2026-11-15); the floating
         * controls it would cover (and the skip link to the timeline) step aside while it is open, so none sits under it,
         * reachable by Tab but not seen. Mapbox's legal line stays and rises above the sheet (below).
         */
        .frame[data-layers-sheet]
            :is(.skip, .dock.chip, .dock.compass, .dock.locate, .dock.shot, .dock.zoom, .dock.timeline, .dock.timeline-note, .dock.menu) {
            visibility: hidden;
        }

        /*
         * Mapbox's bottom corners move out from under an open modal sheet: above a bottom sheet's top edge, beside a side
         * sheet (the Pixel 9 Pro review, P3: a copy of the credits in a bar took the foot of every sheet). Under a modal
         * sheet's scrim they stay in view, as the rest of the map does; beside the standard Layers sheet they stay usable.
         */
        .frame .mapboxgl-ctrl-bottom-left,
        .frame .mapboxgl-ctrl-bottom-right {
            bottom: var(--hcm-legal-lift-bottom, 0);
        }

        .frame .mapboxgl-ctrl-bottom-left {
            left: var(--hcm-legal-lift-left, 0);
        }

        .frame .mapboxgl-ctrl-bottom-right {
            right: var(--hcm-legal-lift-right, 0);
        }

        /*
         * Mapbox's attribution is white in every theme: its toggle and links take a ring that is dark on white in both
         * schemes, the light scheme's primary (the dark scheme's inverse primary). The dark scheme's secondary, a light
         * tone, measured 1.71:1 on the collapsed attribution's toggle (the tour).
         */
        .mapboxgl-ctrl-attrib :focus-visible {
            outline-color: light-dark(var(--md-sys-color-primary), var(--md-sys-color-inverse-primary));
        }

        /*
         * Mapbox's box hides its overflow, and the canvas fills it: the canvas's ring is drawn inside it, or none of it
         * showed (the tour's ring check found the map's focus invisible). The full attribution sits in the box's corner
         * with no space below its links: they take a ring without offset, and the attribution the 3 px it needs.
         */
        .mapboxgl-canvas:focus-visible {
            outline-offset: calc(-1 * var(--hcm-focus-ring-width, 3px));
        }

        .mapboxgl-ctrl-attrib:not(.mapboxgl-compact) {
            padding-block: var(--hcm-focus-ring-width, 3px);
        }

        /* Mapbox's logo sits 6 px from the box's foot: a TV's 6 px ring comes 1 px in, or the box cut it (the tour). */
        .mapboxgl-ctrl-logo:focus-visible {
            outline-offset: calc(5px - var(--hcm-focus-ring-width, 3px));
        }

        .mapboxgl-ctrl-attrib a:focus-visible {
            outline-offset: 0;
        }

        @container hcm-viewer (width >= 600px) {
            .frame {
                --hcm-gutter: 24px;
            }
        }

        @container hcm-viewer (width >= 1200px) {
            .frame {
                --hcm-pane-trailing: 412px;
            }
        }

        @container hcm-viewer (width >= 1600px) {
            .frame {
                --hcm-pane-trailing: 400px;
            }
        }

        .frame {
            display: grid;
            grid-area: 1 / 1 / 2 / 2;
            grid-template-columns: minmax(0, 1fr);
            block-size: 100%;
        }

        .frame[data-panes='leading'] {
            grid-template-columns: var(--hcm-pane-leading) minmax(0, 1fr);
        }

        .frame[data-panes='trailing'] {
            grid-template-columns: minmax(0, 1fr) var(--hcm-pane-trailing);
        }

        .frame[data-panes='both'] {
            grid-template-columns: var(--hcm-pane-leading) minmax(0, 1fr) var(--hcm-pane-trailing);
        }

        .pane {
            min-inline-size: 0;
            overflow: hidden;
        }

        /*
         * The photo list's wrapper draws no box (as the other sheets' hosts): docked, its sheet is as tall as the pane and
         * its body scrolls. As a block it grew with the list past the pane, which hides its overflow, so the photos
         * below the fold were out of reach (the tour, from expanded up). The stories' wrapper did the same: with a reader's
         * text spacing a story grew past the 1024 x 768 pane and "All stories" was cut off at its foot (the tour, e1024).
         */
        .photos-sheet,
        .unplaced-sheet,
        .stories-sheet {
            display: contents;
        }

        /*
         * The minimized Layers pane (extra-large) is one floating button on the map's leading edge: the map takes the whole width
         * (its ResizeObserver resizes Mapbox), and the top docks begin after the button.
         */
        .frame:has(> .pane.leading > [minimized]) {
            --hcm-pane-leading: 0px;
            --hcm-top-start: calc(var(--hcm-gutter) + 152px);
        }

        /* The floating button lies outside the empty column: its pane must not clip it (the tour: off screen, its focus ring cut). */
        .pane.leading:has(> [minimized]) {
            overflow: visible;
        }

        .pane.leading .docked {
            border-inline: 0 1px solid var(--md-sys-color-outline-variant);
        }

        .map-pane {
            position: relative;
            min-inline-size: 0;
            overflow: hidden;
        }

        /*
         * A long press on the map opens the map's menu (map-menu-trigger.ts): it never selects a label or the credits,
         * nor offers the browser's touch callout or Touch to Search (the Pixel 9 Pro review, P4).
         */
        .map {
            position: absolute;
            inset: 0;
            user-select: none;
            -webkit-touch-callout: none;
        }

        .skip {
            position: absolute;
            inset-block-start: 8px;
            inset-inline-start: var(--hcm-top-start, 8px);
            z-index: 40;
            min-block-size: 48px;
            padding-inline: 16px;
            border: 0;
            border-radius: var(--md-sys-shape-corner-full);
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            font: inherit;
            transform: translateY(-200%);
        }

        .skip:focus-visible {
            transform: none;
        }

        /* With the Layers pane docked on the leading side the skip link shows over the map, not over the pane's heading. */
        .frame[data-panes='leading'] .skip,
        .frame[data-panes='both'] .skip {
            inset-inline-start: calc(var(--hcm-pane-leading) + 8px);
        }

        .status {
            position: absolute;
            inset: 0;
            z-index: 5;
            display: grid;
            place-items: center;
            box-sizing: border-box;
            padding: var(--hcm-gutter);
            overflow: auto;
            background: var(--md-sys-color-surface);
        }

        .skeleton {
            display: grid;
            justify-items: center;
            gap: 16px;
        }

        .skeleton .shimmer {
            inline-size: min(320px, 70cqi);
            block-size: 12px;
            border-radius: 6px;
            background: linear-gradient(
                90deg,
                var(--md-sys-color-surface-container-high),
                var(--md-sys-color-surface-container-highest),
                var(--md-sys-color-surface-container-high)
            );
            background-size: 200% 100%;
            animation: hcm-shimmer 1.4s linear infinite;
        }

        @keyframes hcm-shimmer {
            to {
                background-position: -200% 0;
            }
        }

        /* Without WebGL the photo list scrolls under the menu button: its last row can scroll clear of it. */
        .fallback {
            display: flex;
            flex-direction: column;
            gap: 16px;
            inline-size: min(560px, 100%);
            align-self: start;
            padding-block-end: calc(var(--hcm-map-chrome) + var(--hcm-fab-size) + var(--hcm-dock-gap));
        }

        @media (prefers-reduced-motion: reduce) {
            .skeleton .shimmer {
                animation: none;
            }
        }
    `,
    dockStyles,
    timelineDockStyles,
];
