/**
 * `wikipedia.manage` (`docs/research/M31-wikipedia.md` §3): the admin's one callable for the Wikipedia overlay. `get` reads
 * the city's settings and the last fetch's articles (the state document is the functions' only); `save` writes the
 * settings and rebuilds the manifest (other languages also ask for a new fetch); `refresh` asks for a new fetch and a
 * build now, whatever the cache's age.
 */
import { z } from 'zod';

import { cityIdSchema } from '../schemas/paths.js';
import { WIKIPEDIA_FAILURES, wikipediaArticleIdSchema, wikipediaLanguageSchema, wikipediaSettingsSchema } from '../schemas/wikipedia.js';

export const wikipediaManageRequestSchema = z.discriminatedUnion('action', [
    z.strictObject({ cityId: cityIdSchema, action: z.literal('get') }),
    z.strictObject({ cityId: cityIdSchema, action: z.literal('save'), settings: wikipediaSettingsSchema }),
    z.strictObject({ cityId: cityIdSchema, action: z.literal('refresh') }),
]);

/** One article of the admin's list: its id, title and language (the version shown first). */
export const wikipediaListedArticleSchema = z.strictObject({
    id: wikipediaArticleIdSchema,
    title: z.string().max(200),
    language: wikipediaLanguageSchema,
});

export const wikipediaManageResponseSchema = z.strictObject({
    settings: wikipediaSettingsSchema,
    /** ISO time of the last fetch that succeeded. */
    refreshedAt: z.iso.datetime().optional(),
    /** A fetch waits for the next build. */
    refreshRequested: z.boolean(),
    failure: z.enum(WIKIPEDIA_FAILURES).optional(),
    articles: z.array(wikipediaListedArticleSchema),
});

export type WikipediaManageRequest = z.infer<typeof wikipediaManageRequestSchema>;
export type WikipediaManageResponse = z.infer<typeof wikipediaManageResponseSchema>;
export type WikipediaListedArticle = z.infer<typeof wikipediaListedArticleSchema>;
