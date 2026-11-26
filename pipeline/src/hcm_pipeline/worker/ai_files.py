"""The local matcher's files in the volume `hcm-ai-files` (docs/research/M10-local-ai.md *Delivery*).

Nothing downloads until a frame needs it. Each file of `matcher/pins.json` comes from its upstream behind the address guard and a host
allow-list, every hop of a redirect included, hashed while it streams and renamed only on a match; one that does not match is deleted and
fetched once more, then the matcher stands aside for this run. Weights stay as they are (the sidecar hashes them again at load), and
each run hashes them here first: a file altered after the first use is placed again from what was fetched, so the fault heals by itself.
A wheel or the LightGlue tarball is opened as data, never run through pip: only named members leave it, each written under `lib/` by its
own name, so no path in an archive decides where a file lands. Of LightGlue only `aliked.py`, `lightglue.py`, `utils.py` and `LICENSE`
leave: upstream's `superpoint.py` is headed confidential, and upstream's `__init__.py`, which imports it, is replaced by ours.

Two kinds of sidecar (M26 item i, `docs/research/M26-governor.md` §5): on a computer with an NVIDIA card the starter runs PyTorch's own
image (about 10 GB) with `pins.json`'s files in `lib/`; on one without (`HCM_AI_VARIANT=cpu`, set by the starter) it runs the worker's
own image, and `pins-cpu.json` adds PyTorch for the processor and what it imports, about 0.9 GB unpacked in `lib-cpu/`: a folder of its
own, so the card's image never imports the processor's PyTorch.
"""

import hashlib
import json
import shutil
import tarfile
import zipfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final
from urllib.parse import urlsplit

import httpx

from hcm_pipeline import __version__
from hcm_pipeline.durable import copy_atomic, replace_durably, write_atomic
from hcm_pipeline.log import get_logger
from hcm_pipeline.matcher.box import TAMPERED
from hcm_pipeline.urlguard import AddressRefusedError, Resolver, check_data_url, resolve
from hcm_pipeline.worker.ai_state import why_of_fault

LOG = get_logger("worker.ai_files")
AI_FILE_HOSTS: Final = frozenset(
    {
        "github.com",
        "codeload.github.com",
        "raw.githubusercontent.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "files.pythonhosted.org",
        "download.pytorch.org",
    }
)
MATCHER_DIR: Final = Path(__file__).resolve().parent.parent / "matcher"
PINS: Final = MATCHER_DIR / "pins.json"
PINS_CPU: Final = MATCHER_DIR / "pins-cpu.json"
ENV_VARIANT: Final = "HCM_AI_VARIANT"
LIB: Final = "lib"
LIB_CPU: Final = "lib-cpu"
CODE_FILES: Final = ("__init__.py", "box.py", "child.py", "search.py", "serve.py", "torch_backend.py", "pins.json", "NOTICE.md")
LIGHTGLUE_MEMBERS: Final = ("lightglue/aliked.py", "lightglue/lightglue.py", "lightglue/utils.py", "LICENSE")
LIGHTGLUE_INIT: Final = "from .aliked import ALIKED\nfrom .lightglue import LightGlue\n"
WHEEL_TOPS: Final = (
    "kornia",
    "kornia_rs",
    "cv2",
    "opencv_python_headless.libs",
    # The processor's sidecar (`pins-cpu.json`): PyTorch and what `import torch, lightglue` needs, nothing more.
    "torch",
    "torchgen",
    "functorch",
    "torchvision",
    "torchvision.libs",
    "PIL",
    "pillow.libs",
    "sympy",
    "mpmath",
    "typing_extensions.py",
)
READY: Final = "ready.json"
CHUNK: Final = 1024 * 1024
FETCH_ATTEMPTS: Final = 2
DOWNLOAD_TIMEOUT: Final = httpx.Timeout(60.0, read=300.0)
UNREACHABLE: Final = "unreachable"


