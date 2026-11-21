/**
 * The bindings of `@hcm/shared` the extras take from the engine (`host.ts`): the messages and the manifest's helpers, one
 * copy and one catalogue state on the page, and the field chunk's event guard and web-vitals mapping, which need zod (the
 * engine's own copy). The build fails when an extra imports a binding this list does not hold
 * (`scripts/site/src/engine-extras.ts`).
 */
export {
    DEFAULT_FOV,
    PHOTOS_OVERLAY_ID,
    conePolygon,
    createViewerGuard,
    findOverlay,
    isHttpsUrl,
    isPhotoNearYear,
    localized,
    observeWebVitals,
    overlayLabel,
    poiIcon,
    poiInYear,
    rasterAdjustmentPaint,
    translate,
    withOverlayVisibility,
} from '@hcm/shared';
// Swipe compare's labels word the layers' credits in the visitor's language (`@hcm/shared/credits`, the same host entry).
export { localizedCredit } from '@hcm/shared/credits';
