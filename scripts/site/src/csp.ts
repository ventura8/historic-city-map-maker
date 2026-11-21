/**
 * The meta Content Security Policy of a city site: the one table of every static page that boots the engine,
 * `packages/shared/src/kit/csp.ts` (CR-M5-6, `docs/research/M5-interfaces.md` §3.2), so the sites, the starter kit and the
 * static export never drift (`docs/research/DECISIONS-for-review.md` §15c). A site's engine is its own (`'self'`, the
 * default), and it adds the origins its manifest and configuration name (`origins.ts`).
 */
export {
    ANALYTICS_CONNECT_SOURCES,
    ANALYTICS_IMAGE_SOURCES,
    ANALYTICS_SCRIPT_SOURCES,
    MAPBOX_CONNECT_SOURCES,
    MAPBOX_GL_CDN,
    contentSecurityPolicy,
    type ExtraSources,
} from '@hcm/shared';
