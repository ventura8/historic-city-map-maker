"""The panoramic camera's forward model (docs/research/M3-interfaces.md §5.4).

A homography through a panoramic frame's four corners cannot hold it: the film position follows the scan angle and the
ground the angle's tangent, so the ground pixel grows towards the frame's ends and the footprint is a bowtie, its middle
about half as wide as its ends. On the 1972 KH-9 frame D3C1202-200149F039 the corner homography had the scale wrong 1.5 to 2
times at the city (6.65 km RMS at 17 hand-read landmarks); this model, with the half angle 60.5 degrees and the film up to
the exposure's dark gap as its width, fits them with 0.24 km RMS after one constant shift of about 7 km.

With theta running linearly over the exposure from `theta_a` at its first column to `theta_b` at its last:

    along = (tan(theta) - tan(theta_a)) / (tan(theta_b) - tan(theta_a))
    across = (2y/H - 1) / (cos(theta) * ((1 - along) / cos(theta_a) + along / cos(theta_b)))

then bilinear on the four ground corners, `along` from 0 to 1 and `across` from -1 to 1 between them. A full sweep is centred on the
nadir (`theta_a = -half_angle`, `theta_b = half_angle`). A shorter one need not be, which the 1982 frame D3C1217-200510A001 showed:
its film is half as long as a full frame's (the camera swept 60 degrees, not 120), and its east end is wider on the ground than its
west end (52 degrees off the nadir against 8). Its ends' widths give that: the wider end's cosine is the narrower's over their ratio,
so `tan(wide) = (ratio - cos(sweep)) / sin(sweep)`. Under the centred model 3 of 196 tiles agreed; under this one, 24 in the first probe,
with the corners' place 1.7 km off. The rest of `locate` keeps one projective transform:
`local_matrix` fits one around the city window from this model.
"""

import math
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.geo import FloatArray, MercatorBox

# The local fit's samples per side of the film box around the window.
LOCAL_SAMPLES: Final = 9
# The inverse of the bilinear map: Newton's steps from the quad's middle (a near-parallelogram converges in three).
NEWTON_STEPS: Final = 8


@dataclass(frozen=True)
class PanoramicCamera:
    """What the model needs beyond the corners: the half scan angle, the exposure's width in film pixels (`W`), the column it
    starts at (a turned scan's fragment of the next exposure lies before it), and how far a shorter sweep swung (None: the full one,
    centred on the nadir)."""

    half_angle_deg: float
    image_width: int
    image_start: int = 0
    sweep_deg: float | None = None


def _length(a: FloatArray, b: FloatArray) -> float:
    return float(numpy.hypot(*(a - b)))


def sweep_ends(corners: FloatArray, camera: PanoramicCamera) -> tuple[float, float]:
    """The scan angle (radians) at the exposure's first and last columns: a shorter sweep's from its ends' widths on the ground."""
    half = math.radians(camera.half_angle_deg)
    if camera.sweep_deg is None:
        return -half, half
    first, last = _length(corners[0], corners[3]), _length(corners[1], corners[2])
    sweep = math.radians(camera.sweep_deg)
    ratio = max(first, last) / max(min(first, last), 1e-9)
    wide = min(half, math.atan2(ratio - math.cos(sweep), math.sin(sweep)))
    return (wide, wide - sweep) if first >= last else (wide - sweep, wide)


def least_squares_homography(source: FloatArray, target: FloatArray) -> FloatArray:
    """The 3x3 projective map taking `source` (n by 2) closest to `target` (n by 2), on coordinates centred and scaled to
    about 1 (film pixels and EPSG:3857 metres together are too ill-conditioned for the normal solve)."""
    from_source, from_target = _normalizing(source), _normalizing(target)
    x, y = _normalized(from_source, source).T
    u, v = _normalized(from_target, target).T
    ones, zeros = numpy.ones_like(x), numpy.zeros_like(x)
    first = numpy.column_stack((x, y, ones, zeros, zeros, zeros, -u * x, -u * y))
    second = numpy.column_stack((zeros, zeros, zeros, x, y, ones, -v * x, -v * y))
    solution, *_ = numpy.linalg.lstsq(numpy.vstack((first, second)), numpy.concatenate((u, v)), rcond=None)
    fitted = numpy.linalg.inv(from_target) @ numpy.append(solution, 1.0).reshape(3, 3) @ from_source
    return numpy.asarray(fitted / fitted[2, 2], numpy.float64)


def _normalizing(points: FloatArray) -> FloatArray:
    """The similarity that centres `points` and scales their spread to about 1."""
    centre = points.mean(axis=0)
    scale = 1.0 / max(float(numpy.abs(points - centre).max()), 1e-9)
    return numpy.array([[scale, 0.0, -scale * centre[0]], [0.0, scale, -scale * centre[1]], [0.0, 0.0, 1.0]])


