/**
 * Styles of the places page (docs/research/M2c-interfaces.md §1.2, §7): the list's head (title, Add place, the file
 * actions), filters and search, the bulk bar, rows with their check box and the category's swatch, the detail pane with
 * the map above (or beside) the editor, and the editor's sections. Built on the editing kit's styles; colours are tokens
 * only (a category's own colour fills its swatch, never text), rings stay inside their pane.
 */
import { css } from 'lit';

import { editingStyles } from '../editing/editing-styles.js';
import { mapBesideStyles } from '../editing/wide-layout.js';

export const poiStyles = [
    ...editingStyles,
    css`
        .head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        .head h2 {
            flex: 1 1 auto;
        }

        .shapes {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .bulk {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-radius: var(--md-sys-shape-corner-large, 16px);
            background: var(--md-sys-color-secondary-container, Canvas);
            color: var(--md-sys-color-on-secondary-container, CanvasText);
        }

        .bulk .count {
            flex: 1 1 auto;
        }

        .item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding-inline-start: 8px;
        }

        .item .row {
            flex: 1 1 auto;
            min-inline-size: 0;
        }

        .check {
            display: grid;
            place-items: center;
            inline-size: 48px;
            block-size: 48px;
            flex: none;
        }

        /*
         * M3's check box: an 18 px box with its own 2 px border (3:1 against the surface, non-text contrast; a native check
         * box's own drawing does not reach it), the check mark drawn inside, and a 48 px target around it.
         */
        .check input,
        .picker input {
            position: relative;
            display: grid;
            place-content: center;
            box-sizing: border-box;
            inline-size: 18px;
            block-size: 18px;
            margin: 0;
            border: 2px solid var(--md-sys-color-on-surface-variant, CanvasText);
            border-radius: 2px;
            appearance: none;
            cursor: pointer;
        }

        .check input::after,
        .picker input::after {
            position: absolute;
            inset: 50% auto auto 50%;
            inline-size: 48px;
            block-size: 48px;
            content: '';
            transform: translate(-50%, -50%);
        }

        .check input:checked,
        .picker input:checked {
            border-color: var(--md-sys-color-primary, Highlight);
            background: var(--md-sys-color-primary, Highlight);
        }

        .check input:checked::before,
        .picker input:checked::before {
            inline-size: 4px;
            block-size: 9px;
            border: solid var(--md-sys-color-on-primary, Canvas);
            border-width: 0 2px 2px 0;
            content: '';
            transform: translateY(-1px) rotate(45deg);
        }

        .check input:focus-visible {
            outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
            outline-offset: 2px;
        }

        /* A place stored without a year (Save asks for one): a small tag under its row's detail. */
        .year-missing {
            align-self: flex-start;
            padding: 0 8px;
            border-radius: var(--md-sys-shape-corner-small, 8px);
            background: var(--md-sys-color-error-container, Canvas);
            color: var(--md-sys-color-on-error-container, CanvasText);
            font-size: var(--md-sys-typescale-label-medium-size, 0.75rem);
            line-height: var(--md-sys-typescale-label-medium-line-height, 1rem);
        }

        .swatch {
            display: inline-block;
            inline-size: 12px;
            block-size: 12px;
            margin-inline-end: 8px;
            border: 1px solid var(--md-sys-color-outline, CanvasText);
            border-radius: 50%;
            vertical-align: middle;
        }

        /* 8 px above the map box: the list-detail's Back and Close keep their 48 px ring clear of it on a compact window. */
        .detail {
            display: flex;
            flex-direction: column;
            min-block-size: 100%;
            padding-block-start: 8px;
            box-sizing: border-box;
        }

        /* A chip is 32 px in a 48 px ring: wrapped rows keep 16 px apart, so no ring covers another (as the photos' filters). */
        .chips {
            row-gap: 16px;
        }

        /* A short link (History) is still a 48 x 48 target on a touch window. */
        a.external {
            justify-content: center;
            min-inline-size: 48px;
        }

        /* A city without categories: the field's name over its note and the two ways to add one (finding 35 of 2026-11-01). */
        .no-categories .label {
            font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
        }

        .no-categories .note {
            margin: 0;
        }

        hcm-admin-map {
            block-size: 45vh;
        }

        /* Without a map (no token, no WebGL, a failure) the box is its note only. */
        hcm-admin-map[no-map] {
            block-size: auto;
        }

        .form {
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        fieldset {
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-inline-size: 0;
            margin: 0;
            padding: 0;
            border: none;
        }

        legend {
            margin-block-end: 8px;
            padding: 0;
            font-size: var(--md-sys-typescale-title-medium-size, 1rem);
            font-weight: var(--md-sys-typescale-title-medium-weight, 500);
        }

        .pair {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 12px;
        }

        .field textarea {
            min-block-size: 96px;
            padding-block: 12px;
            resize: vertical;
        }

        .preview {
            padding: 12px 16px;
            border: 1px dashed var(--md-sys-color-outline-variant, CanvasText);
            border-radius: var(--md-sys-shape-corner-small, 8px);
        }

        .preview p + p {
            margin-block-start: 8px;
        }

        .link-row {
            display: grid;
            grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
            align-items: end;
            gap: 8px;
        }

        .chosen {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .chosen li {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .chosen li span {
            flex: 1 1 auto;
        }

        .editor-head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        .editor-head h2 {
            flex: 1 1 100%;
        }

        .editor-head .state {
            flex: 1 1 auto;
        }

        .picker {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .picker label {
            display: flex;
            align-items: center;
            gap: 12px;
            min-block-size: 56px;
        }

        .picker img {
            inline-size: 48px;
            block-size: 48px;
            object-fit: cover;
            border-radius: var(--md-sys-shape-corner-small, 8px);
        }

        .counts {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 0;
            padding: 0;
            list-style: none;
        }
    `,
    mapBesideStyles,
];