class AiFilesError(Exception):
    """A file of the matcher that cannot be had; its `why` is what the panel says."""

    def __init__(self, why: str, detail: str) -> None:
        super().__init__(detail)
        self.why = why


@dataclass(frozen=True)
class Pin:
    name: str
    kind: str
    url: str
    sha256: str


def variant_of(environment: Mapping[str, str]) -> tuple[Path, str]:
    """The pins and the folder of this computer's sidecar: the processor's when the starter found no NVIDIA card."""
    return (PINS_CPU, LIB_CPU) if environment.get(ENV_VARIANT) == "cpu" else (PINS, LIB)


def load_pins(path: Path = PINS) -> tuple[str, tuple[Pin, ...]]:
    """The sidecar's image by digest, and every file it needs."""
    pins = json.loads(path.read_text(encoding="utf-8"))
    files = tuple(Pin(each["name"], each["kind"], each["url"], each["sha256"]) for each in pins["files"])
    return str(pins["image"]), files


def guarded_hop(resolver: Resolver = resolve) -> Callable[[httpx.Request], None]:
    """A request hook for every hop: an allowed host, through the address guard."""

    def hook(request: httpx.Request) -> None:
        url = str(request.url)
        host = urlsplit(url).hostname
        if host not in AI_FILE_HOSTS:
            raise AddressRefusedError(f"refused a host the matcher's files do not live on: {host}")
        check_data_url(url, False, resolver)

    return hook


