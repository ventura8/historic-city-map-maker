/**
 * What the places area's live reads share is defined in the root manifest and its dependencies. */
export function livePartsOf(services: { store: any, clock: any }) {
    return { store: services.store, clock: services.clock };
}
