/**
 * The admin's GA4 events (`docs/ARCHITECTURE.md` → *Field measurements*): what it sent before §76, unchanged, then its
 * field measurements. Only the admin's field chunk imports this table, so the viewer's chunk never carries it.
 */
import { z } from 'zod';

import {
    COMMON_EVENT_PARAMS,
    CONTEXT_PARAMS,
    countSchema,
    createFieldGuard,
    eventSchemas,
    msSchema,
    tokenSchema,
    type FieldGuard,
} from './field-events.js';
import { WIZARD_IDS } from './wizard-funnel.js';

/** A wizard's funnel (`funnel-hub.ts`): the wizard, the step, the how-many-th time the step is shown. */
const WIZARD = { wizard_id: z.enum(WIZARD_IDS), ...CONTEXT_PARAMS };
const STEP = { ...WIZARD, step_id: tokenSchema };
const attempt = z.number().int().min(1).max(10_000);

/** The wizard funnels' events (docs/ARCHITECTURE.md → *Wizard funnels*): ids, codes, counts and milliseconds only. */
export const FUNNEL_EVENT_PARAMS = {
    wizard_start: WIZARD,
    step_view: { ...STEP, attempt },
    step_complete: { ...STEP, attempt, duration_ms: msSchema },
    step_back: { ...STEP, attempt },
    step_error: { ...STEP, error_code: tokenSchema, attempt },
    step_help_opened: STEP,
    step_action: { ...STEP, action: tokenSchema },
    wizard_abandon: { ...STEP, duration_ms: msSchema },
    wizard_complete: { ...WIZARD, duration_ms: msSchema },
};

export const ADMIN_EVENT_PARAMS = {
    page_view: { route: tokenSchema },
    setup_step: { step: tokenSchema, state: tokenSchema },
    legacy_import: { imported: countSchema, failed: countSchema },
    ...COMMON_EVENT_PARAMS,
    admin_ready: { duration_ms: msSchema, restored: z.boolean(), ...CONTEXT_PARAMS },
    setup_check: { step: tokenSchema, outcome: tokenSchema, error_code: tokenSchema.optional(), duration_ms: msSchema, ...CONTEXT_PARAMS },
    install_build: {
        target: z.enum(['server', 'pipeline', 'site']),
        outcome: tokenSchema,
        duration_ms: msSchema.optional(),
        failed_step: tokenSchema.optional(),
        ...CONTEXT_PARAMS,
    },
    provision_item: { item: tokenSchema, outcome: tokenSchema, ...CONTEXT_PARAMS },
    editor_save: {
        area: tokenSchema,
        operation: z.enum(['update', 'create', 'remove', 'batch']),
        outcome: tokenSchema,
        duration_ms: msSchema,
        ...CONTEXT_PARAMS,
    },
    job_done: { job_type: tokenSchema, status: tokenSchema, duration_ms: msSchema, ...CONTEXT_PARAMS },
    /** A journey's step (`field-actions.ts`): `imagery_import`, `imagery_saveGcps`, `imagery_approve`… and its outcome. */
    admin_action: { action: tokenSchema, outcome: tokenSchema, duration_ms: msSchema, ...CONTEXT_PARAMS },
    ...FUNNEL_EVENT_PARAMS,
};

export type AdminEventName = keyof typeof ADMIN_EVENT_PARAMS;

/** One admin page's guard. */
export function createAdminGuard(): FieldGuard {
    return createFieldGuard(eventSchemas(ADMIN_EVENT_PARAMS));
}
