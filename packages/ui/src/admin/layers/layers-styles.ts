/**
 * Styles of the layers and settings pages beyond the editing kit's (`../editing/editing-styles.ts`): the slider rows,
 * the editor's save bar, the banners with actions, the reorderable rows with their drag handle and Move buttons, the
 * sections of an editor, and the visually hidden live region. Rings stay inside the panes (a pane scrolls).
 */
import { css } from 'lit';

import { touchTarget, visuallyHidden } from '../../components/styles.js';
import { editingStyles } from '../editing/editing-styles.js';
import { paneMapBesideStyles } from '../editing/wide-layout.js';

export const layersStyles = [
    ...editingStyles,
    visuallyHidden,
    touchTarget,
    css`
        .layer-map {
            block-size: clamp(240px, 40vh, 420px);
        }

        /* The pending version's chip is a link: its 48 px target reaches past the 32 px chip (CR-M3-7, M3's targets). */
        a.tag.touch-target {
            position: relative;
        }

        /* Without a map (no token, no WebGL, a failure) the box is its note only. */
        .layer-map[no-map] {
            block-size: auto;
        }

        section.group {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .fields {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
            gap: 12px 16px;
        }

        /*
         * Romanian beside English, never a third column: on a wide pane the auto-fit grid put the Romanian description beside
         * the two names and the English one under them (the visual audit of 2026-10-18). At least half the row each.
         */
        .fields.pairs {
            grid-template-columns: repeat(auto-fit, minmax(min(100%, max(220px, calc((100% - 16px) / 2))), 1fr));
        }

        .field textarea {
            padding-block: 12px;
            resize: vertical;
        }

        .switch-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            min-block-size: 48px;
        }

        .slider-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            grid-template-areas:
                'label value'
                'slider slider';
            gap: 0 12px;
            align-items: center;
        }

        .slider-label {
            grid-area: label;
        }

        .slider-value {
            grid-area: value;
            min-inline-size: 4em;
            color: var(--md-sys-color-on-surface-variant, CanvasText);
            text-align: end;
        }

        hcm-slider {
            grid-area: slider;
        }

        .save-bar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 8px 16px;
        }

        .alert-body {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-inline-size: 0;

            /* A text button on the error container takes the container's own text colour (primary has too little contrast). */
            --md-sys-color-primary: var(--md-sys-color-on-error-container, CanvasText);
        }

        .alert-body ul {
            margin: 0;
            padding-inline-start: 20px;
        }

        .alert-body li a {
            display: inline-flex;
            align-items: center;
            min-block-size: 48px;
        }

        .reorder-row {
            display: grid;
            grid-template-columns: 48px minmax(0, 1fr) auto;
            align-items: center;
            gap: 8px;
            border-radius: var(--md-sys-shape-corner-large, 16px);
        }

        /* A row with a lead (a category's swatch): the swatch beside both lines, centred, as an M3 list item's leading
           element; inline in the title it pushed the name to a second line on a phone and left its detail under it. */
        .row[data-lead] {
            display: grid;
            grid-template-columns: 40px minmax(0, 1fr);
            column-gap: 16px;
            align-items: center;
        }

        .row[data-lead] > :first-child {
            grid-row: 1 / span 2;
        }

        .row[data-lead] > .row-title,
        .row[data-lead] > .row-detail {
            grid-column: 2;
        }

        /* A read-only page's rows are links only (no handle, no Move buttons). */
        .reorder-row[data-read-only] {
            grid-template-columns: minmax(0, 1fr);
        }

        .reorder-row[data-drop] {
            box-shadow: inset 0 3px 0 var(--md-sys-color-primary, Highlight);
        }

        .reorder-row[data-dragging] {
            opacity: 0.6;
        }

        .handle {
            display: grid;
            place-items: center;
            inline-size: 48px;
            block-size: 48px;
            color: var(--md-sys-color-on-surface-variant, CanvasText);
            cursor: grab;
            touch-action: none;
        }

        /* 40 px icon buttons 8 px apart: each keeps its whole 48 px touch target. */
        .moves {
            display: flex;
            gap: 8px;
        }

        .swatch {
            display: inline-grid;
            place-items: center;
            inline-size: 40px;
            block-size: 40px;
            border-radius: var(--md-sys-shape-corner-full, 50%);
            background: var(--swatch, var(--md-sys-color-secondary-container));
            color: var(--swatch-glyph, var(--md-sys-color-on-secondary-container));

            --hcm-icon-size: 22px;
        }

        @media (forced-colors: active) {
            .swatch {
                border: 1px solid CanvasText;
            }
        }
    `,
    paneMapBesideStyles,
];
