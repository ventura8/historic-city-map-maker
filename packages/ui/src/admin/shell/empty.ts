/**
 * The empty template: what an admin render helper returns when it has nothing to show, so every helper returns one type
 * (`TemplateResult`) instead of mixing it with Lit's `nothing` sentinel (as the viewer's `empty.ts`).
 */
import { html, type TemplateResult } from 'lit';

export const EMPTY: TemplateResult = html``;
