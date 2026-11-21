/**
 * The georeferencer's pictures (`docs/research/M3-interfaces.md` §10.4): the scan preview (`scan-preview.jpg`) as a
 * `blob:` address for the scan pane and decoded for the warped preview, the reference shown on the map (OpenStreetMap
 * lines or Sentinel-2, switchable: never Mapbox Satellite), and the warped preview itself, drawn again at most once per
 * frame however fast the pairs move (`WARP_DELAY_MS`).
 */
import type { BBox, FittedTransform } from '@hcm/shared';

import type { Clock } from '../app/ports.js';
import type { ContentServices } from '../content/services.js';
import { NO_FILES, type FilePort, type Picture, type PicturePort } from '../imagery/files.js';
import { cornersOfBox, type PictureOverlays } from '../imagery/overlay.js';
import type { MapStatus } from '../layers/map-session.js';
import type { Store } from '../state/store.js';
import type { GeorefState, GeorefVersion, ReferenceKind, ScanDetail, ScanImage } from './state.js';
import type * as WarpChunk from './georef-warp.js';

/** The overlays' ids on the map. */
export const REFERENCE_PICTURE = 'reference';
export const WARPED_PICTURE = 'warped';

/** The warped preview is drawn again this long after the last change (one frame). */
export const WARP_DELAY_MS = 16;

/** The warp's code (`./georef-warp.ts`, a lazy chunk). */
export type WarpLoader = () => Promise<typeof WarpChunk>;

/** The warp chunk's one dynamic `import()`. */
export const loadWarp: WarpLoader = async () => import('./georef-warp.js');

/** The scan and the reference are decoded at most this long (a canvas texture). */
const DECODE_MAX_SIDE = 4096;

/** The screen's device pixels a CSS pixel, at least 1 (1 where there is no screen, as in a worker or a test under Node). */
export function deviceRatio(): number {
    return Math.max(1, ...[globalThis.devicePixelRatio].filter(Number.isFinite));
}

export interface GeorefPicturesDeps {
    readonly files: FilePort;
    readonly pictures: PicturePort | null;
    readonly clock: Clock;
    readonly overlays: PictureOverlays;
    /** The scan pane's image. */
    readonly scan: (image: ScanImage) => void;
    /** The sharper scan, once fetched (null: none). */
    readonly detail: (detail: ScanDetail | null) => void;
    /** The warp chunk's fetch (`loadWarp` by default; a seam for the tests). */
    readonly warp?: WarpLoader;
}

type Scan = NonNullable<GeorefVersion['scan']>;

/** The reference shown: its kind, its picture's path and its box. */
export interface ReferenceChoice {
    readonly kind: ReferenceKind;
    readonly path: string;
    readonly bounds: BBox;
}

/** The reference to show: the one asked for when the version has it, else OpenStreetMap, else Sentinel-2, else none. */
export function referenceOf(version: GeorefVersion, wanted: ReferenceKind | null): ReferenceChoice | null {
    const reference = version.reference;
    if (reference === null) {
        return null;
    }
    const choices = [
        { kind: 'osm' as const, path: reference.osmPath },
        { kind: 's2' as const, path: reference.s2Path },
    ].flatMap(({ kind, path }) => (path === null ? [] : [{ kind, path, bounds: reference.bounds }]));
    return choices.find((choice) => choice.kind === wanted) ?? choices[0] ?? null;
}

/** A decoded picture and the port that draws with it. */
interface Decoded {
    readonly pictures: PicturePort;
    readonly picture: Picture;
}

/** What the warped preview is drawn from. */
interface WarpInput {
    readonly transform: FittedTransform | null;
    readonly scan: Scan | null;
    readonly opacity: number;
}

interface ReadyWarp {
    readonly source: Decoded;
    readonly transform: FittedTransform;
    readonly scan: Scan;
    readonly opacity: number;
}

