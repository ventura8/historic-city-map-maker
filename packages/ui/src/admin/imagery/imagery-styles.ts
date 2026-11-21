/**
 * The Imagery area's styles (`docs/research/M3-interfaces.md` §10.2): the editing kit's rows, chips, facts and fields,
 * plus the scenes' thumbnails, the filters, the upload's drop zone, the steps of a job, the approval card and the map's
 * box, which keeps its place above the detail (one map per page visit), at least 240 px, also on compact windows.
 */
import { css } from 'lit';

import { visuallyHidden } from '../../components/styles.js';
import { editingStyles } from '../editing/editing-styles.js';

export const imageryStyles = [
    ...editingStyles,
    visuallyHidden,
    css`
        /* M28: a part the map's sources turned off, with its way to Setup → Sources (a full target). */
        .sources-off {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 16px;
        }

        .sources-off a {
            display: inline-flex;
            align-items: center;
            min-block-size: 48px;
            color: var(--md-sys-color-primary);
        }

        .imagery-map {
            flex: none;
            block-size: clamp(240px, 45vh, 480px);
        }

        .imagery-map[no-map] {
            block-size: auto;
        }

        .row.scene {
            display: grid;
            grid-template-columns: 64px minmax(0, 1fr);
            align-items: center;
            gap: 12px;
        }

        /* The title, the frame's identity and the reasons each on their own lines (finding 53); M25: a Landsat product id (40 characters,
           no space) breaks where it must on a phone. */
        .row.scene .row-detail {
            display: block;
            overflow-wrap: anywhere;
        }

        /* t130/t131: the folded Cancelled versions and each row's Remove open from a full-size target. */
        [data-cancelled-versions] > summary,
        .remove > summary {
            display: flex;
            align-items: center;
            min-block-size: 48px;
            cursor: pointer;
        }

        .section > h3 {
            padding-inline: 16px;
        }

        [data-cancelled-versions] > summary h3 {
            display: inline;
            margin: 0;
        }

        .thumb {
            display: grid;
            place-items: center;
            inline-size: 64px;
            block-size: 64px;
            border-radius: var(--md-sys-shape-corner-small, 8px);
            background: var(--md-sys-color-surface-container-high, Canvas);
            object-fit: cover;
            color: var(--md-sys-color-on-surface-variant, CanvasText);
        }

        .browse {
            display: block;
            max-inline-size: 100%;
            max-block-size: 360px;
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            background: var(--md-sys-color-surface-container-high, Canvas);
            object-fit: contain;
        }

        /* Wrapped chip rows 16 px apart, like the kit's .chips: 8 px let a 32 px chip's 48 px target reach the next row's
           (40 px on a phone, CR-M3-35 e). */
        .filters {
            display: flex;
            flex-wrap: wrap;
            gap: 16px 8px;
            align-items: flex-end;
        }

        .scene-card {
            display: flex;
            flex-direction: column;
        }

        /* A card's Import sits under its text, past the thumbnail's column (16 + 64 + 12 px), 4 px below the link: its
           48 px target reaches 4 px past the button and must not cover the link (finding 53's longer rows showed it). */
        .card-import {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-block: 4px 8px;
            padding-inline: 92px 16px;
        }

        .years {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .years .field {
            inline-size: 120px;
        }

        .reasons {
            margin: 0;
            padding-inline-start: 20px;
        }

        .drop {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
            padding: 16px;
            border: 2px dashed var(--md-sys-color-outline, CanvasText);
            border-radius: var(--md-sys-shape-corner-large, 16px);
        }

        .drop[data-over] {
            border-color: var(--md-sys-color-primary, Highlight);
            background: var(--md-sys-color-primary-container, Canvas);
        }

        .card {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 16px;
            border-radius: var(--md-sys-shape-corner-large, 16px);
            background: var(--md-sys-color-surface-container-low, Canvas);
        }

        .steps {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .steps li {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .steps li[data-state='running'] {
            font-weight: var(--md-sys-typescale-title-small-weight, 500);
        }

        .image-view {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 16px;
        }

        .image-view > p {
            flex: 1 1 100%;
        }

        .choices {
            display: flex;
            flex-direction: column;
            gap: 8px;
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

        .section {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        /* The technical detail of an error: the alert's own colour (a note's would lose its contrast there). */
        .alert .detail {
            font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
            line-height: var(--md-sys-typescale-body-medium-line-height, 1.25rem);
        }
    `,
];
