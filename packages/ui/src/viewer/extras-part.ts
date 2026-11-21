/**
 * The entry of the side-loaded part `engine.extras.js` (`packages/engine/vite.part.config.ts`): running it registers
 * `<hcm-lightbox>` and the map's menu `<hcm-map-menu>`. Everything it needs besides the element, its zoom and its styles comes from the engine's kit
 * (`extras-kit.ts`).
 */
import { defineHcmAboutDialog } from './hcm-about-dialog.js';
import { defineHcmLightbox } from './hcm-lightbox.js';
import { defineHcmMapMenu } from './map-menu.js';

defineHcmLightbox();
defineHcmAboutDialog();
defineHcmMapMenu();
