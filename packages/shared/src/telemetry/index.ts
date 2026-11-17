export {
    APP_SURFACES,
    COMMON_EVENT_PARAMS,
    SURFACE_PARAMS,
    FIELD_EVENT_BUDGET,
    GA_LIMITS,
    MAP_ERROR_KINDS,
    VIEWER_PHASES,
    VITAL_DEBUG_NUMBERS,
    WEB_VITAL_NAMES,
    WINDOW_CLASS_NAMES,
    createFieldGuard,
    eventProblem,
    eventSchemas,
} from './field-events.js';
export type * from './field-events.js';
export { INPUT_DEVICES, VIEWER_EVENT_PARAMS, createViewerGuard, type ViewerEventName } from './viewer-events.js';
export { ADMIN_EVENT_PARAMS, FUNNEL_EVENT_PARAMS, createAdminGuard, type AdminEventName } from './admin-events.js';
export { observeWebVitals, sanitizeTarget, shortTarget, vitalParams } from './web-vitals.js';
export { privacySignal, type PrivacyNavigator } from './privacy.js';
export type { FieldChunk, VitalAttribution, VitalMetric, VitalObserver, VitalOptions } from './web-vitals.js';
