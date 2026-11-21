/**
 * What the side-loaded full-size view (`engine.extras.js`, built from `extras-part.ts`) takes from the engine instead of
 * carrying its own copy: Lit, the texts, the viewer's helpers. The engine's build of the part turns every import of
 * `hcm-lightbox.ts` and `lightbox-styles.ts` from outside the part into a read of this module's namespace, which
 * `extras-loader.ts` hands over as `globalThis.__hcmExtrasKit` before the part runs; the part's build fails when it
 * needs a name this list does not export (`packages/engine/vite.part.config.ts`). One Lit, so the part's templates are
 * the viewer's.
 */
export { LitElement, css, html, nothing } from 'lit';
export { live } from 'lit/directives/live.js';
export {
    DEFAULT_LOCALE,
    LANGUAGE_NAMES,
    LOCALES,
    localized,
    resolveLocale,
    resolveViewerLocale,
    shownLanguage,
    streetViewUrl,
    translate,
} from '@hcm/shared';
export { installApp, installGivesAccent, watchInstall } from '../app-install.js';
export { cssProperties } from '../components/css-properties.js';
export { deviceAccentState } from '../theme/device-accent.js';
export { tabbableElements, trapTab } from '../components/focus.js';
export { logicalKey } from '../components/internal.js';
export { EMPTY } from './empty.js';
export { fallbackNote } from './fallback-note.js';
export { photoSelectEvent } from './hcm-poi-detail.js';
export { hasVersions, shownView, versionSwitch, viewCredit, viewImage } from './photo-version.js';
export { resolveAssetUrl } from './services.js';
export { baseStyles, detailStyles } from './shared-styles.js';
export { externalLink, renderMarkdown } from './markdown.js';
export { SHORTCUT_ROWS } from './viewer-keyboard.js';
export { closeEvent } from './sheet-frame.js';
export { localizedText } from './text.js';
