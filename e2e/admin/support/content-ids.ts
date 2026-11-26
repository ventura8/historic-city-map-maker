import { createHash, randomUUID } from 'node:crypto';

/**
 * The marks of the content world (docs/research/M2c-interfaces.md §12.3, CR-M2c-7): each content spec and each admin tour
 * journey edits a city of its own, signed in as a Google account of its own, so they run in parallel without the admin
 * tier's lock. The reset of a locked admin test (`EmulatorWorld.reset`) empties everything else and keeps what carries
 * these marks: the cities named `w-<10 hex>` (their documents, `manifests/<city>` and their Storage objects) and the
 * accounts of the domain `content.e2e.test` (in Auth and in `admins/`).
 */

/** A content world's city: `w-` and ten hex digits of its test's id (a valid `CITY_ID_PATTERN` id). */
const CONTENT_CITY = /^w-[a-f0-9]{10}$/;

/** The mail domain of the content world's Google accounts (`.test` is reserved, RFC 2606). */
const CONTENT_DOMAIN = 'content.e2e.test';

/** The ids of one content world. */
export interface ContentIds {
    /** The city it edits. */
    readonly city: string;
    /** Its Google account: the subject, the address and the name. */
    readonly sub: string;
    readonly email: string;
    readonly displayName: string;
}

/** True for a content world's city id. */
export function isContentCity(id: string): boolean {
    return CONTENT_CITY.test(id);
}

/** True for a content world's Google address. */
export function isContentEmail(email: unknown): boolean {
    return typeof email === 'string' && email.toLowerCase().endsWith(`@${CONTENT_DOMAIN}`);
}

/**
 * New ids for a content world of the test `testId`: a run of a test never meets what an earlier run of it left (the
 * emulators outlive a run outside CI, and a deleted document's history trigger may still write after a clean-up).
 */
export function contentIdsOf(testId: string, nonce: string = randomUUID()): ContentIds {
    const hash = createHash('sha256').update(`${testId}\n${nonce}`).digest('hex').slice(0, 10);
    const email = `editor-${hash}@${CONTENT_DOMAIN}`;
    // The subject Google's consent stand-in gives an account it does not know as a persona (e2e/mock-apis/oauth.ts), so a
    // consent in the content world returns the same Google user.
    return { city: `w-${hash}`, sub: `e2e-${email}`, email, displayName: 'E2E Editor' };
}