export class GeorefPictures {
    readonly #deps: GeorefPicturesDeps;
    #versionId: string | null = null;
    #scanUrl: string | null = null;
    /** The sharper scan asked for (once a version). */
    #detailAsked = false;
    #scanPicture: Decoded | null = null;
    #target: Picture | null = null;
    #reference: ReferenceKind | null = null;
    #choice: ReferenceChoice | null = null;
    #timer: unknown = null;
    #next: WarpInput | null = null;
    /** The warp chunk once in (null: not yet), and whether it is being fetched. */
    #warpChunk: typeof WarpChunk | null = null;
    #warpAsked = false;
    /** Bumped by `clear`: a decode that ends after it is dropped. */
    #generation = 0;

    constructor(deps: GeorefPicturesDeps) {
        this.#deps = deps;
    }

    get reference(): ReferenceKind | null {
        return this.#reference;
    }

    /** A version's scan (once per version) and the reference asked for. */
    load(version: GeorefVersion, wanted: ReferenceKind | null): void {
        void this.#warpCode();
        if (version.id !== this.#versionId) {
            this.#versionId = version.id;
            void this.#loadScan(version.scan);
        }
        const choice = referenceOf(version, wanted);
        const kind = choice?.kind ?? null;
        if (kind !== this.#reference) {
            this.#reference = kind;
            this.#choice = choice;
            this.#deps.overlays.remove(REFERENCE_PICTURE);
            void this.#showReference(choice);
        }
    }

    /**
     * The scan pane shows `scale` CSS px a scan pixel on a screen of `ratio` device px a CSS px: once a preview pixel covers more than
     * one device pixel, the version's sharper scan is fetched (once a version; a failed fetch leaves the preview, as a version without
     * one does): the file of its tiles (`scan-tiles.bin`), of which the pane decodes only the ones it shows, from the same threshold
     * (`packages/ui/src/admin/georef/scan-tiles.ts` `detailScene`).
     */
    zoomed(scan: Scan | null, scale: number, ratio: number): void {
        const detail = scan !== null && scale * ratio > scan.previewScale ? scan.detail : null;
        if (detail !== null && !this.#detailAsked) {
            this.#detailAsked = true;
            void this.#loadDetail(detail);
        }
    }

