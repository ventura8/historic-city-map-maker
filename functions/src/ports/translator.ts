/**
 * Vertex AI Gemini (M4, `docs/research/M4-interfaces.md` §4.3), called with the functions' own service account
 * (`fn-admin@`, the custom role `hcmVertexDrafts`; no key anywhere, never from a browser): `generateContent` on
 * `https://{VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/{p}/locations/{VERTEX_LOCATION}/publishers/google/
 * models/{VERTEX_MODEL_ID}:generateContent` with the prompt of `translationPrompt` (`systemInstruction`, one user turn,
 * `generationConfig {temperature, maxOutputTokens, responseMimeType: 'text/plain', candidateCount: 1}`), and
 * `countTokens` on the same model for the setup self-test (free). Adapter `functions/src/adapters/vertex-ai.ts`
 * (assists-notify), tokens from `TokenProvider`; failures are `UpstreamError('vertex-ai', …)`: `forbidden` with `api` for
 * a disabled API (`apiError.cloud.apiDisabled`), `rateLimited` for a 429 quota, `unavailable` for 5xx and timeouts.
 */
import type { TranslationPrompt } from '@hcm/shared';

/** One answer: its text as the model wrote it (`sanitizeDraft` makes the draft) and what it cost. */
interface Generation {
    readonly text: string;
    /** `candidates[0].finishReason`: `STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `OTHER`. */
    readonly finishReason: string;
    /** `usageMetadata.promptTokenCount` and `candidatesTokenCount`. */
    readonly inputTokens: number;
    readonly outputTokens: number;
}

export interface Translator {
    generate(model: string, prompt: TranslationPrompt): Promise<Generation>;
    /** `countTokens` of a short text: proves the API, the role and the model without a charge. */
    countTokens(model: string, text: string): Promise<number>;
}
