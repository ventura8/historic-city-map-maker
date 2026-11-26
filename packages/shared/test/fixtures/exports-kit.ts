/** The starter kit's part of the M5 public API (`src/kit/`, kit-cli; docs/research/M5-interfaces.md §3.2). */
export const KIT_EXPORTS: readonly string[] = [
    'SELF_SOURCE',
    'MAPBOX_GL_CDN',
    'MAPBOX_CONNECT_SOURCES',
    'ANALYTICS_SCRIPT_SOURCES',
    'ANALYTICS_CONNECT_SOURCES',
    'ANALYTICS_IMAGE_SOURCES',
    'NO_EXTRA_SOURCES',
    'contentSecurityPolicy',
    'policyExtras',
    'KitPageError',
    'KIT_FILES',
    'KIT_PLACEHOLDER_TOKEN',
    'KIT_UNPINNED_INTEGRITY',
    'KIT_LOCAL_ENGINE_FOLDER',
    'kitContentSecurityPolicy',
    'fillKitPage',
    'readKitEngine',
    'readKitPolicy',
    'kitResult',
    'isUnpinned',
    // The browser tab icon's limits and callable schemas (`src/api/city-icon.ts`); the glyph, the default and its painter
    // are `@hcm/shared/tab-icon`.
    'CITY_ICON_LIMITS',
    'CITY_ICON_SIZES',
    'cityIconRequestSchema',
    'cityIconResponseSchema',
];
