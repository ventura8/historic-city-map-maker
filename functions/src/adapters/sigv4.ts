/**
 * AWS Signature Version 4 (`node:crypto` only, no SDK): the `Authorization` header of one request, for the S3 `PUT` of
 * Mapbox's Uploads API with the temporary credentials Mapbox hands out (`functions/src/adapters/mapbox-uploads.ts`). The
 * signed headers are `host` and the ones given (lower-cased, sorted); the body travels as `UNSIGNED-PAYLOAD` for S3, so
 * a streamed file is never hashed in memory. Nothing here logs or keeps a key.
 */
import { createHash, createHmac } from 'node:crypto';

/** S3 accepts an unsigned body over HTTPS (`x-amz-content-sha256: UNSIGNED-PAYLOAD`). */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export interface SigV4Credentials {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
}

export interface SigV4Request {
    readonly method: string;
    readonly url: URL;
    /** The headers to sign besides `host` (`x-amz-date` and `x-amz-content-sha256` among them). */
    readonly headers: Readonly<Record<string, string>>;
    /** The body's SHA-256 in hex, or `UNSIGNED-PAYLOAD`. */
    readonly payloadHash: string;
    readonly region: string;
    readonly service: string;
    readonly now: Date;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';

function sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hmac(key: string | Buffer, text: string): Buffer {
    return createHmac('sha256', key).update(text, 'utf8').digest();
}

/** `YYYYMMDDTHHMMSSZ`, the `x-amz-date` of `now`. */
export function amzDate(now: Date): string {
    return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/** RFC 3986 encoding (what `encodeURIComponent` leaves of `!'()*` too). */
function encode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Byte order, as SigV4 sorts (never the locale's). */
function byCodePoint(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

/** The query string as SigV4 orders it: each pair encoded, sorted by name then value. */
function canonicalQuery(url: URL): string {
    return [...url.searchParams.entries()]
        .map(([name, value]) => `${encode(name)}=${encode(value)}`)
        .sort(byCodePoint)
        .join('&');
}

/** The path, each segment RFC 3986 encoded once (S3 does not encode twice). */
function canonicalPath(url: URL): string {
    return url.pathname
        .split('/')
        .map((part) => encode(decodeURIComponent(part)))
        .join('/');
}

/** The signed headers, lower-cased with trimmed values, `host` included, sorted by name. */
function canonicalHeaders(request: SigV4Request): readonly (readonly [string, string])[] {
    const entries = Object.entries(request.headers).map(
        ([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const,
    );
    return [['host', request.url.host] as const, ...entries].sort(([left], [right]) => byCodePoint(left, right));
}

/** The `Authorization` header value of `request`, signed with `credentials`. */
export function signV4(request: SigV4Request, credentials: SigV4Credentials): string {
    const date = amzDate(request.now);
    const day = date.slice(0, 8);
    const headers = canonicalHeaders(request);
    const signedHeaders = headers.map(([name]) => name).join(';');
    const canonical = [
        request.method,
        canonicalPath(request.url),
        canonicalQuery(request.url),
        ...headers.map(([name, value]) => `${name}:${value}`),
        '',
        signedHeaders,
        request.payloadHash,
    ].join('\n');
    const scope = `${day}/${request.region}/${request.service}/aws4_request`;
    const toSign = [ALGORITHM, date, scope, sha256Hex(canonical)].join('\n');
    const key = [day, request.region, request.service, 'aws4_request'].reduce<string | Buffer>(
        (previous, part) => hmac(previous, part),
        `AWS4${credentials.secretAccessKey}`,
    );
    const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
    return `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
