// București dispărut: the embed configuration the engine boots from (docs/ENGINE_API.md → config.js).
// The manifest is the one the admin publishes to the public bucket: a build that names the bucket (HCM_PUBLIC_BUCKET,
// site.json → publicManifest) serves a generated copy of this file whose manifestUrl is the bucket's
// cities/bucharest/manifest.json. Without a bucket the site build bundles the seed snapshot as data/manifest.json, which
// this address names. The city is the project's (infra/project.json), which every manifest the backend builds names; the
// legacy manifest's own id is renamed by the site build (site.json → legacyCityId).
window.HistoricCityMapConfig = {
    cityId: 'bucharest',
    manifestUrl: './data/manifest.json',
};
