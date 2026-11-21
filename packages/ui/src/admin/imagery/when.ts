/**
 * Conditional parts of the Imagery and georeferencer templates: one helper decides, so each template function keeps its
 * own complexity low and every helper returns a `TemplateResult` (the empty one when there is nothing to show).
 */
import type { TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';

const empty = (): TemplateResult => EMPTY;

/** `render()` when `condition` holds, else the empty template (Lit's `when` directive, without the directive). */
export function when(condition: boolean, render: () => TemplateResult): TemplateResult {
    const chosen = condition ? render : empty;
    return chosen();
}

/** `render(value)` when there is a value, else the empty template. */
export function withValue<T>(value: T | null | undefined, render: (value: T) => TemplateResult): TemplateResult {
    return value === null || value === undefined ? EMPTY : render(value);
}
