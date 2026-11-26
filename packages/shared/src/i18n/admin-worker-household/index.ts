import { catalogueTranslator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type AdminWorkerHouseholdKey } from './ro.js';

export type { AdminWorkerHouseholdKey } from './ro.js';

/** The city's computers' texts (W5, household computers), fetched with the admin's `worker-household` chunk only. */
export const translateAdminWorkerHousehold = catalogueTranslator<AdminWorkerHouseholdKey>({ ro, en });
