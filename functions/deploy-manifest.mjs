// The deploy artifact's package.json (functions/dist/package.json), shared by build.mjs, which writes it next to the
// bundle, and deploy-lock.mjs, which locks its dependency tree in functions/deploy-lock/ (DECISIONS-for-review.md §22b).
//
// The npm dependencies of functions/package.json stay external and keep their exact pins; the workspace packages
// (`@hcm/*`) are bundled. The root package.json's advisory `overrides` apply to the artifact too, so Cloud Build
// installs the same patched transitive versions the repository is audited with; a `$name` reference is left out, as it
// names a root dependency the artifact does not have.

/** `functions/package.json`'s npm dependencies that the bundle leaves external (everything but `@hcm/*`). */
export function externalDependencies(functionsManifest) {
    return Object.keys(functionsManifest.dependencies).filter((name) => !name.startsWith('@hcm/'));
}

function isReference(spec) {
    return typeof spec === 'string' && spec.startsWith('$');
}

/** The artifact's package.json, from `functions/package.json` and the root `package.json`. */
export function deployManifest(functionsManifest, rootManifest) {
    const external = externalDependencies(functionsManifest);
    return {
        name: 'hcm-functions',
        version: functionsManifest.version,
        private: true,
        type: 'module',
        main: 'index.js',
        engines: functionsManifest.engines,
        dependencies: Object.fromEntries(external.map((name) => [name, functionsManifest.dependencies[name]])),
        overrides: Object.fromEntries(Object.entries(rootManifest.overrides ?? {}).filter(([, spec]) => !isReference(spec))),
    };
}

/** The JSON text both scripts write, so the committed copy and the built one compare byte for byte. */
export function manifestText(manifest) {
    return `${JSON.stringify(manifest, null, 4)}\n`;
}
