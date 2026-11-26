import { describe, expect, it } from 'vitest';

import { isHostOf, isHttpsUrl, isRelativeUrl, MAX_URL_LENGTH, toHttpsUrl } from '../../src/text/urls.js';

describe('isHttpsUrl', () => {
    it.each([['https://example.org/'], ['https://www.flickr.com/photos/x/1/'], ['https://tiles.example.org/{z}/{x}/{y}.png']])(
        'happyPath_%s_isHttps',
        (url) => {
            expect(isHttpsUrl(url)).toBe(true);
        },
    );

    it.each([
        ['http://example.org/'],
        ['javascript:alert(1)'],
        ['data:text/html,x'],
        ['https://user:secret@example.org/'],
        ['https://user@example.org/'],
        ['//example.org/x'],
        ['derived/x/web.webp'],
        ['not a url'],
        [`https://example.org/${'a'.repeat(MAX_URL_LENGTH)}`],
    ])('badPath_%s_isNotHttps', (url) => {
        expect(isHttpsUrl(url)).toBe(false);
    });
});

describe('isRelativeUrl', () => {
    it.each([['derived/ferdinand/web.webp'], ['/cities/bucuresti/manifest.json'], ['./photos/a_b-c.webp'], ['%C8%99.webp']])(
        'happyPath_%s_isRelative',
        (url) => {
            expect(isRelativeUrl(url)).toBe(true);
        },
    );

    it.each([
        ['//evil.example/x'],
        ['https://example.org/x'],
        ['javascript:alert(1)'],
        ['../secret'],
        ['a/../../b'],
        ['a b.webp'],
        ['x?y=1'],
        ['x#y'],
        [''],
        ['a'.repeat(MAX_URL_LENGTH + 1)],
    ])('badPath_%s_isNotRelative', (url) => {
        expect(isRelativeUrl(url)).toBe(false);
    });
});

describe('isHostOf', () => {
    it.each([
        ['flickr.com', 'flickr.com', true],
        ['www.flickr.com', 'flickr.com', true],
        ['WWW.Flickr.Com', 'flickr.com', true],
        ['notflickr.com', 'flickr.com', false],
        ['flickr.com.evil.example', 'flickr.com', false],
    ])('happyPath_%s_of_%s_is_%s', (host, domain, expected) => {
        expect(isHostOf(host, domain)).toBe(expected);
    });
});

describe('toHttpsUrl', () => {
    it('happyPath_keepsHttps', () => {
        expect(toHttpsUrl(' https://www.facebook.com/x?type=3&theater ')).toBe('https://www.facebook.com/x?type=3&theater');
    });

    it('happyPath_upgradesHttpForAKnownHost', () => {
        expect(toHttpsUrl('http://www.example.org/thenow/a/', ['example.org'])).toBe('https://www.example.org/thenow/a/');
    });

    it.each([
        ['http://unknown.example/a', ['costingheorghe.ro']],
        ['http://www.example.org/a', []],
        ['javascript:alert(1)', ['costingheorghe.ro']],
        ['mailto:someone@example.org', ['example.org']],
        ['https://user:pw@flickr.com/', ['flickr.com']],
        ['nonsense', []],
    ])('badPath_%s_isDropped', (url, hosts) => {
        expect(toHttpsUrl(url, hosts)).toBeNull();
    });
});
