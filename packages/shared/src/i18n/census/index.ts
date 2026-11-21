import { catalogueTranslator, type Translator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type CensusKey } from './ro.js';

export type { CensusKey } from './ro.js';

/** The imagery census's texts (M29, `docs/research/M29-imagery-census.md`). */
export const translateCensus: Translator<CensusKey> = catalogueTranslator<CensusKey>({ ro, en });