    async #loadDetail({ path, scale }: NonNullable<Scan['detail']>): Promise<void> {
        const generation = this.#generation;
        const file = await this.#deps.files.read(path);
        if (generation === this.#generation && file !== null) {
            this.#deps.detail({ file, scale });
        }
    }

    /** Draws the warped preview of `transform` again (soon, once); null removes it. */
    warp(transform: FittedTransform | null, scan: Scan | null, opacity: number): void {
        this.#next = { transform, scan, opacity };
        if (this.#timer === null) {
            this.#timer = this.#deps.clock.setTimeout(() => {
                this.#timer = null;
                this.#render();
            }, WARP_DELAY_MS);
        }
    }

    /**
     * The map's status: once it is ready, the reference and the preview decoded before it, which had no map to go on then,
     * go on it now (`docs/LESSONS.md` 471).
     */
    mapStatus(status: MapStatus): void {
        if (status === 'ready') {
            void this.#showReference(this.#choice);
            this.#render();
        }
    }

    setOpacity(opacity: number): void {
        this.#deps.overlays.setOpacity(WARPED_PICTURE, opacity);
    }

    clear(): void {
        this.#generation += 1;
        if (this.#timer !== null) {
            this.#deps.clock.clearTimeout(this.#timer);
            this.#timer = null;
        }
        if (this.#scanUrl !== null) {
            this.#deps.files.release(this.#scanUrl);
        }
        this.#scanUrl = null;
        this.#detailAsked = false;
        this.#scanPicture = null;
        this.#target = null;
        this.#versionId = null;
        this.#reference = null;
        this.#choice = null;
        this.#next = null;
        this.#deps.scan({ status: 'none' });
        this.#deps.detail(null);
    }

    async #loadScan(scan: Scan | null): Promise<void> {
        if (scan === null) {
            this.#deps.scan({ status: 'none' });
            return;
        }
        const generation = this.#generation;
        this.#deps.scan({ status: 'loading' });
        const url = await this.#deps.files.url(scan.previewPath);
        const picture = await this.#decode(scan.previewPath);
        if (generation !== this.#generation) {
            this.#release(url);
            return;
        }
        this.#scanUrl = url;
        this.#scanPicture = picture;
        this.#deps.scan(url === null ? { status: 'failed' } : { status: 'ready', url });
        this.#render();
    }

    async #showReference(choice: ReferenceChoice | null): Promise<void> {
        // The base map is OpenStreetMap already: its lines stretched over the city only blur it (the owner, 2026-11-10).
        if (choice === null || choice.kind === 'osm') {
            return;
        }
        const decoded = await this.#decode(choice.path);
        if (decoded === null || choice.kind !== this.#reference) {
            return;
        }
        this.#deps.overlays.show({ id: REFERENCE_PICTURE, picture: decoded.picture, corners: cornersOfBox(choice.bounds), opacity: 1 });
        // The reference went on top: the warped preview goes back above it.
        this.#render();
    }

    async #decode(path: string): Promise<Decoded | null> {
        const pictures = this.#deps.pictures;
        if (pictures === null) {
            return null;
        }
        const picture = await pictures.decode(() => this.#deps.files.read(path), DECODE_MAX_SIDE);
        return picture === null ? null : { pictures, picture };
    }

    #release(url: string | null): void {
        if (url !== null) {
            this.#deps.files.release(url);
        }
    }

    #render(): void {
        const input = this.#ready();
        if (input === null) {
            this.#deps.overlays.remove(WARPED_PICTURE);
            return;
        }
        if (this.#warpChunk === null) {
            void this.#warpCode();
            return;
        }
        this.#draw(this.#warpChunk, input);
    }

    /** The warp chunk, fetched once (asked for when a version opens); a failed fetch is asked for again at the next draw. */
    async #warpCode(): Promise<void> {
        if (this.#warpAsked) {
            return;
        }
        this.#warpAsked = true;
        try {
            this.#warpChunk = await (this.#deps.warp ?? loadWarp)();
            this.#render();
        } catch {
            this.#warpAsked = false;
        }
    }

    /** The scan decoded and a fit to draw it through, or null (the preview is then taken off the map). */
    #ready(): ReadyWarp | null {
        const next = this.#next;
        const source = this.#scanPicture;
        if (next === null || source === null) {
            return null;
        }
        const { transform, scan, opacity } = next;
        return transform === null || scan === null ? null : { source, transform, scan, opacity };
    }

    #draw({ warpFrame, warpSideFor, warpTriangles }: typeof WarpChunk, input: ReadyWarp): void {
        const { pictures, picture } = input.source;
        // A phone-sized window draws the preview half as long: a quarter of the canvas's memory (the resource audit, 2026-11-12).
        const frame = warpFrame(input.transform, input.scan, warpSideFor((globalThis as { innerWidth?: number }).innerWidth));
        const target = this.#targetOf(pictures, frame.width, frame.height);
        pictures.draw(target, picture, warpTriangles(input.transform, frame, input.scan, picture));
        this.#deps.overlays.show({ id: WARPED_PICTURE, picture: target, corners: cornersOfBox(frame.bounds), opacity: input.opacity });
    }

    /** The warped canvas, made again only when its size changes. */
    #targetOf(pictures: PicturePort, width: number, height: number): Picture {
        const kept = this.#target;
        const target = kept !== null && kept.width === width && kept.height === height ? kept : pictures.blank(width, height);
        this.#target = target;
        return target;
    }
}

/** The georeferencer store's pictures: the scan and the sharper scan go to its state. */
export function georefPicturesOf(
    services: Pick<ContentServices, 'files' | 'pictures' | 'clock'>,
    overlays: PictureOverlays,
    cell: Store<GeorefState>,
): GeorefPictures {
    return new GeorefPictures({
        ...{ files: services.files ?? NO_FILES, pictures: services.pictures ?? null, clock: services.clock, overlays },
        scan: (scan) => {
            cell.update({ scan });
        },
        detail: (scanDetail) => {
            cell.update({ scanDetail });
        },
    });
}
