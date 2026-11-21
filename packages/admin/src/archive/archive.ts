/**
 * The admin's lazy `archive` chunk (`docs/research/M20-import-local.md` §8; its budget in `scripts/ci/check_bundle_budget.py`): its
 * one dynamic entry, which the Imagery store imports (`ImageryIntents.archive`, `ImageryIntents.archiveElements`). It holds Import
 * local files' feed and the elements of `@hcm/ui/admin/archive` (the Upload view's card, an archive's report) with their texts.
 */
export { createArchiveFeed } from './feed.js';
export { defineArchiveElements } from '@hcm/ui/admin/archive';
