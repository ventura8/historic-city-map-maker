/**
 * What the layers and settings areas show on the page's map while a draft is open (`docs/research/M2c-interfaces.md`
 * §5.2): a change overrides its own overlay until it is saved or discarded, and is written by nothing. The types mirror
 * the contract's `MapPreview` (pois, `packages/admin/src/map/preview.ts`) member by member, so the real preview of the
 * page's map satisfies `PreviewSink` structurally; the pages hand it to their area once the map exists, and the node
 * tests pass a recording one.
 */
import { PHOTOS_OVERLAY_ID, type LayerAdjustments } from '@hcm/shared';

export type PreviewChange =
    | {
          readonly kind: 'layer';
          readonly id: string;
          readonly opacity?: number;
          readonly visible?: boolean;
          readonly adjustments?: LayerAdjustments;
      }
    | { readonly kind: 'photos-overlay'; readonly opacity: number }
    | { readonly kind: 'poi-category'; readonly id: string; readonly opacity?: number; readonly color?: string; readonly icon?: string };

/** The overlay a preview is taken back from (the photos overlay is one, it needs no id). */
export type PreviewTarget =
    | { readonly kind: 'layer'; readonly id: string }
    | { readonly kind: 'photos-overlay' }
    | { readonly kind: 'poi-category'; readonly id: string };

export interface PreviewSink {
    preview(change: PreviewChange): void;
    restore(target: PreviewTarget): void;
}

function targetOf(change: PreviewChange): PreviewTarget {
    return change.kind === 'photos-overlay' ? { kind: change.kind } : { kind: change.kind, id: change.id };
}

/**
 * Keeps one area's previews on the page's map: the latest change of each overlay, shown again on a map attached later
 * (a page whose map loads after the first edit), and every overlay taken back on `clear`.
 */
export class PreviewLayer {
    #sink: PreviewSink | null = null;
    readonly #shown = new Map<string, PreviewChange>();

    attach(sink: PreviewSink | null): void {
        this.#sink = sink;
        for (const change of this.#shown.values()) {
            sink?.preview(change);
        }
    }

    show(change: PreviewChange): void {
        this.#shown.set(keyOf(targetOf(change)), change);
        this.#sink?.preview(change);
    }

    /** Takes every overlay back to its saved look. */
    clear(): void {
        for (const change of this.#shown.values()) {
            this.#sink?.restore(targetOf(change));
        }
        this.#shown.clear();
    }

    /** The changes on the map now, oldest first (for tests and the pages' announcements). */
    get changes(): readonly PreviewChange[] {
        return [...this.#shown.values()];
    }
}

function keyOf(target: PreviewTarget): string {
    return target.kind === 'photos-overlay' ? PHOTOS_OVERLAY_ID : `${target.kind}:${target.id}`;
}
