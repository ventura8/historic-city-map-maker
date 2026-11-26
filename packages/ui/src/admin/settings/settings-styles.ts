/**
 * Styles of the settings page beyond the layers page's: the section rows with their icon, the seed presets and the
 * native colour inputs (48 px targets, an outline border that keeps 3:1 against the surface), the basemap choices (drawn
 * radios), the credits and the Markdown preview.
 */
import { css } from 'lit';

export const settingsStyles = css`
    /* The page's map (area and overlays sections): the layers editor's height; without a map, its note only. */
    .settings-map {
        block-size: clamp(240px, 40vh, 420px);
    }

    .settings-map[no-map] {
        block-size: auto;
    }

    /* A problem several fields share (the city's four edges), said once below them in the fields' error style. */
    .shared-error {
        margin: 0;
        color: var(--md-sys-color-error, CanvasText);
        font-size: var(--md-sys-typescale-body-small-size, 0.75rem);
    }

    .section-row {
        flex-direction: row;
        align-items: center;
        justify-content: flex-start;
        gap: 16px;
    }

    .row-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-inline-size: 0;
    }

    .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .preset {
        box-sizing: border-box;
        inline-size: 48px;
        block-size: 48px;
        padding: 0;
        border: 2px solid var(--md-sys-color-outline, CanvasText);
        border-radius: var(--md-sys-shape-corner-full, 50%);
        background: var(--preset);
        cursor: pointer;
    }

    .preset[aria-pressed='true'] {
        border-width: 4px;
        border-color: var(--md-sys-color-on-surface, CanvasText);
    }

    .field input.color {
        inline-size: 96px;
        padding: 4px;
    }

    .choices {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .choice {
        display: flex;
        align-items: center;
        gap: 12px;
        min-block-size: 48px;
    }

    /* Drawn radios: a 2 px ring with 3:1 against the surface, the dot in primary when chosen (the label is the target). */
    .choice input {
        position: relative;
        display: grid;
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

    /* The whole 48 px square around the radio takes the pointer (M3 touch target), as the label does. */
    .choice input::after {
        position: absolute;
        inset: 50% auto auto 50%;
        inline-size: 48px;
        block-size: 48px;
        content: '';
        transform: translate(-50%, -50%);
    }

    .choice input:checked {
        border-color: var(--md-sys-color-primary, Highlight);
    }

    .choice input:checked::before {
        inline-size: 10px;
        block-size: 10px;
        border-radius: var(--md-sys-shape-corner-full, 50%);
        background: var(--md-sys-color-primary, Highlight);
        content: '';
    }

    @media (forced-colors: active) {
        .choice input:checked {
            border-color: Highlight;
        }

        .choice input:checked::before {
            background: Highlight;
            forced-color-adjust: none;
        }
    }

    .credits {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .credit hr {
        margin: 12px 0 0;
        border: 0;
        border-block-start: 1px solid var(--md-sys-color-outline-variant, CanvasText);
    }

    .preview {
        margin: 0;
        padding: 12px 16px;
        border-radius: var(--md-sys-shape-corner-medium, 12px);
        background: var(--md-sys-color-surface-container, Canvas);
    }

    .preview p + p {
        margin-block-start: 8px;
    }

    .dialog-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    /* A target year and its Remove: a 48 px row keeps the 40 px button's 48 px target clear of the next year's
       (the rows' 4 px gap left 44 px, CR-M3-35 j). */
    .year-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-block-size: 48px;
        padding-inline: 16px 4px;
    }
`;