def ai_client(resolver: Resolver = resolve) -> httpx.Client:
    """Follows the hosts' own redirects (GitHub's releases do), each hop through the guard."""
    return httpx.Client(
        timeout=DOWNLOAD_TIMEOUT,
        follow_redirects=True,
        event_hooks={"request": [guarded_hop(resolver)]},
        headers={"User-Agent": f"hcm-pipeline/{__version__}"},
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def safe_name(name: str) -> bool:
    """A member's name that stays inside the folder it is written under."""
    parts = Path(name).parts
    return bool(parts) and not Path(name).is_absolute() and ".." not in parts


def _wanted(name: str) -> bool:
    top = name.split("/", 1)[0]
    return top in WHEEL_TOPS or top.endswith(".dist-info")


def wheel_members(names: Sequence[str]) -> list[str]:
    """The files of a wheel the sidecar imports, and each package's licences."""
    return [name for name in names if not name.endswith("/") and safe_name(name) and _wanted(name)]


def unpack_wheel(archive: Path, target: Path) -> None:
    """A wheel opened as a zip: named members only, nothing run."""
    with zipfile.ZipFile(archive) as wheel:
        for name in wheel_members(wheel.namelist()):
            _write(target / name, wheel.read(name))


def unpack_lightglue(archive: Path, target: Path, commit: str) -> None:
    """Only the four files, by exact name, with our own `__init__.py`: `superpoint.py` never leaves the tarball."""
    root = f"LightGlue-{commit}"
    with tarfile.open(archive, "r:gz") as tar:
        for member in LIGHTGLUE_MEMBERS:
            stream = tar.extractfile(f"{root}/{member}")
            if stream is None:
                raise AiFilesError(TAMPERED, f"the LightGlue tarball lacks {member}")
            _write(target / "lightglue" / Path(member).name, stream.read())
    _write(target / "lightglue" / "__init__.py", LIGHTGLUE_INIT.encode("utf-8"))


def _write(path: Path, data: bytes) -> None:
    write_atomic(path, data)


def _matches(path: Path, sha256: str) -> bool:
    return path.exists() and sha256_file(path) == sha256


class AiFiles:
    """Under `root` (`/ai/files`): `dl/` what was fetched, `weights/`, `lib/` (or `lib-cpu/`) what was unpacked, `code/matcher/` ours, then
    `ready.json`."""

    def __init__(self, root: Path, client: httpx.Client, pins: Path = PINS, lib: str = LIB) -> None:
        self._root = root
        self._lib = lib
        self._client = client
        self._pins_path = pins
        self.tick: Callable[[], None] = lambda: None
        self.image, self._pins = load_pins(pins)
        self.commit = str(json.loads(pins.read_text(encoding="utf-8"))["commit"])

    def ready(self) -> bool:
        """Whether every file was verified for these very pins."""
        try:
            return bool(json.loads((self._root / READY).read_text(encoding="utf-8")).get("pins") == self._stamp())
        except OSError, ValueError:
            return False

    def _stamp(self) -> str:
        return hashlib.sha256(self._pins_path.read_bytes()).hexdigest()

    def ensure(self) -> None:
        """Every file present, verified and unpacked, our code copied; `AiFilesError` with why when one cannot be had."""
        self._copy_code()
        if self.ready() and self._weights_intact():
            return
        fetched = [self._fetched(pin) for pin in self._pins]
        for pin, path in zip(self._pins, fetched, strict=True):
            self._placed(pin, path)
        write_atomic(self._root / READY, json.dumps({"pins": self._stamp()}))
        LOG.info("local AI: its %d files are verified", len(self._pins))

    def _weights_intact(self) -> bool:
        """The placed weights still their pins'; a stamp says they were once, and a child refusing them at every request heals nothing."""
        wanted = [pin for pin in self._pins if pin.kind == "weights"]
        intact = all(_matches(self._root / "weights" / pin.name, pin.sha256) for pin in wanted)
        if not intact:
            LOG.warning("local AI: a weights file no longer matches its pin: placing it again")
        return intact

    def _copy_code(self) -> None:
        """Our code as this image has it, so an updated worker's sidecar runs the same."""
        target = self._root / "code" / "matcher"
        target.mkdir(parents=True, exist_ok=True)
        for name in CODE_FILES:
            shutil.copyfile(MATCHER_DIR / name, target / name)

    def _placed(self, pin: Pin, path: Path) -> None:
        if pin.kind == "weights":
            # Durable (P1-4 of the resilience audit): a power cut leaves the old weights or the new, never half of them.
            copy_atomic(path, self._root / "weights" / pin.name)
        elif pin.kind == "wheel":
            unpack_wheel(path, self._root / self._lib)
        else:
            unpack_lightglue(path, self._root / self._lib, self.commit)

    def _fetched(self, pin: Pin) -> Path:
        """The file in `dl/`, its hash its pin's: what is there is kept when it matches, deleted when not."""
        path = self._root / "dl" / pin.name
        path.parent.mkdir(parents=True, exist_ok=True)
        if _matches(path, pin.sha256):
            return path
        path.unlink(missing_ok=True)
        for _ in range(FETCH_ATTEMPTS):
            if self._fetch(pin, path):
                return path
            LOG.warning("local AI: %s does not match its pin: deleted", pin.name)
        raise AiFilesError(TAMPERED, f"{pin.name} does not match its pin, twice")

    def _fetch(self, pin: Pin, path: Path) -> bool:
        """One download, hashed while it streams; True when it matched and was renamed into place."""
        part = path.with_name(f"{path.name}.part")
        digest = hashlib.sha256()
        try:
            with self._client.stream("GET", pin.url) as response, part.open("wb") as stream:
                response.raise_for_status()
                for chunk in response.iter_bytes(CHUNK):
                    self.tick()
                    digest.update(chunk)
                    stream.write(chunk)
        except (httpx.HTTPError, AddressRefusedError) as error:
            part.unlink(missing_ok=True)
            raise AiFilesError(UNREACHABLE, f"{pin.name} could not be fetched: {type(error).__name__}") from error
        except OSError as error:
            part.unlink(missing_ok=True)
            raise AiFilesError(why_of_fault(error), f"{pin.name} could not be written: {error}") from error
        if digest.hexdigest() != pin.sha256:
            part.unlink(missing_ok=True)
            return False
        replace_durably(part, path)
        return True
