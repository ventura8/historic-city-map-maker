/**
 * Stories (M17, `docs/research/M17-stories.md`): a titled text in Romanian and English, linked to photos, places and years.
 * The manifest carries `stories[]` (§4); the Firestore document `cities/{city}/stories/{story}` (§1, `storyDocSchema` of
 * `firestore.ts`) is written by staff and by uploaders through the review queue of M13. The text is the story format of
 * `text/story.ts`: the Markdown subset of the city's texts plus figures of the city's own photos, https links only.
 */
import { z } from 'zod';

import { storyRejectedLinks } from '../text/story.js';
import { coded, idSchema, localizedPartial, plainText, validYearSpan, yearSchema } from './primitives.js';

/** Stories one manifest may list. */
export const MAX_STORIES = 1000;
/** Photos and places one story may name. */
export const MAX_STORY_LINKS = 20;
/** The longest story text in one language (the rules bound it the same). */
export const MAX_STORY_TEXT = 10_000;

/** A story text whose links are all https (figures of `photo:<id>` are not links). */
const storyText = plainText(MAX_STORY_TEXT).refine((text) => storyRejectedLinks(text).length === 0, coded('validation.markdownLink'));

/** Romanian required, English optional: the viewer falls back to Romanian. */
export const localizedStorySchema = z.strictObject({ ro: storyText, en: storyText.optional() });

/** What a story says in the manifest and in its document alike. */
export const storyFields = {
    title: localizedPartial(200),
    yearStart: yearSchema.optional(),
    yearEnd: yearSchema.optional(),
    /** Photos the story is about (manifest photo ids, placed or not); the first is its cover. */
    photoIds: z.array(idSchema).max(MAX_STORY_LINKS).optional(),
    /** Places the story is about (manifest POI ids). */
    poiIds: z.array(idSchema).max(MAX_STORY_LINKS).optional(),
};

export const storySchema = z
    .strictObject({
        id: idSchema,
        ...storyFields,
        body: localizedStorySchema,
        /** M13: the name its contributor asked to be credited under. */
        credit: plainText(100).optional(),
    })
    .refine(validYearSpan, coded('validation.yearRange', ['yearEnd']));

export type Story = z.infer<typeof storySchema>;
