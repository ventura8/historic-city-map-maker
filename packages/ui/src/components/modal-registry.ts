/**
 * The kit's open modal dialogs, per document: `<hcm-dialog>` reports its own while it is open, and a box that must not be
 * drawn under their scrim follows them (`watchModals`). The admin's map hides itself meanwhile: a scrim over it would cover
 * Mapbox's logo and attribution, which Mapbox's terms require wherever the map shows (the viewer mirrors them instead,
 * `docs/LESSONS.md` 23); a hidden map needs neither.
 */

/** Called with whether any modal dialog of the document is open. */
export type ModalListener = (open: boolean) => void;

interface Registry {
    readonly open: Set<object>;
    readonly listeners: Set<ModalListener>;
}

const registries = new WeakMap<Document, Registry>();

function registryOf(document: Document): Registry {
    let registry = registries.get(document);
    if (registry === undefined) {
        registry = { open: new Set(), listeners: new Set() };
        registries.set(document, registry);
    }
    return registry;
}

/** `owner` (a dialog) is now open or closed; the listeners hear of it when the document's answer changes. */
export function reportModal(document: Document, owner: object, open: boolean): void {
    const registry = registryOf(document);
    const before = registry.open.size > 0;
    if (open) {
        registry.open.add(owner);
    } else {
        registry.open.delete(owner);
    }
    const after = registry.open.size > 0;
    if (before !== after) {
        for (const listener of [...registry.listeners]) {
            listener(after);
        }
    }
}

/** Follows whether a modal dialog of `document` is open: `listener` is called at once, then on each change. */
export function watchModals(document: Document, listener: ModalListener): () => void {
    const registry = registryOf(document);
    registry.listeners.add(listener);
    listener(registry.open.size > 0);
    return () => {
        registry.listeners.delete(listener);
    };
}
