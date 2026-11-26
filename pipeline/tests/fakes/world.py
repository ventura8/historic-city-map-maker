"""The pipeline's test world: every upstream faked on loopback, the documents a job needs, and the adapters wired.

`PipelineWorld` starts the fake M2M server, one fake HTTP host (the USGS delivery, the STAC API with its Sentinel-2
COG, Overpass) and the fake Cloud Storage, seeds an in-memory Firestore with the city, the scene, the job and its
layer version the way the imagery callables write them, and builds the real `Services` against those fakes (the
same adapters production uses, so the integration tests drive the pipeline from outside). Times come from a
controllable clock; nothing sleeps.
"""

import io
import json
import os
import signal
from collections.abc import Mapping
from contextlib import ExitStack
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Final, Self

import httpx
from hcm_pipeline.calibrate.ports import NullProposalMatcher, ProposalMatcher
from hcm_pipeline.config import Config, load_config
from hcm_pipeline.geo import MercatorBox, ground_scale, to_lnglat, to_mercator
from hcm_pipeline.jobs import Services
from hcm_pipeline.m2m import M2MClient, http_client
from hcm_pipeline.model import Timestamp
from hcm_pipeline.objects import GcsObjectStore
from hcm_pipeline.osm import OverpassClient
from hcm_pipeline.raster import gdal
from hcm_pipeline.runner import JobRunner, RunOutcome, RunSettings
from hcm_pipeline.secrets import EmulatorSecrets, SecretSource, usgs_credentials
from hcm_pipeline.services import default_steps
from hcm_pipeline.stac import StacClient
from hcm_pipeline.steps.fetch import FetchStep
from hcm_pipeline.tokens import EmulatorTokens

from tests.fakes.documents import MemoryStore
from tests.fakes.environment import VALID_ENV
from tests.fakes.gcs import FakeGcsServer
from tests.fakes.http import FakeHttpServer, Reply, Request, serve_bytes
from tests.fakes.usgs_m2m import FakeM2MServer
from tests.synthetic.scenes import CENTRE, Scene

CITY: Final = "bucharest"
JOB_ID: Final = "job-1966-0712"
LAYER_ID: Final = "kh-4a-corona-1966"
EXECUTION: Final = "raster-pipeline-x7k2m"
ENTITY_ID: Final = "DS1035-1057DA023"
PRODUCT_ID: Final = "5e83d0b84df8d8c2"
GOOD_SIGNATURE: Final = "sig-ok-7d1f"
FRESH_SIGNATURE: Final = "sig-fresh-c0a2"
S2_ITEM: Final = "S2B_35TMK_20250803_0_L2A"
STAC_PATH: Final = "/stac"
# The Copernicus DEM tiles' root (M15, *Terrain*): nothing is served there unless a test serves a tile.
DEM_PATH: Final = "/dem"
OVERPASS_PATH: Final = "/overpass/api/interpreter"
TEST_CHUNK_BYTES: Final = 256 * 1024
NOW: Final = 1_792_000_000.0
OWNER_UID: Final = "uid-owner"
CITY_HALF_M: Final = (4150.0, 3100.0)
SMALL_CITY_HALF_M: Final = (1750.0, 1400.0)


@dataclass
class FakeClock:
    now: float = NOW

    def __call__(self) -> float:
        return self.now


def dig(value: object, *keys: str) -> object:
    """`value[keys[0]][keys[1]]...` of a stored document, failing the test when a level is missing."""
    for key in keys:
        assert isinstance(value, dict), f"{key}: not a record"
        assert key in value, f"{key}: missing"
        value = value[key]
    return value


def city_bounds() -> dict[str, float]:
    """The test city: 5 km by 4 km (EPSG:3857) around the synthetic world's centre."""
    cx, cy = to_mercator(*CENTRE)
    box = MercatorBox(cx - CITY_HALF_M[0], cy - CITY_HALF_M[1], cx + CITY_HALF_M[0], cy + CITY_HALF_M[1])
    return box.bounds().as_record()


def stamp_of(seconds: float) -> dict[str, object]:
    return {"updatedBy": OWNER_UID, "updatedAt": Timestamp.at(seconds)}


