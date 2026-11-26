/**
 * Lit's bindings the extras take from the engine instead of carrying their own copy (`host.ts`); the build fails when an
 * extra imports one of Lit's bindings this list does not hold (`scripts/site/src/engine-extras.ts`).
 */
export { LitElement, css, html } from 'lit';
