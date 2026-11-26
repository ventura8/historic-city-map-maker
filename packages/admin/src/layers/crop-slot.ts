/**
 * The layer editor's Crop slot (`docs/research/M3-interfaces.md` §10.5; CR-M3-7), in the layers chunk: Crop loads the
 * `layer-geometry` chunk once (`ContentServices.layerCrop`), creates the tool for the open layer and forwards Redraw and
 * Save to it; another layer, the list or leaving the page closes it. A chunk that fails to load says so; Crop tries again.
 */
import type { ContentServices } from '../content/services.js';
import type { CropState, CropTool } from './geometry/types.js';
import type { AreaMap } from './map-session.js';

export interface CropSlotDeps {
    readonly services: ContentServices;
    readonly map: Pick<AreaMap, 'drawing'>;
    /** The tool's state, or null when it closes. */
    readonly changed: (crop: CropState | null) => void;
}

const LOADING: CropState = { phase: 'loading', vertices: 0, refusal: null };

export class CropSlot {
    readonly #deps: CropSlotDeps;
    #tool: CropTool | null = null;
    #open = false;
    /** Bumped by every open and close: a slower load of an older open is dropped. */
    #generation = 0;

    constructor(deps: CropSlotDeps) {
        this.#deps = deps;
    }

    /** Crop on layer `layerId`: the tool, once its chunk is here. */
    async open(layerId: string): Promise<void> {
        this.close();
        const { services, map } = this.#deps;
        const load = services.layerCrop ?? null;
        if (load === null) {
            services.notify({ key: 'adminContent.imagery.layer.cropUnavailable' });
            return;
        }
        const generation = this.#generation;
        this.#open = true;
        this.#deps.changed(LOADING);
        const factory = await load().catch(() => null);
        if (generation !== this.#generation) {
            return;
        }
        if (factory === null) {
            this.close();
            services.notify({ key: 'adminContent.imagery.layer.cropUnavailable' });
            return;
        }
        const done = (): void => {
            this.close();
        };
        const tool = factory({ services, map, layerId, changed: this.#deps.changed, done });
        this.#tool = tool;
        await tool.start();
    }

    redraw(): void {
        this.#tool?.redraw();
    }

    addCorner(): void {
        this.#tool?.addCorner();
    }

    save(): Promise<boolean> {
        return this.#tool?.save() ?? Promise.resolve(false);
    }

    close(): void {
        this.#generation += 1;
        this.#tool?.close();
        this.#tool = null;
        if (this.#open) {
            this.#open = false;
            this.#deps.changed(null);
        }
    }
}
