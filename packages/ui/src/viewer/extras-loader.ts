/**
 * The side-load of the full-size view (the owner's "Load extras on demand", 2026-11-09; docs/ENGINE_API.md → *Side-loaded
 * parts*): `<hcm-lightbox>` is not in the engine's script but in `engine.extras.js` beside it, which the engine adds as a
 * `<script>` with its Subresource Integrity the first time a visitor opens a photo full size. The part reads the viewer's
 * Lit and helpers from `globalThis.__hcmExtrasKit` (`extras-kit.ts`), set here just before. One load at a time: a
 * second open while it loads waits for the same one; a failed load (offline, a changed file refused by its integrity) is
 * forgotten, so the next open tries again.
 */
import * as kit from './extras-kit.js';

/** The global the part reads its kit from (`packages/engine/vite.part.config.ts` names the same). */
export const EXTRAS_KIT_GLOBAL = '__hcmExtrasKit';

/** Where the part is and its `sha384-…` integrity (empty: none, as in a development build). */
export interface PartFile {
    readonly url: string;
    readonly integrity: string;
}

let loading: Promise<void> | null = null;

function inject(doc: Document, part: PartFile): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = doc.createElement('script');
        script.src = part.url;
        if (part.integrity !== '') {
            script.integrity = part.integrity;
            script.crossOrigin = 'anonymous';
        }
        script.addEventListener('load', () => {
            resolve();
        });
        script.addEventListener('error', () => {
            script.remove();
            reject(new Error(`the full-size view did not load: ${part.url}`));
        });
        doc.head.append(script);
    });
}

/** Loads `<hcm-lightbox>` once into `doc`; resolves at once when it is already defined. */
export function sideLoadExtras(doc: Document, part: PartFile, registry: CustomElementRegistry = customElements): Promise<void> {
    if (registry.get('hcm-lightbox') !== undefined) {
        return Promise.resolve();
    }
    Object.assign(globalThis, { [EXTRAS_KIT_GLOBAL]: kit });
    loading ??= inject(doc, part).catch((error: unknown) => {
        loading = null;
        throw error;
    });
    return loading;
}
