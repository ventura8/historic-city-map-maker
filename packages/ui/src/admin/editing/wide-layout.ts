/**
 * The map-centric editors beside their map: on a landscape phone (a compact height) and on an extra-large page.
 *
 * The editors on an extra-large page (M3's window classes, measured on the page by `hcm-list-detail`: from 1600 px;
 * `docs/research/M2c-interfaces.md` §1.2, the orchestrator's review of the 2560 × 1440 screenshots, 2026-10-18). Below
 * that, the open item's map sits above its form, which is at most 840 px wide; on an extra-large page that left the form a
 * narrow column between wide empty margins and the map a short strip. There the map becomes a supporting pane beside the
 * form: the list (412 px), then the map taking the rest, then the form at 480 px, each scrolling on its own. Only a map
 * that shows (`hcm-admin-map:not([no-map])`): a box that only says why there is no map keeps the stacked layout.
 *
 * The map comes first in the reading order, as in the stacked layout, so the Tab order still follows what is seen.
 */
import { css } from 'lit';

/** A page whose detail (`.detail`, slotted into `hcm-list-detail`) holds the map box, then the open item or the overview. */
export const mapBesideStyles = css`
    /*
     * A landscape phone (a compact height, M2c-interfaces §1.2): the full-screen editor puts the map on the leading 60 %
     * and the form in a side pane that scrolls on its own, instead of a strip of map above a form that leaves no room
     * for either (the UX review of 2026-10-18, DECISIONS-for-review.md §42e). Not at a compact width: a portrait phone of
     * 320 × 568 measures a compact height too while its navigation bar shows, and two columns of 320 px hold neither.
     */
    hcm-list-detail[height-class='compact']:not([window-class='compact']) > .detail:has(> hcm-admin-map:not([no-map])) {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        grid-template-rows: minmax(0, 1fr);
        flex: 1 1 0;
        min-block-size: 0;
    }

    hcm-list-detail[height-class='compact']:not([window-class='compact']) > .detail:has(> hcm-admin-map:not([no-map])) > hcm-admin-map {
        block-size: auto;
        min-block-size: 0;
    }

    hcm-list-detail[height-class='compact']:not([window-class='compact'])
        > .detail:has(> hcm-admin-map:not([no-map]))
        > :not(hcm-admin-map) {
        min-block-size: 0;
        overflow-y: auto;
    }

    hcm-list-detail[split][window-class='extra-large'] > .detail:has(> hcm-admin-map:not([no-map])) {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 480px;
        grid-template-rows: minmax(0, 1fr);
        block-size: 100%;
        min-block-size: 0;
    }

    hcm-list-detail[split][window-class='extra-large'] > .detail:has(> hcm-admin-map:not([no-map])) > hcm-admin-map {
        block-size: auto;
        min-block-size: 0;
    }

    hcm-list-detail[split][window-class='extra-large'] > .detail:has(> hcm-admin-map:not([no-map])) > :not(hcm-admin-map) {
        min-block-size: 0;
        overflow-y: auto;
    }
`;

/**
 * An editor whose pane holds the map box among its groups (the layer editor): on an extra-large page the pane grows past
 * 840 px into two columns, its groups at 560 px and the map beside them, kept in view while they scroll. What comes before
 * the map (the heading, the save bar, the banners) spans both columns, so the map starts level with the first group and the
 * reading order still runs from top to bottom.
 */
export const paneMapBesideStyles = css`
    hcm-list-detail[split][window-class='extra-large'] .pane:has(> hcm-admin-map:not([no-map])) {
        display: grid;
        grid-template-columns: minmax(0, 560px) minmax(0, 1fr);
        align-items: start;
        column-gap: 24px;
        max-inline-size: none;
    }

    hcm-list-detail[split][window-class='extra-large'] .pane:has(> hcm-admin-map:not([no-map])) > * {
        grid-column: 1;
    }

    hcm-list-detail[split][window-class='extra-large'] .pane:has(> hcm-admin-map:not([no-map])) > :has(~ hcm-admin-map) {
        grid-column: 1 / -1;
    }

    hcm-list-detail[split][window-class='extra-large'] .pane:has(> hcm-admin-map:not([no-map])) > hcm-admin-map {
        position: sticky;
        inset-block-start: 16px;
        grid-column: 2;
        grid-row: span 5;
        block-size: min(70vh, 720px);
    }
`;
