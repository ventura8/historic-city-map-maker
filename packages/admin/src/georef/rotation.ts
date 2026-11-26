/**
 * The georeferencer's panes turned together (`docs/research/M3-interfaces.md` §10.4, 2026-11-12): once the pairs give a fit, the scan
 * is shown turned as the map shows the same ground. What runs to the right across the scan pane must run to the right across the
 * map: the scan direction the pane shows along its x axis is carried to the ground by the fit, and the map takes the bearing that
 * lays that ground direction along its own x axis (`bearingFor`); the other way, the ground direction along the map's x axis is
 * carried to the scan by the inverse fit, and the scan takes the angle that lays it along the pane's (`angleFor`). A fit that
 * stretches one axis more than the other (an oblique frame) turns the two by slightly different angles: that is the fit, not an
 * error. Angles of the scan are radians clockwise in the pane, bearings degrees as Mapbox has them.
 */
import { geoToMercator, mercatorToGeo, type FittedTransform, type PixelPoint } from '@hcm/shared';

const DEGREES = 180 / Math.PI;

/** How far along the ground the map's x axis is followed to read its direction on the scan, in Web Mercator metres. */
const GROUND_STEP_M = 10;

/**
 * Which way a scan direction points on a north-up map at `pixel`: radians clockwise from the map's right, for the direction
 * `angle` radians anticlockwise of the scan's x axis (0: the x axis itself).
 */
export function fitAngle(transform: FittedTransform, pixel: PixelPoint, angle = 0): number {
    const at = geoToMercator(transform.toGeo(pixel));
    const along = geoToMercator(transform.toGeo({ x: pixel.x + Math.cos(angle), y: pixel.y - Math.sin(angle) }));
    // Web Mercator's y grows to the north, a pane's y down.
    return Math.atan2(at.y - along.y, along.x - at.x);
}

/** A bearing within -180 … 180 degrees. */
function wrapped(degrees: number): number {
    return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** The map bearing (degrees) that shows the ground as a scan turned by `angle` radians shows it at `pixel`; null where the fit has no place. */
export function bearingFor(transform: FittedTransform, pixel: PixelPoint, angle: number): number | null {
    // A scan turned clockwise by `angle` shows along its pane's x axis the scan direction `angle` anticlockwise of the scan's own.
    const bearing = wrapped(fitAngle(transform, pixel, angle) * DEGREES);
    return Number.isFinite(bearing) ? bearing : null;
}

/** The scan's angle (radians) that shows the ground as a map of `bearing` degrees shows it at `pixel`; null where the fit has no place. */
export function angleFor(transform: FittedTransform, pixel: PixelPoint, bearing: number): number | null {
    const at = geoToMercator(transform.toGeo(pixel));
    const turn = bearing / DEGREES;
    // The ground direction along the map's x axis, a short step of it carried back to the scan.
    const along = transform.toPixel(mercatorToGeo({ x: at.x + GROUND_STEP_M * Math.cos(turn), y: at.y - GROUND_STEP_M * Math.sin(turn) }));
    const angle = -Math.atan2(along.y - pixel.y, along.x - pixel.x);
    return Number.isFinite(angle) ? angle : null;
}
