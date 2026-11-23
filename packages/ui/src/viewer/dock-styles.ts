/**
 * The floating controls of `<hcm-map-viewer>` (`viewer-styles.ts`): their docks over the map, the strip at its foot they
 * keep free for Mapbox's logo and attribution, the 8 px between touch targets, and where each goes on a phone held
 * upright, a landscape phone (compact height) and wider windows. Split from `viewer-styles.ts` for its length; it comes
 * last in the element's styles, as it did there.
 */
import { css } from 'lit';

export const dockStyles = css`
    .dock {
        position: absolute;
        z-index: 10;
    }

    /* The menu's and the toast's docks are as wide as their popup or their row: only what they draw takes the pointer. */
    .dock.menu,
    .dock.toast {
        pointer-events: none;
    }

    /*
     * Lying (from 600 px, and on a short window of any width) the timeline takes the whole foot of the map, gutter to
     * gutter, less the trailing column of the menu button and the zoom group (the owner, 2026-11-14: a narrower centred
     * bar wasted the width; at 2560 px it was 640 of 2392 px).
     */
    .dock.timeline {
        inset-inline: var(--hcm-gutter) calc(var(--hcm-gutter) + 72px);
        inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
    }

    /*
     * Standing (a phone held upright, the owner's request of 2026-11-08) on the leading edge, from the top gutter
     * down to the chip's row: the chip, an icon button there, docks 8 px under its foot, a row above the menu button,
     * which keeps the bottom trailing corner; the open menu grows on the trailing side, clear of the 68 px card.
     */
    .frame[data-timeline='vertical'] .dock.timeline {
        inset-inline: var(--hcm-gutter) auto;
        inset-block: var(--hcm-gutter)
            calc(var(--hcm-map-chrome) + var(--hcm-fab-size) + 40px + 2 * var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px));
    }

    /* No layers yet: a small note where the timeline will be, clear of the FAB menu on the trailing side. */
    .dock.timeline-note {
        inset-inline: var(--hcm-gutter) calc(var(--hcm-gutter) + 72px);
        inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
        display: flex;
        justify-content: flex-start;
        pointer-events: none;
    }

    .note,
    .dock.zoom,
    .dock.compass,
    .dock.locate,
    .dock.shot {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
        border-radius: var(--md-sys-shape-corner-full);
        background: var(--md-sys-color-surface-container-high);
        color: var(--md-sys-color-on-surface-variant);
        box-shadow: var(--md-sys-elevation-level2);
    }

    .note {
        min-block-size: 40px;
        padding: 8px 16px 8px 12px;
        font-size: var(--md-sys-typescale-label-large-size);
        line-height: 1.4;
        pointer-events: auto;
    }

    .dock.menu {
        /* Above the consent banner and the snackbar: the open menu grows upwards over them (kit-integration test). */
        z-index: 26;

        /* Beside a standing timeline the dock ends 8 px from it, and an item too wide wraps (text spacing at 320 px). */
        inset-inline: var(--hcm-top-start, auto) var(--hcm-gutter);
        text-align: end;
        inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
    }

    /*
     * Beside the lying timeline, which is taller than the FAB, the open menu's items end 8 px above it (the visual
     * audit found the last item over the timeline's thumb at 768 px).
     */
    .frame[data-timeline='horizontal'] .dock.menu {
        --hcm-fab-menu-gap: calc(var(--hcm-timeline-block) - var(--hcm-fab-size) + var(--hcm-dock-gap));
    }

    /*
     * On the lying card's leading edge, 8 px above it (the owner's screenshot of 2026-11-08: the chip aligned to nothing
     * beside the card); the card begins at the gutter.
     */
    .dock.chip {
        inset-inline-start: var(--hcm-gutter);
        inset-block-end: calc(var(--hcm-map-chrome) + var(--hcm-timeline-block) + var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px));
    }

    /*
     * The zoom buttons (V52): a vertical group (4 px around two 40 px buttons: 48 px targets) centred over the FAB on
     * the trailing edge, 8 px above it.
     */
    .frame {
        --hcm-zoom-end: calc(var(--hcm-map-chrome) + var(--hcm-fab-size) + var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px));
    }

    .dock.zoom,
    .dock.compass,
    .dock.locate,
    .dock.shot {
        inset-inline-end: calc(var(--hcm-gutter) + 4px);
        inset-block-end: var(--hcm-zoom-end);
        flex-direction: column;
        padding: 4px;

        /* They fade back in when the menu closes (hidden at once when it opens: the menu grows over them). */
        transition: opacity var(--md-sys-motion-spring-fast-effects-duration, 150ms) var(--md-sys-motion-spring-fast-effects-easing, ease);
    }

    /*
     * The compass (V64): its own 48 px pill 8 px over the 96 px group (two 40 px buttons and 16 px; on a TV two 48 px ones). On a short map (under 600 px) that would reach the
     * band compare's divider handle sweeps (64 to 16 px above the middle) or the compare bar: it sits beside the group's
     * Zoom in instead, on the side towards the map (the tour at 320 x 568 and 915 x 412).
     */
    .dock.compass {
        inset-block-end: calc(var(--hcm-zoom-end) + 2 * var(--hcm-control-size, 40px) + 16px + var(--hcm-dock-gap));
    }

    /*
     * Show my location (V10, the owner 2026-11-22): its 48 px pill 8 px over the compass's. The shot direction (V93, the
     * owner 2026-11-23) takes that place while the image on top has one, and Show my location goes one pill higher.
     */
    .dock.locate,
    .dock.shot {
        inset-block-end: calc(var(--hcm-zoom-end) + 2 * var(--hcm-control-size, 40px) + 16px + 48px + 2 * var(--hcm-dock-gap));
    }

    .dock.locate.over-shot {
        inset-block-end: calc(var(--hcm-zoom-end) + 2 * var(--hcm-control-size, 40px) + 16px + 96px + 3 * var(--hcm-dock-gap));
    }

    @container hcm-viewer (height < 600px) {
        .dock.compass,
        .dock.locate,
        .dock.shot {
            inset-inline-end: calc(var(--hcm-gutter) + 4px + 48px + var(--hcm-dock-gap));
            inset-block-end: calc(var(--hcm-zoom-end) + 48px);
        }

        .dock.locate,
        .dock.shot {
            inset-block-end: calc(var(--hcm-zoom-end) + 96px + var(--hcm-dock-gap));
        }

        .dock.locate.over-shot {
            inset-block-end: calc(var(--hcm-zoom-end) + 144px + 2 * var(--hcm-dock-gap));
        }
    }

    /* Beside a standing timeline the chip there is a 40 px icon button (the owner, 2026-11-12) centred under the 68 px card: 14 px in. */
    .frame[data-timeline='vertical'] .dock.chip {
        inset-inline-start: calc(var(--hcm-gutter) + 14px);
        inset-block-end: calc(var(--hcm-map-chrome) + var(--hcm-fab-size) + var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px));
    }

    .dock.consent {
        inset-inline: var(--hcm-top-start, var(--hcm-gutter)) var(--hcm-gutter);
        inset-block-start: var(--hcm-gutter);
        max-inline-size: 480px;
        z-index: 20;
    }

    .dock.toast {
        inset-inline: var(--hcm-top-start, var(--hcm-gutter)) var(--hcm-gutter);
        inset-block-start: var(--hcm-gutter);
        display: grid;
        justify-items: center;
        z-index: 25;
    }

    /*
     * The kit's snackbar places itself at the bottom of its container; here it flows in the top dock (the tour
     * found it above the top edge of the map).
     */
    .dock.toast hcm-snackbar {
        position: static;
    }

    /*
     * The top docks, compare's bar, the skip link and the menu's dock begin 8 px after the standing timeline, 68 px wide
     * (the tour found the toast's dock, then the focused skip link, over the thumb of a vertical timeline). The zoom
     * group and the compass sit above the chip's row there, the group's foot level with the card's, a row above the FAB.
     */
    .frame[data-timeline='vertical'] {
        --hcm-top-start: calc(var(--hcm-gutter) + 76px);
        --hcm-zoom-end: calc(
            var(--hcm-map-chrome) + var(--hcm-fab-size) + 40px + 2 * var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px)
        );
    }

    @container hcm-viewer (width >= 600px) {
        .dock.timeline-note {
            justify-content: center;
        }
    }

    /*
     * A landscape phone is too short for the whole menu. The menu is docked on the leading edge, so the FAB never
     * moves from under the finger, and its items fill rows that stack upwards from 8 px above the FAB, across the
     * whole width of the map (the Pixel 9 Pro review, P1: at 884 x 322, with Chrome's bars, the items' columns
     * were one item tall and seven of them ran 263 px off the screen). While it is open the lying card, the chip and
     * the zoom group step aside, so the rows may use the height down to the FAB; the items are 48 px tall, the
     * smallest touch target. A window too small even for that (568 x 270) scrolls the menu, whose arrow keys bring
     * the focused item into view.
     */
    .frame[data-compact-height] .dock.menu {
        inset-inline: var(--hcm-gutter);
        text-align: start;

        --hcm-fab-menu-align: flex-start;
        --hcm-fab-menu-flow: row wrap-reverse;
        --hcm-fab-menu-gap: var(--hcm-dock-gap);
        --hcm-fab-menu-item-height: 48px;
        --hcm-fab-menu-item-padding: 16px;
        --hcm-fab-menu-overflow: auto;
        --hcm-fab-menu-padding: 4px;
        --hcm-fab-menu-max-block-size: calc(
            100cqb - var(--hcm-map-chrome) - var(--hcm-fab-size) - var(--hcm-dock-gap) - var(--hcm-gutter) /
                2 - env(safe-area-inset-bottom, 0px)
        );
    }

    /* Open, the element fills its dock, so its rows may be as wide as the map; closed, it is the FAB's box. */
    .frame[data-compact-height] .dock.menu > hcm-fab-menu[open] {
        display: flex;
    }

    .frame[data-compact-height]:has(.dock.menu > [open]) :is(.dock.timeline, .dock.chip, .dock.timeline-note) {
        visibility: hidden;
    }

    /*
     * The menu button is on the leading side only, so the lying card takes the trailing column instead, and the chip its
     * trailing edge, at the gutter (the review at 568 x 320: 72 px in, the chip sat on the map's centre point).
     */
    .frame[data-compact-height] .dock.timeline {
        inset-inline: calc(var(--hcm-gutter) + 72px) var(--hcm-gutter);
    }

    .frame[data-compact-height] .dock.chip {
        inset-inline: auto var(--hcm-gutter);
    }

    /*
     * On a short window the FAB is on the leading side and the lying card and the chip take the trailing column: the
     * group goes over the FAB there, in the leading column the card leaves free.
     */
    .frame[data-compact-height] .dock.zoom {
        inset-inline: calc(var(--hcm-gutter) + 4px) auto;
    }

    /* There the compass is beside the group's Zoom in on its trailing side, towards the map (a short map: under 600 px). */
    .frame[data-compact-height] .dock.compass,
    .frame[data-compact-height] .dock.locate,
    .frame[data-compact-height] .dock.shot {
        inset-inline: calc(var(--hcm-gutter) + 4px + 48px + var(--hcm-dock-gap)) auto;
    }

    /* Upright, the items begin above the chip's row (the owner's phone: the last item covered the chip's end). */
    .frame[data-timeline='vertical'] .dock.chip ~ .dock.menu {
        --hcm-fab-menu-gap: calc(40px + 2 * var(--hcm-dock-gap));
    }

    /*
     * The open menu grows over the group and the compass: they step aside until it closes (the tour's overlap check). The
     * frame is marked by the menu's own toggle (viewer-render.ts): Safari did not apply the :has() sibling rule.
     */
    .frame[data-menu-open] :is(.dock.zoom, .dock.compass, .dock.locate, .dock.shot),
    .dock.menu:has(> [open]) ~ :is(.dock.zoom, .dock.compass, .dock.locate, .dock.shot) {
        visibility: hidden;
        opacity: 0;
        transition: none;
    }

    @media (prefers-reduced-motion: reduce) {
        .frame :is(.dock.zoom, .dock.compass, .dock.locate, .dock.shot) {
            transition: none;
        }
    }

    /* The year chip shows where the photos chip docks: that one steps aside meanwhile (last: it outranks every chip rule). */
    .frame:has(hcm-timeline[tipping]) .dock.chip {
        visibility: hidden;
    }

    /*
     * The keyboard's year chip shows while the slider has the focus: the photos chip is only transparent then, so it keeps
     * its place in the Tab order (hidden, Tab from the slider skipped it: the tour's V68 journey, lesson 648).
     */
    .frame:has(hcm-timeline[tipping='focus']) .dock.chip {
        visibility: visible;
        opacity: 0;
        pointer-events: none;
    }
`;
