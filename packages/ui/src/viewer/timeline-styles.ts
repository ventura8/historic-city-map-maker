/**
 * Styles of `<hcm-timeline>`. The thumb is the hero moment: a pill that morphs into a rounded square and grows while
 * it is dragged, on the M3 Expressive "fast spatial" spring converted for the web (cubic-bezier(0.42, 1.67, 0.21,
 * 0.9), 350 ms); `prefers-reduced-motion: reduce` turns every transition off. The horizontal timeline is exactly 84 px
 * tall (8 + 48 + 28) and the vertical one 68 px wide (8 + 52 + 8): the viewer docks its FAB and chip with those numbers
 * (`--hcm-timeline-block`, `--hcm-top-start`). The pill never hides another year's label (the owner's phone,
 * 2026-11-08: "1980" over 1979 and 1982): lying, the labels are a row below it; standing, the years are the ruler in
 * the pill's lane, whose stops the phone's height spaces wider than the pill. The list of stops has no margin of its own: the
 * browser's 1em of an `ol` collapsed through the track, made the timeline 100 px tall with a 16 px page font and more
 * with a larger one, and left no room for the open FAB menu above it on a 568 px phone. The card holds a scroller with
 * the padding: the track is exactly 40 px per gap (`--hcm-year-gap`, `YEAR_GAP_PX`) at every width, from the leading
 * edge, never stretched to the card (the owner, 2026-11-14: "way nuked"); where it is longer than the card (`density`,
 * `timeline-model.ts`) the card scrolls, under a finger too, behind a mask that fades the edge with more years beyond (`--hcm-fade-start`, `-end`).
 * Each edge with years beyond carries a 48 px button over the fade that pages that way and names the furthest year
 * (`.edge`, `timeline-edges.ts`). Lying, every year is a label and a dot on the rail (the owner, 2026-11-14), the selected
 * year's dot bigger, on the pill's lower edge; standing, labels only. The labels are 13 px lying and 14 px (M3 label large)
 * standing or on a compact window (the owner, 2026-11-14: "bigger year labels"); the selected one is the pill.
 * A year with several dates has a badge on its point (V13); on a phone, idle, the card collapses to its pill (V12).
 * The year chip (`.tip`) is a chip outside the scroller, so the card's mask never clips it. Every chip (the year chip, the
 * pill, the badge) takes theme roles that are light in the light theme and dark in the dark one: a container role on its
 * own role's text, never `primary`, `error` or the inverse surface, whose dark-theme tones are light (lesson 'chips in the
 * dark'); nothing relies on the browser's darkening of the page.
 */
import { css } from 'lit';

import { touchTarget, visuallyHidden } from '../components/styles.js';
import { baseStyles } from './shared-styles.js';
import { timelineExtraStyles } from './timeline-extra-styles.js';