def _normalized(matrix: FloatArray, points: FloatArray) -> FloatArray:
    return numpy.asarray(points * matrix[0, 0] + matrix[:2, 2], numpy.float64)


@dataclass(frozen=True)
class PanoramicModel:
    """The exposure's film (`camera.image_width` by `height` pixels, from `camera.image_start`) on the ground: `corners` (4 by 2,
    EPSG:3857) are where the exposure's top-left, top-right, bottom-right and bottom-left corners lie."""

    corners: FloatArray
    camera: PanoramicCamera
    height: int

    @property
    def ends(self) -> tuple[float, float]:
        return sweep_ends(self.corners, self.camera)

    def _across_width(self, along: FloatArray) -> FloatArray:
        """The bilinear map's width at `along`, in units where a width is 1 / cos(theta)."""
        low, high = self.ends
        return numpy.asarray((1 - along) / math.cos(low) + along / math.cos(high), numpy.float64)

    def to_mercator(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Film pixels to EPSG:3857 metres."""
        low, high = self.ends
        theta = low + (x - self.camera.image_start) / self.camera.image_width * (high - low)
        a = (numpy.tan(theta) - math.tan(low)) / (math.tan(high) - math.tan(low))
        b = ((2 * y / self.height - 1) / (numpy.cos(theta) * self._across_width(a)) + 1) / 2
        c = self.corners
        places = [
            c[0, axis] * (1 - a) * (1 - b) + c[1, axis] * a * (1 - b) + c[2, axis] * a * b + c[3, axis] * (1 - a) * b for axis in (0, 1)
        ]
        return places[0], places[1]

    def _on_quad(self, mx: FloatArray, my: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Where (a, b) in the corners' bilinear map the places lie: Newton's method."""
        origin, along, across = self.corners[0], self.corners[1] - self.corners[0], self.corners[3] - self.corners[0]
        twist = self.corners[2] - self.corners[1] - across
        a, b = numpy.full_like(mx, 0.5), numpy.full_like(my, 0.5)
        for _ in range(NEWTON_STEPS):
            ex = origin[0] + along[0] * a + across[0] * b + twist[0] * a * b - mx
            ey = origin[1] + along[1] * a + across[1] * b + twist[1] * a * b - my
            ja, jb = along[0] + twist[0] * b, across[0] + twist[0] * a
            jc, jd = along[1] + twist[1] * b, across[1] + twist[1] * a
            determinant = ja * jd - jb * jc
            a, b = a - (jd * ex - jb * ey) / determinant, b - (ja * ey - jc * ex) / determinant
        return a, b

    def to_film(self, mx: FloatArray, my: FloatArray) -> tuple[FloatArray, FloatArray]:
        """EPSG:3857 metres to film pixels (a place off the corners' quad falls off the film)."""
        a, b = self._on_quad(mx, my)
        low, high = self.ends
        theta = numpy.arctan(math.tan(low) + a * (math.tan(high) - math.tan(low)))
        x = self.camera.image_start + (theta - low) / (high - low) * self.camera.image_width
        y = ((2 * b - 1) * numpy.cos(theta) * self._across_width(a) + 1) * self.height / 2
        return x, y

    def _span_around(self, values: FloatArray, centre: float, limits: tuple[float, float]) -> FloatArray:
        """Sample positions on a film axis between `limits`: over the `values`' extent, around `centre` kept on the film."""
        kept = min(max(centre, limits[0]), limits[1])
        half = float(numpy.abs(values - centre).max())
        return numpy.linspace(max(limits[0], kept - half), min(limits[1], kept + half), LOCAL_SAMPLES)

    def local_matrix(self, window: MercatorBox) -> FloatArray:
        """The projective transform (film pixels to EPSG:3857 metres) closest to the model around `window`: fitted on film
        points over the window's extent on the film, around where the model puts its centre (kept on the film, so a window
        off the frame still has a transform: one that does not cover the window)."""
        mx = numpy.array([window.left, window.right, window.right, window.left])
        my = numpy.array([window.top, window.top, window.bottom, window.bottom])
        corner_x, corner_y = self.to_film(mx, my)
        centre_x, centre_y = self.to_film(numpy.array([(window.left + window.right) / 2]), numpy.array([(window.top + window.bottom) / 2]))
        start = float(self.camera.image_start)
        xs = self._span_around(corner_x, float(centre_x[0]), (start, start + self.camera.image_width))
        ys = self._span_around(corner_y, float(centre_y[0]), (0.0, float(self.height)))
        fx, fy = (axis.ravel() for axis in numpy.meshgrid(xs, ys))
        px, py = self.to_mercator(fx, fy)
        return least_squares_homography(numpy.column_stack((fx, fy)), numpy.column_stack((px, py)))
