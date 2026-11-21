/**
 * Redaction of free text that leaves a device or a function (crash reports, log lines built from outside data): no
 * URL query or fragment (the viewer's hash holds the visitor's view, a tile URL the access token), no token-looking
 * string (a JSON Web Token too: a Firebase ID token, an App Check token), no e-mail address. The same rules as
 * `createLogger`'s key redaction, for values. The engine's error reporter and the `telemetry.reportError` endpoint both
 * apply it (the endpoint again, since the body comes from outside).
 */
import { REDACTED } from '../log.js';

const URL_TAIL = /(https?:\/\/[^\s?#'"()]+)[?#][^\s'"()]*/g;
const SECRETS = [
    /\b[ps]k\.[\w.-]{8,}/g,
    /\bAIza[\w-]{20,}/g,
    /\bya29\.[\w.-]{8,}/g,
    /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g,
    /\b(?:access_)?token=[^\s&'"]+/gi,
    /\b[\w.+-]{1,64}@[a-z\d-]{1,63}(?:\.[a-z\d-]{1,63}){1,4}\b/gi,
];

/** `text` without URL queries and fragments, tokens and e-mail addresses. */
export function redactText(text: string): string {
    return SECRETS.reduce((current, pattern) => current.replace(pattern, REDACTED), text.replace(URL_TAIL, '$1'));
}
