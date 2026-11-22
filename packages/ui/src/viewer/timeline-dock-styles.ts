/**
 * Where the timeline's pill docks on a phone (V12, `timeline-dock.ts`): collapsed, the card is 64 px tall (a 56 px pill in
 * 4 px of card, the year in title large; 96 px wide or more), so the chip, the menu's gap and everything docked by `--hcm-timeline-block` follow it.
 * Standing, the pill keeps the foot of the column the card took, 8 px over the chip, and the map gets the column back; on a
 * short window it keeps the trailing end the chip is aligned to, under the chip, clear of the menu button, the zoom group
 * and the compass on the leading side and of Mapbox's legal line below. Comes after `dock-styles.ts`.
 */
import { css } from 'lit';

export const timelineDockStyles = css`
    .frame[data-timeline-collapsed] {
        --hcm-timeline-block: 64px;
    }

    .frame[data-timeline='vertical'][data-timeline-collapsed] .dock.timeline {
        inset-block-start: auto;
    }

    /* Upright the 40 px chip stays centred under the 96 px pill (88 px of year in 4 px of card): 28 px in, not the card's 14. */
    .frame[data-timeline='vertical'][data-timeline-collapsed] .dock.chip {
        inset-inline-start: calc(var(--hcm-gutter) + 28px);
    }

    .frame[data-compact-height][data-timeline-collapsed] .dock.timeline {
        inset-inline: auto var(--hcm-gutter);
    }

    /*
     * Upright the larger pill (96 px or more) is wider than the 68 px column the open menu keeps clear, and at 320 x 568
     * the six items do not fit above its row: while the menu is open the pill steps aside, as a short window's whole dock
     * does (dock-styles.ts); the menu is the visitor's task then, and closing it brings the pill back.
     */
    .frame[data-timeline='vertical'][data-timeline-collapsed]:has(.dock.menu > [open]) .dock.timeline {
        visibility: hidden;
    }

    /* The year's opacity sheet on a phone (opacity-sheet.ts): modal over a transparent scrim like the date menu, at the foot
       of the viewer above Mapbox's legal line, its sliders a row each. */
    .opacity-scrim {
        position: absolute;
        z-index: 9;
        inset: 0;
    }

    .opacity-sheet {
        position: absolute;
        z-index: 10;
        inset: auto var(--hcm-gutter, 16px) calc(var(--hcm-map-chrome, 42px) + env(safe-area-inset-bottom, 0px));
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: start;
        box-sizing: border-box;
        max-inline-size: 480px;
        margin-inline: auto;
        padding: 12px 24px;
        border-radius: var(--md-sys-shape-corner-extra-large, 28px);
        background: var(--md-sys-color-surface-container-high, Canvas);
        color: var(--md-sys-color-on-surface, CanvasText);
        box-shadow: var(--md-sys-elevation-level3, none);
    }

    .opacity-sliders {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-inline-size: 0;
    }

    .opacity-close {
        display: grid;
        place-items: center;
        inline-size: 48px;
        block-size: 48px;
        padding: 0;
        border: 0;
        border-radius: var(--md-sys-shape-corner-full, 9999px);
        background: transparent;
        color: var(--md-sys-color-on-surface-variant, CanvasText);
        cursor: pointer;
    }

    .opacity-close:focus-visible {
        outline: 3px solid var(--md-sys-color-secondary, Highlight);
        outline-offset: 2px;
    }

    .opacity-sliders .opacity-row {
        display: flex;
        flex-direction: column;
    }

    .opacity-sliders .opacity-name {
        font-size: var(--md-sys-typescale-body-small-size, 12px);
        line-height: var(--md-sys-typescale-body-small-line-height, 16px);

        /* A layer's name can be long: one line, shortened (its full name is the slider's accessible name). */
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    @media (forced-colors: active) {
        .opacity-sheet {
            border: 2px solid CanvasText;
        }
    }
`;