export const timelineStyles = [
    baseStyles,
    // The thumb is 40 px tall; its touch target is 48 × 48 px (the tour checks every target on compact).
    touchTarget,
    // The polite live region that says the year a drag or a scrub ended on.
    visuallyHidden,
    css`
        :host {
            --hcm-timeline-spring: cubic-bezier(0.42, 1.67, 0.21, 0.9);

            /* What centres a stop or the thumb on its place: right to left, inline-start is the right edge. */
            --hcm-x: -50%;

            /* The year chip is placed against the card (timeline-tip.ts). */
            position: relative;
            display: block;
            box-sizing: border-box;
            border-radius: var(--md-sys-shape-corner-extra-large, 28px);
            background: var(--md-sys-color-surface-container, Canvas);
            box-shadow: 0 4px 12px color-mix(in srgb, var(--md-sys-color-shadow, CanvasText) 30%, transparent);
            touch-action: none;
            user-select: none;
        }

        :host(:dir(rtl)) {
            --hcm-x: 50%;
        }

        /*
         * The card's touch-action reaches the track: the scroller is a scroll container, where a browser stops looking up
         * for touch-action, so without it a finger on the track panned and cancelled the scrub (lesson 642).
         */
        .scroller,
        .track {
            touch-action: inherit;
        }

        .scroller {
            --hcm-fade-to: to right;

            box-sizing: border-box;
            padding-block: 8px 28px;
            padding-inline: 44px;
            border-radius: inherit;

            /* One row of years scrolls sideways only (the tour's sideways check leaves such a row out). */
            overflow: auto hidden;
            scrollbar-width: none;
        }

        :host([orientation='vertical']) {
            block-size: 100%;
        }

        :host([orientation='vertical']) .scroller {
            --hcm-fade-to: to bottom;

            block-size: 100%;
            padding: 24px 8px;
            overflow: hidden auto;
        }

        /* The years are a fixed --hcm-year-gap apart (set with --hcm-gaps by hcm-timeline.ts), whatever the card's size. */
        .track {
            position: relative;
            inline-size: calc(var(--hcm-gaps) * var(--hcm-year-gap));
            block-size: 48px;
            cursor: pointer;
        }

        /*
         * Years longer than the card at 40 px apart (the owner, 2026-11-14: "too crowded"): every one labelled, the card
         * scrolls; a finger may scroll it along the
         * timeline (it drags the thumb itself), and the edge with more years beyond fades.
         */
        :host([density='scroll']) {
            touch-action: pan-x;
        }

        :host([density='scroll'][orientation='vertical']) {
            touch-action: pan-y;
        }

        /* A mouse drags the years along a scrolling card (timeline-pan.ts); a finger keeps scrolling it natively. */
        @media (pointer: fine) {
            :host([density='scroll']) .track {
                cursor: grab;
            }

            :host([density='scroll']) .scroller[data-panning] .track {
                cursor: grabbing;
            }
        }

        :host([density='scroll']) .scroller {
            mask-image: linear-gradient(
                var(--hcm-fade-to),
                transparent,
                CanvasText var(--hcm-fade-start, 0%),
                CanvasText calc(100% - var(--hcm-fade-end, 0%)),
                transparent
            );
        }

        :host([density='scroll']:dir(rtl)) .scroller {
            --hcm-fade-to: to left;
        }

        /* No margin, padding or marker: the stops are placed on the track, the list only holds them. */
        .stops {
            all: unset;
        }

        :host([orientation='vertical']) .track {
            inline-size: 52px;
            block-size: calc(var(--hcm-gaps) * var(--hcm-year-gap));
        }

        .rail,
        .active {
            position: absolute;
            inset-inline: 0;
            inset-block-start: 22px;
            block-size: 4px;
            border-radius: 2px;
            background: var(--md-sys-color-secondary-container, GrayText);
        }

        .active {
            inset-inline-end: auto;
            inline-size: var(--hcm-position);
            background: var(--md-sys-color-primary, Highlight);
            transition: inline-size 350ms var(--hcm-timeline-spring);
        }

        :host([orientation='vertical']) .rail,
        :host([orientation='vertical']) .active {
            inset-block: 0;
            inset-inline-start: 24px;
            inline-size: 4px;
            block-size: auto;
        }

        :host([orientation='vertical']) .active {
            inset-block-start: auto;
            block-size: var(--hcm-position);
            transition-property: block-size;
        }

        .stop {
            position: absolute;
            inset-inline-start: var(--hcm-stop);
            inset-block-start: 20px;
            transform: translateX(var(--hcm-x));
            display: flex;
            flex-direction: column;
            align-items: center;

            /* The label's row begins below the pill (4 to 44 px) and the rail, not beside them (no tick holds it down). */
            padding-block-start: 28px;
            font-size: 13px;
            line-height: 16px;
            color: var(--md-sys-color-on-surface-variant, GrayText);
            white-space: nowrap;
        }

        /* Standing, a year is its own mark on the rail, which its label's ground interrupts. */
        :host([orientation='vertical']) .stop {
            inset-inline: 0;
            inset-block: auto var(--hcm-stop);
            padding-block-start: 0;
            transform: translateY(50%);
        }

        /* The pill names the selected year; standing, a year under the pill has no label (no dot or tick either). */
        .stop.selected .label,
        .stop.minor .label {
            visibility: hidden;
        }

        :host([orientation='vertical']) .label {
            padding-block: 2px;
            background: var(--md-sys-color-surface-container, Canvas);
        }

        .thumb {
            position: absolute;
            inset-inline-start: var(--hcm-position);
            inset-block-start: 4px;
            transform: translateX(var(--hcm-x));
            display: grid;
            place-items: center;
            box-sizing: border-box;
            min-inline-size: 64px;
            block-size: 40px;
            padding-inline: 12px;
            border: 2px solid var(--md-sys-color-primary, Highlight);
            border-radius: var(--md-sys-shape-corner-full, 9999px);
            background: var(--md-sys-color-primary-container, Canvas);
            color: var(--md-sys-color-on-primary-container, CanvasText);
            font-weight: 600;
            cursor: grab;
            transition: 350ms var(--hcm-timeline-spring);
            transition-property: inset-inline-start, inset-block-end, border-radius, transform;

            /* The thumb drags under a finger also where the card scrolls. */
            touch-action: none;

            /* A long press opens the opacity card (long-press.ts): no iOS callout or text selection over it. */
            -webkit-touch-callout: none;
            user-select: none;
        }

        :host([orientation='vertical']) .thumb {
            inset-inline-start: 0;
            inset-block: auto var(--hcm-position);
            min-inline-size: 100%;
            padding: 0;
            transform: translateY(50%);
        }

        :host([dragging]) .thumb {
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            transform: translateX(var(--hcm-x)) scale(1.12);
            cursor: grabbing;
        }

        :host([dragging][orientation='vertical']) .thumb {
            transform: translateY(50%) scale(1.12);
        }

        /*
         * V13: a year with several dates has a badge on its point, the count in a 16 px M3 badge (error colours, as M3's)
         * above its year (standing, at the lane's end beside its label); the selected year's is on the pill's corner.
         */
        .badge {
            position: absolute;
            display: grid;
            place-items: center;
            box-sizing: border-box;
            min-inline-size: 16px;
            block-size: 16px;
            padding-inline: 4px;
            border-radius: 8px;
            background: var(--md-sys-color-error-container, Mark);
            color: var(--md-sys-color-on-error-container, MarkText);
            font-size: 11px;
            font-weight: 600;
            line-height: 1;
            visibility: visible;

            /* A hint only (V13): a press through it lands on the year's point or the thumb, which select the year. */
            pointer-events: none;
            z-index: 1;
        }

        /* Past the pill's 2 px edge, as far out as before it had one. */
        .thumb .badge {
            inset-block-start: -8px;
            inset-inline-end: -8px;
        }

        .stop .badge {
            inset-block-start: -4px;
            inset-inline-start: 50%;
            transform: translateX(var(--hcm-x));
        }

        :host([orientation='vertical']) .stop .badge {
            inset-block-start: 50%;
            inset-inline: auto -6px;
            transform: translateY(-50%);
        }

        /*
         * V12: on a phone, idle, the card is only the pill of its year, the rail and the years hidden; the viewer docks it
         * (timeline-dock.ts). A tap on it opens the whole card again. The owner (2026-11-13: "too small") asked for a bigger
         * one: a 56 px pill in 4 px of card (64 px tall), the year in M3 title large, 20 px either side of it.
         */
        :host([collapsed][orientation]) {
            inline-size: max-content;
            block-size: auto;
            touch-action: manipulation;
        }

        :host([collapsed][orientation]) .scroller {
            block-size: auto;
            padding: 4px;
            overflow: visible;
            mask-image: none;
        }

        :host([collapsed][orientation]) .track {
            inline-size: auto;
            min-inline-size: 0;
            block-size: 56px;
            min-block-size: 0;
        }

        :host([collapsed][orientation]) :is(.rail, .active, .stops) {
            display: none;
        }

        :host([collapsed][orientation]) .thumb {
            position: relative;
            inset: auto;
            min-inline-size: 88px;
            block-size: 56px;
            padding-inline: 20px;
            font-size: var(--md-sys-typescale-title-large-size, 1.375rem);
            line-height: var(--md-sys-typescale-title-large-line-height, 1.75rem);
            transform: none;
            transition: none;
        }

        /* Standing, the pill is a fixed 96 px (88 px of year in 4 px of card), so the chip under it stays on its axis (lesson 697). */
        :host([collapsed][orientation='vertical']) .thumb {
            inline-size: 88px;
            padding-inline: 0;
            justify-content: center;
            text-align: center;
        }

        /*
         * The year chip: a chip of the small corner, placed by placeTip over the card lying and beside it standing; it never
         * takes the pointer. The owner (2026-11-13) asked for it bigger everywhere, to read easily above a finger: the year in
         * M3 title medium, 40 px tall, 16 px either side. It follows the theme (the owner's Android in dark, 2026-11-13: the
         * chips were light): the highest surface container with its outline and the level-2 shadow, never the inverse surface,
         * which M3 makes light in the dark theme.
         */
        .tip {
            position: absolute;
            z-index: 1;
            box-sizing: border-box;
            min-block-size: 40px;
            padding: 8px 16px;
            border: 1px solid var(--md-sys-color-outline-variant, CanvasText);
            border-radius: var(--md-sys-shape-corner-small, 8px);
            background: var(--md-sys-color-surface-container-highest, Canvas);
            color: var(--md-sys-color-on-surface, CanvasText);
            box-shadow: var(--md-sys-elevation-level2, none);
            font-size: var(--md-sys-typescale-title-medium-size, 1rem);
            font-weight: 600;
            line-height: 24px;
            white-space: nowrap;
            pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
            .active,
            .thumb {
                transition: none;
            }
        }

        /* Forced colours (Windows contrast themes): the system's own pair, a chip's edge in its text colour. */
        @media (forced-colors: active) {
            .thumb,
            .tip {
                border: 2px solid ButtonText;
                background: ButtonFace;
                color: ButtonText;
            }

            .badge {
                outline: 1px solid CanvasText;
                background: Mark;
                color: MarkText;
                forced-color-adjust: none;
            }
        }
    `,
    timelineExtraStyles,
];
