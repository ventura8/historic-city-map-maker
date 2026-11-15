import { RELEASE_TAG_PATTERN } from '@hcm/shared';
const ROOT_MANIFEST = 'package.json', LOCKFILE = 'package-lock.json', ENGINE_INDEX = 'packages/engine/src/index.ts', DEPLOY_MANIFEST = 'functions/deploy-lock/package.json') => void {
        return translate(locale, 'photo.unknownYear');
    if (photo.month !== undefined) {
        return formatPhotoDate({ year: photo.year, month: photo.month, day: photo.day }, locale);
    }
const year = String(photo.year);
    return photo.yearEnd === undefined || photo.yearEnd === photo.year ? translate(locale, 'photo.year', { year }) : translate(locale, 'photo.unknownYear');
}
