/**
 * Styles of the photos page (`docs/research/M2c-interfaces.md` §1.2, §6): the list's rows with their thumbnail, check
 * box and chips (each row rendered only near the visible part of the pane: `content-visibility`, so a long list stays
 * light without cutting text under WCAG text spacing), the drop zone, the uploads, the editor's map and its form. Built
 * on the editing kit's styles; colours are tokens only, rings stay inside their pane.
 */
import { css } from 'lit';

import { editingStyles } from '../editing/editing-styles.js';
import { mapBesideStyles } from '../editing/wide-layout.js';

export const photoStyles = [
    ...editingStyles,
    css`
        .toolbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        .toolbar h2 {
            flex: 1 1 auto;
        }

        /* A chip is 32 px in a 48 px ring: wrapped rows keep 16 px apart, so no ring covers another. */
        .filters {
            row-gap: 16px;
        }

        .search {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
        }

        .years {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }

        .drop {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px 16px;
            border: 2px dashed var(--md-sys-color-outline-variant, CanvasText);
            border-radius: var(--md-sys-shape-corner-large, 16px);
        }

        .drop[data-over] {
            border-color: var(--md-sys-color-primary, Highlight);
            background: color-mix(in srgb, var(--md-sys-color-primary, Highlight) 8%, transparent);
        }

        .file-input {
            position: absolute;
            inline-size: 1px;
            block-size: 1px;
            overflow: hidden;
            clip-path: inset(50%);
            white-space: nowrap;
        }

        .bulk {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px 16px;
            border-radius: var(--md-sys-shape-corner-large, 16px);
            background: var(--md-sys-color-secondary-container, Canvas);
            color: var(--md-sys-color-on-secondary-container, CanvasText);
        }

        .photo-row {
            display: grid;
            grid-template-columns: 48px minmax(0, 1fr);
            align-items: start;
            gap: 4px 8px;
            padding-block: 4px;
            content-visibility: auto;
            contain-intrinsic-size: auto 88px;
        }

        .select {
            display: grid;
            place-items: center;
            inline-size: 48px;
            block-size: 48px;
        }

        /*
         * M3's check box: an 18 px box with its own 2 px border (3:1 against the surface, non-text contrast), the check mark
         * drawn inside, and a 48 px target around it (the kit's touch-target ring, here on the input itself).
         */
        .select input {
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

        .select input::after {
            position: absolute;
            inset: 50% auto auto 50%;
            inline-size: 48px;
            block-size: 48px;
            content: '';
            transform: translate(-50%, -50%);
        }

        .select input:checked {
            border-color: var(--md-sys-color-primary, Highlight);
            background: var(--md-sys-color-primary, Highlight);
        }

        .select input:checked::before {
            inline-size: 4px;
            block-size: 9px;
            border: solid var(--md-sys-color-on-primary, Canvas);
            border-width: 0 2px 2px 0;
            content: '';
            transform: translateY(-1px) rotate(45deg);
        }

        .select input:focus-visible {
            outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
            outline-offset: 2px;
        }

        a.photo {
            display: grid;
            grid-template-columns: 56px minmax(0, 1fr);
            align-items: center;
            gap: 12px;
            box-sizing: border-box;
            min-block-size: 72px;
            padding: 8px;
            border-radius: var(--md-sys-shape-corner-large, 16px);
            color: inherit;
            text-decoration: none;
        }

        a.photo:hover {
            background: color-mix(in srgb, var(--md-sys-color-on-surface, CanvasText) 8%, transparent);
        }

        a.photo[aria-current='page'] {
            background: var(--md-sys-color-secondary-container, Highlight);
            color: var(--md-sys-color-on-secondary-container, HighlightText);
        }

        a.photo:focus-visible {
            outline-offset: -3px;
        }

        .thumb {
            display: grid;
            place-items: center;
            inline-size: 56px;
            block-size: 56px;
            border-radius: var(--md-sys-shape-corner-small, 8px);
            background: var(--md-sys-color-surface-container-high, Canvas);
            object-fit: cover;
            color: var(--md-sys-color-on-surface-variant, CanvasText);
        }

        .row-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-inline-size: 0;
        }

        .row-chips,
        .row-actions {
            grid-column: 2;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .uploads {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .upload {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .upload-head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        .upload-name {
            flex: 1 1 160px;
            min-inline-size: 0;
        }

        /* 8 px below the list-detail's Back or Close, whose 48 px ring would otherwise reach into the map's box. */
        .detail {
            display: flex;
            flex-direction: column;
            min-block-size: 100%;
            padding-block-start: 8px;
            box-sizing: border-box;
        }

        .map {
            position: relative;
            block-size: 45vh;
            min-block-size: 240px;
            background: var(--md-sys-color-surface-container, Canvas);
        }

        /* Without a map (no token, no WebGL, a failure) the box is its note only. */
        .map[no-map] {
            block-size: auto;
            min-block-size: 0;
        }

        .map:focus-visible {
            outline-offset: -3px;
        }

        .map-note {
            margin: 16px 16px 0;
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
            border: 0;
        }

        legend {
            padding: 0;
            margin-block-end: 4px;
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

        .field textarea:focus-within,
        .field select:focus-within {
            outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
            outline-offset: 0;
        }

        .switch-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            min-block-size: 48px;
        }

        .editor-head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        .editor-head h2 {
            flex: 1 1 200px;
        }

        .image {
            display: block;
            max-inline-size: 100%;
            max-block-size: 320px;
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            object-fit: contain;
        }

        /*
         * The editor's notes (the place to check, a replacement): the tertiary container, its ring in the container's own
         * colour, as the alerts on the error container (secondary falls under 3:1 there in the dark scheme, LESSONS 216).
         */
        .banner {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px 16px;
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            background: var(--md-sys-color-tertiary-container, Canvas);
            color: var(--md-sys-color-on-tertiary-container, CanvasText);

            --hcm-focus-ring-color: var(--md-sys-color-on-tertiary-container, CanvasText);
        }

        .link-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) 48px;
            align-items: end;
            gap: 8px;
        }

        .skipped {
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .skipped a {
            display: flex;
            align-items: center;
            min-block-size: 48px;
        }

        .dialog-form {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
    `,
    mapBesideStyles,
];
