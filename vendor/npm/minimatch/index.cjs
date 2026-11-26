'use strict';
// The CommonJS entry of this vendored copy (README.md). minimatch 11's own CommonJS build exports a plain object of
// named exports; 3.x to 10.x let a dependant call the module itself, and firebase-tools (lib/fsAsync.js) and superstatic
// (lib/utils/patterns.js) still do: `require('minimatch')(path, pattern, options)`. This entry is 11's own `minimatch`
// function with every named export of 11 set on it, so `require('minimatch')(...)`, `require('minimatch').minimatch(...)`,
// `const { Minimatch } = require('minimatch')` and `__importDefault(require('minimatch')).default(...)` all run 11's code.
// Nothing of 11 is changed or re-implemented here: 11 has no `makeRe` and no `regexp`, and no dependant in this tree
// uses either.
const upstream = require('./commonjs/index.js');

const minimatch = upstream.minimatch;
for (const [name, value] of Object.entries(upstream)) {
    minimatch[name] = value;
}
minimatch.default = minimatch;

module.exports = minimatch;
