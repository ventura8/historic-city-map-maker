/**
 * The georeferencer's styles (`docs/research/M3-interfaces.md` §10.4): the scan and the map side by side from medium
 * windows (one under a Scan | Map switch on compact ones), the tools above them, the residual table below (it fits its
 * width: narrow, its pixel and place columns give way), and radio rows for the transform.
 */
import { css } from 'lit';

import { visuallyHidden } from '../../components/styles.js';
import { editingStyles } from '../editing/editing-styles.js';

export const georefStyles = [
    ...editingStyles,
    visuallyHidden,
    css`
        :host {
            display: flex;
            flex-direction: column;
            block-size: 100%;
            min-block-size: 0;
            overflow-y: auto;
        }

        .page {
            display: flex;
            flex-direction: column;
            gap: 16px;
            box-sizing: border-box;
            padding: 16px;
        }

        /* The scan and the map share one grid's rows (subgrid): a pane's header (the map's list of what it shows), the view,
           the turn buttons and the note. Both views keep the same top, height and width share whatever one pane shows above
           or below them (the owner's report of 2026-11-13: the map's list pushed the map 80 px below the scan). */
        .panes {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            grid-template-rows: auto minmax(0, 1fr) auto auto;
            gap: 8px 12px;

            /* M22 (§13.2): room to work, about seven tenths of the window and never under 420 px. */
            block-size: max(420px, 70vh);
        }

        /* Compact: one pane at a time under the Scan | Map switch, both in the same cell, so switching keeps the view in place. */
        .panes[data-compact] {
            grid-template-columns: minmax(0, 1fr);
            block-size: max(320px, 70dvh);
        }

        /* Full screen: the page covers the window, its actions first, the scan and the map taking the rest of its height. */
        .page[data-full] {
            position: fixed;
            inset: 0;
            z-index: 20;
            overflow-y: auto;
            background: var(--md-sys-color-surface, Canvas);
        }

        .page[data-full] .panes {
            block-size: max(320px, calc(100dvh - 200px));
        }

        .scan-pane,
        .map-pane {
            display: grid;
            grid-row: 1 / -1;
            grid-template-rows: subgrid;
            min-block-size: 0;
            min-inline-size: 0;
        }

        .panes[data-compact] .scan-pane,
        .panes[data-compact] .map-pane {
            grid-column: 1;
        }

        .panes[data-compact][data-pane='scan'] .map-pane,
        .panes[data-compact][data-pane='map'] .scan-pane {
            visibility: hidden;
        }

        /* The map's list on one 48 px row beside its label (it wraps under it on a narrow pane). */
        .shows {
            grid-row: 1;
            flex-flow: row wrap;
            align-items: center;
            gap: 4px 8px;
            min-inline-size: 0;
        }

        /* The list takes the row's rest and shrinks with a narrow pane (a long layer name scrolled a phone sideways). */
        .shows select {
            flex: 1 1 12rem;
            max-inline-size: 100%;
        }

        hcm-scan-viewer,
        hcm-admin-map {
            grid-row: 2;
            min-block-size: 0;
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            overflow: hidden;
        }

        .scan-pane > .turn,
        .map-pane > .turn {
            grid-row: 3;
        }

        .scan-pane > p.note,
        .map-pane > p.note {
            grid-row: 4;
            margin: 0;
        }

        /* A version without a scan says so where the scan would be. */
        .scan-pane > p.note[data-state='no-scan'] {
            grid-row: 2;
        }

        .guide {
            max-inline-size: 72ch;
        }

        /* A 48 px touch target on a compact window (the context menu's tour state found it 19 px tall). */
        .guide summary {
            box-sizing: border-box;
            min-block-size: 48px;
            padding-block: 12px;
            cursor: pointer;
            font: var(--md-sys-typescale-title-small-font, 500 0.875rem/1.25rem system-ui);
        }

        .transforms {
            display: flex;
            flex-wrap: wrap;
            gap: 4px 16px;
            margin: 0;
            padding: 0;
            border: none;
        }

        .transforms label,
        .use {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            min-block-size: 48px;
        }

        /* The transform's radios and the fit's checkboxes drawn like the kit's: a 2 px border that reads against the
           page (a native one reached 1:1, CR-M3-35 i), and the 48 px square around each takes the pointer. */
        .transforms input,
        .use input {
            position: relative;
            display: grid;
            flex: none;
            place-content: center;
            box-sizing: border-box;
            inline-size: 20px;
            block-size: 20px;
            margin: 0;
            border: 2px solid var(--md-sys-color-on-surface-variant, CanvasText);
            border-radius: var(--md-sys-shape-corner-full, 50%);
            appearance: none;
            cursor: pointer;
        }

        .use input {
            inline-size: 18px;
            block-size: 18px;
            border-radius: 2px;
        }

        .transforms input::after,
        .use input::after {
            position: absolute;
            inset: 50% auto auto 50%;
            inline-size: 48px;
            block-size: 48px;
            content: '';
            transform: translate(-50%, -50%);
        }

        .transforms input:checked,
        .use input:checked {
            border-color: var(--md-sys-color-primary, Highlight);
        }

        .transforms input:checked::before {
            inline-size: 10px;
            block-size: 10px;
            border-radius: var(--md-sys-shape-corner-full, 50%);
            background: var(--md-sys-color-primary, Highlight);
            content: '';
        }

        .use input:checked {
            background: var(--md-sys-color-primary, Highlight);
        }

        .use input:checked::before {
            inline-size: 12px;
            block-size: 12px;
            background: var(--md-sys-color-on-primary, Canvas);
            clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0, 43% 62%);
            content: '';
        }

        .transforms input:disabled,
        .use input:disabled {
            border-color: color-mix(in srgb, var(--md-sys-color-on-surface, CanvasText) 38%, transparent);
            cursor: default;
        }

        .transforms input:focus-visible,
        .use input:focus-visible {
            outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
            outline-offset: 2px;
        }

        @media (forced-colors: active) {
            .transforms input:checked,
            .use input:checked {
                border-color: Highlight;
            }

            .transforms input:checked::before,
            .use input:checked::before {
                background: Highlight;
                forced-color-adjust: none;
            }
        }

        .transforms [data-missing] {
            color: var(--md-sys-color-on-surface-variant, GrayText);
        }

        table.residuals .origin {
            display: block;
            padding-inline: 8px;
            font-weight: normal;
        }

        /* The selected row's controls in the row's own colours: on its container, on-surface-variant (Delete, the
           checkbox's border) and primary (a ticked checkbox) read 2:1 in high contrast, where containers are dark. */
        table.residuals tr[data-selected] .use input {
            --md-sys-color-primary: var(--md-sys-color-on-secondary-container, HighlightText);
            --md-sys-color-on-primary: var(--md-sys-color-secondary-container, Highlight);
        }

        table.residuals {
            inline-size: 100%;
            border-collapse: collapse;
            font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
        }

        /* A cell wraps only when the table would not fit otherwise: a place over two lines after its comma, "Perechea"
           over its number, a residual's "m" under a long number (six pairs a kilometre off under a reader's text
           spacing ran 68 px past a tablet's table with every cell on one line; CR-M3-47). */
        table.residuals th,
        table.residuals td {
            padding: 4px 8px;
            text-align: start;
            border-block-end: 1px solid var(--md-sys-color-outline-variant, GrayText);
        }

        /* The table fits its box (nothing scrolls sideways, WCAG 1.4.10): narrow, the pixel and place columns give way
           and the cells keep 4 px aside. After the cells' own rule, which it overrides at the same specificity (written
           before it, it never applied; CR-M3-47). */
        .table-box {
            container-type: inline-size;
        }

        @container (inline-size < 560px) {
            table.residuals .position {
                display: none;
            }

            table.residuals th,
            table.residuals td {
                padding-inline: 4px;
            }
        }

        table.residuals tr[data-selected] {
            background: var(--md-sys-color-secondary-container, Highlight);
            color: var(--md-sys-color-on-secondary-container, HighlightText);

            /* The selected row's controls in its own colours (the checkbox's rule above says why). */
            --md-sys-color-on-surface-variant: var(--md-sys-color-on-secondary-container, HighlightText);
        }

        button.sort,
        button.pair {
            min-block-size: 48px;
            min-inline-size: 48px;
            padding: 0 8px;
            border: none;
            border-radius: var(--md-sys-shape-corner-small, 8px);
            background: none;
            color: inherit;
            font: inherit;
            font-weight: var(--md-sys-typescale-title-small-weight, 500);
            cursor: pointer;
        }

        button.sort:focus-visible,
        button.pair:focus-visible {
            outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
            outline-offset: -3px;
        }

        .summary {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 16px;
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
            align-items: center;
            gap: 8px;
        }

        .slider-row hcm-slider {
            grid-column: 1 / -1;
        }
    `,
];
