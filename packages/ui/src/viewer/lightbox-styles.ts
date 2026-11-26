/**
 * Styles of `<hcm-lightbox>`: an opaque scrim over the whole viewer, the image centred, controls in its corners. The scrim
 * is dark in every theme, so nothing is drawn on it in a theme colour: the header and the error message sit on a
 * surface of their own and the arrows are tonal buttons (the e2e tour found the title, the position and the arrows
 * unreadable on the scrim in the dark and the light theme). The scrim is opaque: at 92 % the docked pane, the menu
 * button and the sheet's own copy of the photo showed through around the image (UX review). The stage's one track is
 * `minmax(0, 1fr)`, so the image's `max-block-size: 100%` resolves against the stage: with an `auto` track a landscape
 * photo on a short window (a landscape phone) overflowed the stage and was cropped instead of fitted. The title wraps
 * instead of ending in an ellipsis: with wider text spacing (WCAG 1.4.12) a phone cut it (the tour). The header is a
 * plain box, not a `header`, which would be a second page banner beside the page's own. The versions' switch (when the
 * photo has more than its original) sits on such a surface too, between the image and the arrows and zoom buttons.
 */
import { css } from 'lit';

import { baseStyles } from './shared-styles.js';

export const lightboxStyles = [
    baseStyles,
    css`
        :host {
            display: none;
        }

        :host([open]) {
            position: absolute;
            inset: 0;
            z-index: 30;
            display: block;
        }

        .lightbox {
            display: grid;
            grid-template-rows: auto 1fr auto auto;
            grid-template-columns: minmax(0, 1fr);
            block-size: 100%;
            background: var(--md-sys-color-scrim);
            color: var(--md-sys-color-inverse-on-surface);
        }

        .header {
            display: flex;
            align-items: center;
            gap: 16px;
            padding-block: 8px;
            padding-inline: 16px 8px;
            background: var(--md-sys-color-surface-container);
            color: var(--md-sys-color-on-surface);
        }

        .title {
            flex: 1;
            min-inline-size: 0;
            overflow-wrap: anywhere;
        }

        .stage {
            position: relative;
            display: grid;
            grid-template: minmax(0, 1fr) / minmax(0, 1fr);
            place-items: center;
            overflow: hidden;
            touch-action: none;
            cursor: zoom-in;
        }

        img {
            max-inline-size: 100%;
            max-block-size: 100%;
            inline-size: auto;
            block-size: auto;
            transform-origin: center;
            user-select: none;
        }

        .error {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 16px 24px;
            border-radius: var(--md-sys-shape-corner-large);
            background: var(--md-sys-color-surface-container);
            color: var(--md-sys-color-on-surface);
        }

        /* The versions' switch and credit: a surface of their own, as the header, so they read on the dark scrim. */
        .versions {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 4px 16px;
            padding: 8px 16px;
            background: var(--md-sys-color-surface-container);
            color: var(--md-sys-color-on-surface);
        }

        /* A flex item shrinks no narrower than its content by default: the switch must, so it stacks on a narrow phone. */
        .versions hcm-segmented-button {
            min-inline-size: 0;
            max-inline-size: 100%;
        }

        .nav {
            display: flex;
            justify-content: center;
            gap: 24px;
            padding: 8px;
        }

        /*
         * Tab goes from the last arrow (Next) round to Close at the top: on a 320 px window the 24 px gaps put Next under
         * Close, so the wrap read as a step back up one column (the tour at c320). 16 px keeps the row clear of Close's column.
         */
        @media (width < 360px) {
            .nav {
                gap: 16px;
            }
        }
    `,
];
