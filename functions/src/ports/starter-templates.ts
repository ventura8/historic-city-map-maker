import type { WORKER_STARTER_TEMPLATES } from '@hcm/shared';

/** A starter template's file name (`hcm-worker.sh`, `hcm-worker.bat`). */
export type StarterTemplateName = (typeof WORKER_STARTER_TEMPLATES)[keyof typeof WORKER_STARTER_TEMPLATES];

/**
 * The starter files' templates (finding 73 of 2026-11-03, `docs/research/M7-local-worker.md`, its addendum of 2026-11-03):
 * `functions/build.mjs` copies `packages/admin/starter/` into `functions/dist/starter/`; adapter
 * `functions/src/adapters/starter-templates.ts` reads that folder, `worker.starter` fills a template.
 */
export interface StarterTemplates {
    read(name: StarterTemplateName): Promise<string>;
}
