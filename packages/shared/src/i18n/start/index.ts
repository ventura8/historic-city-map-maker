import { catalogueTranslator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type StartKey } from './ro.js';

export type { StartKey };

/** The texts of the start page (M14, `docs/research/M14-start-your-map.md`): nothing else imports them. */
export const translateStart = catalogueTranslator<StartKey>({ ro, en });
