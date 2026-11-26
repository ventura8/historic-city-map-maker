/** The admin's stand-in for re2js (`src/vendor/re2js-unsupported.ts`, DECISIONS-for-review.md §65k). */
import { describe, expect, it } from 'vitest';

import { RE2JS } from '../../src/vendor/re2js-unsupported.js';

describe('the re2js stand-in', () => {
    it('badPath_aPipelinesRegularExpressionIsRefusedWithWhy', () => {
        expect(() => RE2JS.compile('^Bucure.ti$')).toThrow("the admin does not evaluate Firestore Pipelines' regular expressions (^Bucure.ti$)");
    });
});