def small_city(world: PipelineWorld) -> None:
    """The city's bounds shrunk to `S-P01-HAPPY-ADMIN`'s small town around the world's centre (too small to prove by itself, M9 §14), and a
    catalogue whose item reaches over the wider box a matcher's proposal is proved on; the asset still holds the world alone."""
    cx, cy = to_mercator(*CENTRE)
    box = MercatorBox(cx - SMALL_CITY_HALF_M[0], cy - SMALL_CITY_HALF_M[1], cx + SMALL_CITY_HALF_M[0], cy + SMALL_CITY_HALF_M[1])
    path = f"cities/{CITY}"
    world.store.seed(path, {**world.store.documents[path], "bounds": box.bounds().as_record()})
    world.stac_reach_m = 50_000.0


@dataclass
class PipelineWorld:
    """The fakes, the documents and the services of one test."""

    scene: Scene
    store: MemoryStore = field(default_factory=MemoryStore)
    clock: FakeClock = field(default_factory=FakeClock)
    stack: ExitStack = field(default_factory=ExitStack)
    valid_signatures: set[str] = field(default_factory=lambda: {GOOD_SIGNATURE, FRESH_SIGNATURE})
    delivery_ranges: bool = True
    stac_items: bool = True
    delivered: bytes | None = None
    secrets: SecretSource | None = None
    stac_href: str | None = None
    # Further catalogue items ahead of the world's own (the reference guard, M15): `(id, date, cloud, href)`, over the same box.
    stac_extra: list[tuple[str, str, float, str]] = field(default_factory=list)
    # How far around the world's centre the catalogue's item reaches (None: the world's own edges).
    stac_reach_m: float | None = None
    # A test's local matcher (`Services.proposal_matcher`); Cloud Run's Null otherwise.
    matcher: ProposalMatcher = field(default_factory=NullProposalMatcher)

    def __enter__(self) -> Self:
        self.m2m = self.stack.enter_context(FakeM2MServer())
        self.http = self.stack.enter_context(FakeHttpServer())
        self.gcs = self.stack.enter_context(FakeGcsServer(VALID_ENV["HCM_PRIVATE_BUCKET"]))
        self.clients = [self.stack.enter_context(httpx.Client(follow_redirects=False)) for _ in range(2)]
        self._routes()
        self.config = load_config(self.env())
        return self

    def __exit__(self, *exc: object) -> None:
        self.stack.close()

    # --- the upstreams ---------------------------------------------------------------------------------

    def env(self, **overrides: str) -> dict[str, str]:
        return {
            **VALID_ENV,
            "JOB_ID": JOB_ID,
            "CITY_ID": CITY,
            "USGS_M2M_BASE_URL": self.m2m.base_url,
            "HCM_STAC_URL": self.http.url(STAC_PATH),
            "HCM_OVERPASS_URL": self.http.url(OVERPASS_PATH),
            "HCM_DEM_URL": self.http.url(DEM_PATH),
            "CLOUD_RUN_EXECUTION": EXECUTION,
            "CLOUD_RUN_TASK_ATTEMPT": "0",
            **overrides,
        }

    @property
    def delivery(self) -> bytes:
        """What the USGS delivery host serves: the scene's archive, unless a test replaced it."""
        return self.delivered if self.delivered is not None else self.scene.delivery.read_bytes()

    def delivery_url(self, signature: str) -> str:
        return self.http.url(f"/download/{ENTITY_ID}.tgz") + f"?sig={signature}"

    def _routes(self) -> None:
        self.http.route("GET", f"/download/{ENTITY_ID}.tgz", self._deliver)
        self.http.serve("/s2/visual.tif", self.scene.sentinel2.read_bytes())
        self.http.route("POST", f"{STAC_PATH}/search", self._stac)
        self.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(json.dumps(self.scene.overpass)))
        self.offer_download(len(self.delivery))
        self.m2m.set_data("download-request", {"availableDownloads": [{"downloadId": 1, "url": self.delivery_url(GOOD_SIGNATURE)}]})
        self.m2m.set_data("download-retrieve", {"available": [{"downloadId": 1, "url": self.delivery_url(FRESH_SIGNATURE)}]})

    def offer_download(self, size: int, available: bool = True) -> None:
        self.m2m.set_data("download-options", [{"id": PRODUCT_ID, "entityId": ENTITY_ID, "available": available, "filesize": size}])

    def _deliver(self, request: Request) -> Reply:
        if request.query.get("sig") not in self.valid_signatures:
            return Reply(HTTPStatus.FORBIDDEN, b"<html>expired</html>", "text/html")
        headers = {"Content-Disposition": f'attachment; filename="{ENTITY_ID}.tgz"'}
        reply = serve_bytes(self.delivery, self.delivery_ranges, "application/x-gzip")(request)
        return Reply(reply.status, reply.body, reply.content_type, {**reply.headers, **headers})

    def _stac(self, _request: Request) -> Reply:
        own = (S2_ITEM, "2025-08-03", 3.2, self.stac_href or self.http.url("/s2/visual.tif"))
        features = [self._feature(*item) for item in (*self.stac_extra, own)]
        return Reply.json(json.dumps({"type": "FeatureCollection", "features": features if self.stac_items else []}))

    def _feature(self, item_id: str, date: str, cloud: float, href: str) -> dict[str, object]:
        return {
            "type": "Feature",
            "id": item_id,
            "bbox": list(self._stac_box()),
            "properties": {"datetime": f"{date}T09:20:31Z", "eo:cloud_cover": cloud},
            "assets": {"visual": {"href": href, "type": "image/tiff; application=geotiff"}},
        }

    def serve_sentinel2_moved(self, name: str, north_m: float) -> str:
        """The world's Sentinel-2 moved `north_m` ground metres north, served at `/s2/{name}.tif`: its address."""
        path = self.scene.sentinel2.with_name(f"sentinel2-{name}.tif")
        moved = gdal.Translate(str(path), str(self.scene.sentinel2), format="GTiff")
        left, size, skew, top, turn, height = moved.GetGeoTransform()
        moved.SetGeoTransform((left, size, skew, top + north_m / ground_scale(CENTRE[1]), turn, height))
        moved.Close()
        self.http.serve(f"/s2/{name}.tif", path.read_bytes())
        return self.http.url(f"/s2/{name}.tif")

    def _stac_box(self) -> tuple[float, float, float, float]:
        grid = self.scene.world.grid
        if self.stac_reach_m is None:
            return (*to_lnglat(grid.left, grid.box().bottom), *to_lnglat(grid.box().right, grid.top))
        cx, cy = to_mercator(*CENTRE)
        reach = self.stac_reach_m
        return (*to_lnglat(cx - reach, cy - reach), *to_lnglat(cx + reach, cy + reach))

    # --- services ----------------------------------------------------------------------------------------

    def services(self) -> Services:
        secrets = self.secrets or EmulatorSecrets("e2e-ok")
        config = self.config

        def m2m() -> M2MClient:
            return M2MClient(http_client(config.m2m_base_url), usgs_credentials(secrets))

        return Services(
            store=self.store,
            objects=GcsObjectStore(self.clients[0], config.private_bucket, EmulatorTokens(), self.gcs.base_url),
            secrets=secrets,
            m2m=m2m,
            downloads=self.clients[1],
            stac=StacClient(self.clients[0], config.stac_url, lambda _seconds: None),
            overpass=OverpassClient(self.clients[0], config.overpass_url, lambda _seconds: None),
            clock=self.clock,
            sleep=lambda _seconds: None,
            resolver=lambda _host: ["127.0.0.1"],
            proposal_matcher=self.matcher,
        )

    def runner(self, config: Config | None = None) -> JobRunner:
        steps = {**default_steps(), "fetch": FetchStep(TEST_CHUNK_BYTES)}
        return JobRunner(config or self.config, self.services(), steps, RunSettings(heartbeat_seconds=3600))

    def run(self) -> RunOutcome:
        return self.runner().run()

    # --- documents ---------------------------------------------------------------------------------------

    def job_path(self, job_id: str = JOB_ID) -> str:
        return f"cities/{CITY}/jobs/{job_id}"

    def version_path(self, version_id: str = JOB_ID) -> str:
        return f"cities/{CITY}/layerVersions/{version_id}"

    def job(self, job_id: str = JOB_ID) -> dict[str, object]:
        found = self.store.get(self.job_path(job_id))
        assert found is not None
        return found

    def version(self, version_id: str = JOB_ID) -> dict[str, object]:
        found = self.store.get(self.version_path(version_id))
        assert found is not None
        return found

    def seed_city(self) -> None:
        """A city on Mapbox's path, the COG and the Studio file written; `seed_own_city` is the default since M12."""
        self.seed_own_city(publish_through_mapbox=True)

    def seed_own_city(self, publish_through_mapbox: bool = False) -> None:
        imagery = {"publishThroughMapbox": True} if publish_through_mapbox else {}
        city = {
            "name": {"ro": "București", "en": "Bucharest"},
            "bounds": city_bounds(),
            "published": True,
            "imagery": imagery,
            **stamp_of(NOW - 9000),
        }
        self.store.seed(f"cities/{CITY}", city)

    def seed_scene(self) -> None:
        corners = self.scene.corners
        scene = {
            "entityId": ENTITY_ID,
            "dataset": "corona2",
            "sensor": "KH-4A",
            "acquisitionDate": "1966-07-12",
            "status": "imported",
            "downloadAvailable": True,
            "footprint": [corners[key] for key in ("nw", "ne", "se", "sw")],
            "corners": corners,
            "resolutionM": 2.75,
            "coverage": 1,
            "browse": {"state": "none"},
            "rank": {"score": 91, "reasons": [{"code": "free"}], "version": 1},
            "layerId": LAYER_ID,
            "harvestedAt": Timestamp.at(NOW - 8000),
            "updatedBy": "system:imagery",
            "updatedAt": Timestamp.at(NOW - 8000),
        }
        self.store.seed(f"cities/{CITY}/usgsScenes/{ENTITY_ID}", scene)

    def seed_import(self, job_id: str = JOB_ID, status: str = "starting") -> None:
        """A `usgs-import` job and its version, as `imagery.import` and the dispatcher leave them."""
        self.seed_city()
        self.seed_scene()
        params = {"entityId": ENTITY_ID, "dataset": "corona2", "sensor": "KH-4A"}
        self.seed_job(job_id, "usgs-import", params, status)
        version = {
            "layerId": LAYER_ID,
            "jobId": job_id,
            "origin": "usgs",
            "state": "processing",
            "source": {"kind": "usgs", "entityId": ENTITY_ID, "dataset": "corona2", "sensor": "KH-4A", "acquisitionDate": "1966-07-12"},
            "label": {"ro": "KH-4A Corona, 12 iulie 1966", "en": "KH-4A Corona, 12 July 1966"},
            "year": 1966,
            "date": "1966-07-12",
            "sensor": "KH-4A",
            "createdBy": OWNER_UID,
            "createdAt": Timestamp.at(NOW - 100),
            **stamp_of(NOW - 100),
        }
        self.store.seed(self.version_path(job_id), version)

    def seed_job(
        self, job_id: str, job_type: str, params: Mapping[str, object], status: str = "starting", layer_id: str = LAYER_ID
    ) -> None:
        job = {
            "type": job_type,
            "status": status,
            "params": dict(params),
            "createdBy": OWNER_UID,
            "createdAt": Timestamp.at(NOW - 100),
            "layerId": layer_id,
            "versionId": job_id,
            "dispatchAt": Timestamp.at(NOW - 90),
            "executionName": f"projects/demo-hcm/locations/us-central1/jobs/raster-pipeline/executions/{EXECUTION}",
            "machine": "std",
            "attempt": 1,
            "updatedBy": "system:imagery",
            "updatedAt": Timestamp.at(NOW - 90),
        }
        self.store.seed(self.job_path(job_id), job)

    # --- observations --------------------------------------------------------------------------------------

    def log_lines(self, job_id: str = JOB_ID) -> list[str]:
        prefix = f"{self.job_path(job_id)}/logs/"
        return [str(document["message"]) for path, document in sorted(self.store.documents.items()) if path.startswith(prefix)]

    def everything_written(self, logs: io.StringIO) -> str:
        """Every document and every Cloud Logging line as one text (the leak checks search it)."""
        return json.dumps(self.store.documents, default=str) + logs.getvalue()

    def sigterm_during_delivery(self, offset: int) -> None:
        """Cloud Run's SIGTERM while the delivery's chunk at `offset` arrives in Cloud Storage."""

        def hook(name: str, start: int) -> None:
            if name.endswith(".tgz") and start == offset:
                os.kill(os.getpid(), signal.SIGTERM)

        self.gcs.on_chunk = hook
