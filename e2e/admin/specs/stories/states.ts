/**
 * M17's states of the tour inventory (docs/research/M17-stories.md §6; `ADMIN_SECTION_STATES` of e2e/tour/admin-sections.ts spreads
 * them), ids `stories.<state>`, each reached by e2e/admin/specs/stories/stories.spec.ts at the admin tier's projects.
 */
export const STORIES_STATES = {
    'stories.editor': {
        title: 'A story in its editor: both texts, the years, its photos and places, Published',
        visit: 'specs/stories/stories.spec.ts',
    },
    'stories.refused-link': {
        title: 'A story whose text has an http link: said at the text, Save off',
        visit: 'specs/stories/stories.spec.ts',
    },
    'stories.uploader': {
        title: "An uploader's story: waiting for a moderator, no Published switch",
        visit: 'specs/stories/stories.spec.ts',
    },
    'stories.moderator': {
        title: "A moderator's story editor: Published, and no New story, Delete or Versions",
        visit: 'specs/stories/stories.spec.ts',
    },
} as const;
