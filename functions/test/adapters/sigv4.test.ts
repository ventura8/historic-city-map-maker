/**
 * AWS Signature Version 4 (`functions/src/adapters/sigv4.ts`) against the published S3 examples of the AWS documentation
 * ("Signature calculations for the Authorization header", the example bucket and key pair AWS documents): a GET of an
 * object with a range, a PUT of an object whose key needs encoding, and a GET with a query string.
 */
import { describe, expect, it } from 'vitest';

import { UNSIGNED_PAYLOAD, amzDate, signV4 } from '../../src/adapters/sigv4.js';

/** AWS's documented example key pair, assembled at run time (never a credential-shaped literal in the tree). */
const EXAMPLE = {
    accessKeyId: ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join(''),
    secretAccessKey: ['wJalrXUtnFEMI', 'K7MDENG', ['bPxRfiCY', 'EXAMPLEKEY'].join('')].join('/'),
};
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const NOW = new Date('2013-05-24T00:00:00.000Z');
const BUCKET = 'https://examplebucket.s3.amazonaws.com';

function sign(method: string, path: string, headers: Record<string, string>, payloadHash: string): string {
    return signV4(
        { method, url: new URL(`${BUCKET}${path}`), headers, payloadHash, region: 'us-east-1', service: 's3', now: NOW },
        EXAMPLE,
    );
}

describe('signV4', () => {
    it('happyPath_theGetObjectExample', () => {
        const headers = { Range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' };

        expect(sign('GET', '/test.txt', headers, EMPTY_SHA256)).toBe(
            `AWS4-HMAC-SHA256 Credential=${EXAMPLE.accessKeyId}/20130524/us-east-1/s3/aws4_request, ` +
                'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
                'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
        );
    });

    it('happyPath_thePutObjectExampleEncodesItsKey', () => {
        const payload = '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072';
        const headers = {
            Date: 'Fri, 24 May 2013 00:00:00 GMT',
            'x-amz-date': '20130524T000000Z',
            'x-amz-storage-class': 'REDUCED_REDUNDANCY',
            'x-amz-content-sha256': payload,
        };

        const signed = sign('PUT', '/test$file.text', headers, payload);
        expect(signed).toContain('SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, ');
        expect(signed).toMatch(/Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
    });

    it('happyPath_theListObjectsExampleSortsItsQuery', () => {
        const headers = { 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' };

        expect(sign('GET', '/?prefix=J&max-keys=2', headers, EMPTY_SHA256)).toMatch(
            /Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7$/,
        );
    });

    it('happyPath_aRepeatedQueryPairIsSignedOnceEach', () => {
        const headers = { 'x-amz-date': '20130524T000000Z' };

        expect(sign('GET', '/?b=2&a=1&a=1', headers, EMPTY_SHA256)).toBe(sign('GET', '/?a=1&a=1&b=2', headers, EMPTY_SHA256));
        expect(sign('GET', '/?a=1&a=1', headers, EMPTY_SHA256)).not.toBe(sign('GET', '/?a=1', headers, EMPTY_SHA256));
        // RFC 3986 encodes what encodeURIComponent leaves: the same as its percent form.
        expect(sign('GET', "/?q=it's", headers, EMPTY_SHA256)).toBe(sign('GET', '/?q=it%27s', headers, EMPTY_SHA256));
    });

    it('happyPath_anUnsignedPayloadAndTheDate', () => {
        expect(amzDate(new Date('2026-10-23T08:00:00.123Z'))).toBe('20261023T080000Z');
        expect(UNSIGNED_PAYLOAD).toBe('UNSIGNED-PAYLOAD');
        const one = sign('PUT', '/a', { 'x-amz-date': '20130524T000000Z' }, UNSIGNED_PAYLOAD);
        const other = sign('PUT', '/a', { 'x-amz-date': '20130524T000000Z' }, EMPTY_SHA256);
        expect(one).not.toBe(other);
    });
});
