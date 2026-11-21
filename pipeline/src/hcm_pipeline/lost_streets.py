"""The first batch of a city's "Disappeared streets" layer, built from open data only.

Three sources, each with its licence recorded in the output's top-level `sources` member:

- OpenStreetMap through Overpass (ODbL): ways whose highway lives on under a lifecycle prefix
  (`demolished:highway`, `was:highway`, `razed:highway`, `abandoned:highway`, `removed:highway`,
  `destroyed:highway`) or tagged `historic=street`; service roads and parking aisles are dropped.
- OpenHistoricalMap through its Overpass (CC0): `highway` ways with an `end_date`; the main source.
- Wikidata SPARQL (CC0): streets with a dissolved date (P576) and coordinates inside the bounds. A point is
  not a street's line, so an item only enriches a line of the same name (its link and years), else it is
  counted as "point only".

Ways of one name and the same years that touch end to end become one LineString; every line keeps at most
`MAX_POSITIONS` positions, rounded to six decimals, inside the bounds plus `MARGIN_DEGREES`. The output is a
GeoJSON FeatureCollection in the admin's place import format (`packages/admin/src/pois/geojson.ts`).

    python -m hcm_pipeline.lost_streets --bounds 25.93,44.33,26.25,44.55 --out lost-streets.geojson

Only open sources with a licence are fetched (AGENTS.md, project hard constraints).
"""

import argparse
import json
import re
import sys
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from itertools import chain
from pathlib import Path
from typing import Final

import httpx

from hcm_pipeline.geo import Bounds
from hcm_pipeline.log import configure, fields, get_logger
from hcm_pipeline.stac import Post, ReferenceUnavailableError, post_with_retries

LOG = get_logger("lost_streets")

# Wikidata refuses generic User-Agents; the project names itself and its repository, never a person.
USER_AGENT: Final = "HistoricCityMapMaker/1.0 (https://github.com/ventura8/historic-city-map-maker)"
OSM_URL: Final = "https://overpass-api.de/api/interpreter"
OHM_URL: Final = "https://overpass-api.openhistoricalmap.org/api/interpreter"
WIKIDATA_URL: Final = "https://query.wikidata.org/sparql"
# The admin's category id of the layer; its label and colour live in the city's categories.
CATEGORY: Final = "lost-streets"
# MAX_GEOMETRY_VERTICES of packages/shared/src/schemas/geometry.ts: a longer line is refused by the import.
MAX_POSITIONS: Final = 500
# The place schema's cap on links.
MAX_LINKS: Final = 5
# Six decimals are about 0.1 m: finer digits only grow the file.
DIGITS: Final = 6
# A street that runs out of the city box keeps its first half degree beyond it, then stops.
MARGIN_DEGREES: Final = 0.5
# OHM and Wikidata dates outside these years are typos or placeholders, never a street's life.
YEAR_MIN: Final = 1800
YEAR_MAX: Final = 2100
# Overpass answers a city in seconds when idle and in minutes when busy; the query asks for 120 s itself.
TIMEOUT_SECONDS: Final = 180.0
MIN_POSITIONS: Final = 2
BOUNDS_VALUES: Final = 4
# OSM's lifecycle prefixes (https://wiki.openstreetmap.org/wiki/Lifecycle_prefix) for something that is gone.
LIFECYCLE_PREFIXES: Final = ("demolished", "was", "razed", "abandoned", "removed", "destroyed")
# Highway kinds that are not streets: in Bucharest the razed ways are parking aisles of demolished lots.
DROPPED_KINDS: Final = frozenset({"service", "parking_aisle", "driveway", "parking", "footway", "track", "path"})
# Tags whose values become "Other names" in the description.
ALT_NAME_KEYS: Final = ("alt_name", "old_name", "name:ro", "name:en")

Position = tuple[float, float]


@dataclass(frozen=True)
class Source:
    """One open source: where it is, its licence and the attribution a map must show."""

    key: str
    name: str
    url: str
    licence: str
    attribution: str


OSM: Final = Source("osm", "OpenStreetMap", OSM_URL, "ODbL-1.0", "© OpenStreetMap contributors (ODbL)")
OHM: Final = Source("ohm", "OpenHistoricalMap", OHM_URL, "CC0-1.0", "OpenHistoricalMap contributors (CC0)")
WIKIDATA: Final = Source("wd", "Wikidata", WIKIDATA_URL, "CC0-1.0", "Wikidata (CC0)")


@dataclass(frozen=True)
class Street:
    """One street line (a way, or ways merged end to end) with its names, years and links."""

    source: Source
    ident: str
    name: str
    line: tuple[Position, ...]
    year_start: int | None = None
    year_end: int | None = None
    other_names: tuple[str, ...] = ()
    links: tuple[tuple[str, str], ...] = ()


@dataclass
class Counts:
    """What each source gave: fetched, kept and the features they became."""

    fetched: dict[str, int] = field(default_factory=dict)
    kept: dict[str, int] = field(default_factory=dict)
    features: dict[str, int] = field(default_factory=dict)
    point_only: int = 0
    enriched: int = 0


def year_of(value: object) -> int | None:
    """The year a date string starts with (`1983`, `1983-05`, `~1900`), when it lies in 1800-2100."""
    # A leading `~` or `c.` of an approximate date is skipped; the first four digits are the year.
    match = re.match(r"^\D{0,2}(\d{4})", str(value)) if isinstance(value, str) else None
    if match is None:
        return None
    year = int(match.group(1))
    return year if YEAR_MIN <= year <= YEAR_MAX else None


def years_of(start: object, end: object) -> tuple[int | None, int | None]:
    """Start and end years; an end before the start drops the end."""
    first, last = year_of(start), year_of(end)
    if first is not None and last is not None and last < first:
        return first, None
    return first, last


def _bbox(bounds: Bounds) -> str:
    return f"{bounds.south},{bounds.west},{bounds.north},{bounds.east}"


def osm_query(bounds: Bounds) -> str:
    """Overpass QL for lifecycle-prefixed highways and historic streets in the bounds."""
    box = _bbox(bounds)
    parts = "".join(f'way["{prefix}:highway"]({box});' for prefix in LIFECYCLE_PREFIXES)
    return f'[out:json][timeout:120];({parts}way["historic"="street"]({box}););out geom;'


def ohm_query(bounds: Bounds) -> str:
    """Overpass QL for OpenHistoricalMap highways that ended."""
    return f'[out:json][timeout:120];way["highway"]["end_date"]({_bbox(bounds)});out geom;'


def wikidata_query(bounds: Bounds) -> str:
    """SPARQL for streets (or subclasses of road or street) with a dissolved date inside the bounds."""
    return (
        "SELECT ?item ?label ?start ?end WHERE {"
        " SERVICE wikibase:box { ?item wdt:P625 ?where."
        f' bd:serviceParam wikibase:cornerSouthWest "Point({bounds.west} {bounds.south})"^^geo:wktLiteral.'
        f' bd:serviceParam wikibase:cornerNorthEast "Point({bounds.east} {bounds.north})"^^geo:wktLiteral. }}'
        " ?item wdt:P576 ?end. ?item wdt:P31 ?kind."
        " VALUES ?road { wd:Q79007 wd:Q34442 } ?kind wdt:P279* ?road."
        " OPTIONAL { ?item wdt:P571 ?start. }"
        ' ?item rdfs:label ?label. FILTER(LANG(?label) = "ro" || LANG(?label) = "en")'
        "}"
    )


def _tags(element: Mapping[str, object]) -> dict[str, str]:
    tags = element.get("tags")
    return {str(key): str(value) for key, value in tags.items()} if isinstance(tags, dict) else {}


def _line(element: Mapping[str, object]) -> tuple[Position, ...]:
    """A way's tags as strings; none when the element has no tag object."""
    nodes = element.get("geometry")
    if not isinstance(nodes, list):
        return ()
    return tuple((float(node["lon"]), float(node["lat"])) for node in nodes if isinstance(node, dict) and "lon" in node)


def _osm_kind(tags: Mapping[str, str]) -> str:
    """A way's `out geom` nodes as `(lng, lat)` positions."""
    kinds = [tags[f"{prefix}:highway"] for prefix in LIFECYCLE_PREFIXES if f"{prefix}:highway" in tags]
    return kinds[0] if kinds else tags.get("highway", "")


def _name(tags: Mapping[str, str]) -> str:
    """The highway kind a lifecycle prefix keeps, else the live `highway` value."""
    names = [tags.get("name", "")] + [tags.get(f"{prefix}:name", "") for prefix in LIFECYCLE_PREFIXES]
    return next((name.strip() for name in names if name.strip()), "")


def _unique[T](values: Iterable[T]) -> tuple[T, ...]:
    """The values in order, each once."""
    return tuple(dict.fromkeys(values))


def _other_names(tags: Mapping[str, str], name: str) -> tuple[str, ...]:
    values = {part.strip() for key in ALT_NAME_KEYS for part in tags.get(key, "").split(";")} - {"", name}
    return _unique(sorted(values))


def _wanted(source: Source, tags: Mapping[str, str]) -> bool:
    """OSM's service roads and parking aisles are not streets."""
    return source is not OSM or _osm_kind(tags) not in DROPPED_KINDS


def street_of(source: Source, element: Mapping[str, object]) -> Street | None:
    """A named way with a line as a street, else None (unnamed, too short, or a service road from OSM)."""
    tags = _tags(element)
    name, line = _name(tags), _line(element)
    if not (name and len(line) >= MIN_POSITIONS and _wanted(source, tags)):
        return None
    start, end = years_of(tags.get("start_date"), tags.get("end_date"))
    way = element.get("id")
    link = (f"https://www.{'openhistoricalmap' if source is OHM else 'openstreetmap'}.org/way/{way}", source.name)
    return Street(source, f"{way}", name, line, start, end, _other_names(tags, name), (link,))


def _elements(answer: httpx.Response) -> list[Mapping[str, object]]:
    answer.raise_for_status()
    return [element for element in _list(_member(answer.json(), "elements")) if isinstance(element, dict)]


def fetch_ways(http: httpx.Client, source: Source, query: str, sleep: Callable[[float], None]) -> list[Mapping[str, object]]:
    """The way elements an Overpass server answers for a query."""
    elements = _elements(post_with_retries(http, Post(source.url, form={"data": query}), sleep))
    return [element for element in elements if element.get("type") == "way"]


@dataclass(frozen=True)
class Item:
    """A Wikidata item: its id, label and years."""

    qid: str
    label: str
    year_start: int | None
    year_end: int | None


def _binding(row: Mapping[str, object], key: str) -> str:
    cell = row.get(key)
    return str(cell.get("value", "")) if isinstance(cell, dict) else ""


def item_of(row: Mapping[str, object]) -> Item | None:
    """One SPARQL result row as an item, or None without an entity id or label."""
    qid = _binding(row, "item").rsplit("/", 1)[-1]
    label = _binding(row, "label").strip()
    if not qid.startswith("Q") or not label:
        return None
    start, end = years_of(_binding(row, "start") or None, _binding(row, "end") or None)
    return Item(qid, label, start, end)


def fetch_items(http: httpx.Client, query: str, sleep: Callable[[float], None]) -> list[Item]:
    """Wikidata items for a SPARQL query, one per entity."""
    answer = post_with_retries(http, Post(WIKIDATA_URL, form={"query": query, "format": "json"}), sleep)
    answer.raise_for_status()
    items = (item_of(row) for row in _rows(answer.json()))
    return list({item.qid: item for item in items if item is not None}.values())


def _rows(body: object) -> list[Mapping[str, object]]:
    """The result rows of a SPARQL JSON answer."""
    results = _member(body, "results")
    return [row for row in _list(_member(results, "bindings")) if isinstance(row, dict)]


def _member(value: object, key: str) -> object:
    """A JSON object's member, or None when the value is not an object."""
    return value.get(key) if isinstance(value, dict) else None


def _list(value: object) -> list[object]:
    """A JSON array, or an empty list when the value is not one."""
    return value if isinstance(value, list) else []


def _joined(first: tuple[Position, ...], second: tuple[Position, ...]) -> tuple[Position, ...] | None:
    """The two lines as one when an end of one is an end of the other, else None."""
    # Four ways two lines can touch: end to start, end to end, start to start, start to end.
    for a in (first, first[::-1]):
        for b in (second, second[::-1]):
            if a[-1] == b[0]:
                return a + b[1:]
    return None


def _absorb(lines: list[tuple[Position, ...]]) -> bool:
    """Joins the first pair that touches, in place; False when none does."""
    for i, first in enumerate(lines):
        for j in range(i + 1, len(lines)):
            joined = _joined(first, lines[j])
            if joined is not None:
                lines[i] = joined
                del lines[j]
                return True
    return False


def join_lines(lines: Iterable[tuple[Position, ...]]) -> list[tuple[Position, ...]]:
    """Lines joined end to end until no two touch."""
    pending = list(lines)
    # Each join removes one line, so this ends after at most len(lines) - 1 joins.
    while _absorb(pending):
        pass
    return pending


def _group_key(street: Street) -> tuple[str, str, int | None, int | None]:
    return street.source.key, street.name.casefold(), street.year_start, street.year_end


def merge_streets(streets: Iterable[Street]) -> list[Street]:
    """Ways of one name and the same years that touch end to end become one street; pieces stay apart."""
    groups: dict[tuple[str, str, int | None, int | None], list[Street]] = {}
    for street in streets:
        groups.setdefault(_group_key(street), []).append(street)
    return [merged for group in groups.values() for merged in _merge_group(group)]


def _order(street: Street) -> int:
    return int(street.ident) if street.ident.isdigit() else 0


def _piece(ident: str, index: int) -> str:
    """The first piece keeps the way's id; the others add their number."""
    return ident if index == 0 else f"{ident}-{index + 1}"


def _merge_group(group: list[Street]) -> list[Street]:
    ordered = sorted(group, key=_order)
    first = replace(ordered[0], other_names=_unique(chain.from_iterable(street.other_names for street in ordered)))
    links = _unique(chain.from_iterable(street.links for street in ordered))
    lines = join_lines(street.line for street in ordered)
    return [replace(first, ident=_piece(first.ident, index), line=line, links=links) for index, line in enumerate(lines)]


def _distance(point: Position, start: Position, end: Position) -> float:
    """The distance of a point from the segment start-end, in degrees."""
    (x, y), (x0, y0), (x1, y1) = point, start, end
    dx, dy = x1 - x0, y1 - y0
    length = dx * dx + dy * dy
    # The projection of the point on the segment, clamped to its ends (a zero-length segment is its start).
    t = 0.0 if length == 0 else max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / length))
    return float(((x - x0 - t * dx) ** 2 + (y - y0 - t * dy) ** 2) ** 0.5)


def douglas_peucker(line: Sequence[Position], tolerance: float) -> list[Position]:
    """Douglas-Peucker: the positions that stray more than `tolerance` from the chord, kept with a stack (no recursion limit)."""
    if len(line) <= MIN_POSITIONS:
        return list(line)
    # Indices kept so far; each span between two kept indices is checked once for its farthest position.
    keep = {0, len(line) - 1}
    spans = [(0, len(line) - 1)]
    while spans:
        first, last = spans.pop()
        split = _farthest(line, first, last, tolerance)
        if split is not None:
            keep.add(split)
            spans += [(first, split), (split, last)]
    return [line[index] for index in sorted(keep)]


def _farthest(line: Sequence[Position], first: int, last: int, tolerance: float) -> int | None:
    """The index between `first` and `last` farthest from their chord, when it strays more than `tolerance`."""
    inner = range(first + 1, last)
    if not inner:
        return None
    worst = max(inner, key=lambda index: _distance(line[index], line[first], line[last]))
    return worst if _distance(line[worst], line[first], line[last]) > tolerance else None


def _inside(position: Position, bounds: Bounds) -> bool:
    lng, lat = position
    margin = MARGIN_DEGREES
    return bounds.west - margin <= lng <= bounds.east + margin and bounds.south - margin <= lat <= bounds.north + margin


def clean_line(line: Sequence[Position], bounds: Bounds) -> list[list[float]]:
    """Positions inside the bounds plus the margin, rounded, without repeats, thinned to at most `MAX_POSITIONS`."""
    rounded = [(round(lng, DIGITS), round(lat, DIGITS)) for lng, lat in line if _inside((lng, lat), bounds)]
    return [[lng, lat] for lng, lat in _thinned(_without_repeats(rounded))]


def _without_repeats(positions: list[Position]) -> list[Position]:
    """Positions without one equal to the one before it."""
    return [position for position, before in zip(positions, [None, *positions], strict=False) if position != before]


def _thinned(unique: list[Position]) -> list[Position]:
    """Douglas-Peucker with a doubling tolerance until at most `MAX_POSITIONS` remain."""
    # About 0.1 m; doubled until the line fits, so the thinning removes as little as it can.
    tolerance = 1e-6
    while len(unique) > MAX_POSITIONS:
        unique = douglas_peucker(unique, tolerance)
        tolerance *= 2
    return unique


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().casefold()


def _enrich(street: Street, item: Item) -> Street:
    """A name compared without case or repeated spaces."""
    link = (f"https://www.wikidata.org/wiki/{item.qid}", WIKIDATA.name)
    start = item.year_start if street.year_start is None else street.year_start
    end = item.year_end if street.year_end is None else street.year_end
    start, end = years_of(str(start), str(end))
    return replace(street, links=(*street.links, link)[:MAX_LINKS], year_start=start, year_end=end)


def enrich(streets: list[Street], items: Iterable[Item], counts: Counts) -> list[Street]:
    """Each Wikidata item adds its link and missing years to the lines of its name; the rest are counted as points only."""
    for item in items:
        matched = [index for index, street in enumerate(streets) if _norm(street.name) == _norm(item.label)]
        counts.enriched += bool(matched)
        counts.point_only += not matched
        for index in matched:
            streets[index] = _enrich(streets[index], item)
    return streets


def _description(street: Street) -> dict[str, str]:
    others_ro = f"Alte nume: {', '.join(street.other_names)}. " if street.other_names else ""
    others_en = f"Other names: {', '.join(street.other_names)}. " if street.other_names else ""
    return {"ro": f"{others_ro}Sursa: {street.source.attribution}.", "en": f"{others_en}Source: {street.source.attribution}."}


def feature_of(street: Street, bounds: Bounds) -> dict[str, object] | None:
    """A street as a place of the admin's import format, or None when fewer than two positions remain."""
    coordinates = clean_line(street.line, bounds)
    if len(coordinates) < MIN_POSITIONS:
        return None
    years = {"yearStart": street.year_start} if street.year_start is not None else {}
    years |= {"yearEnd": street.year_end} if street.year_end is not None else {}
    properties: dict[str, object] = {
        "category": CATEGORY,
        "title": {"ro": street.name, "en": street.name},
        "description": _description(street),
        **years,
        "links": [{"url": url, "label": label} for url, label in street.links[:MAX_LINKS]],
        "published": True,
    }
    geometry = {"type": "LineString", "coordinates": coordinates}
    return {"type": "Feature", "id": f"ls-{street.source.key}-{street.ident}"[:40], "properties": properties, "geometry": geometry}


def _source_record(source: Source, counts: Counts) -> dict[str, object]:
    return {
        "name": source.name,
        "url": source.url,
        "licence": source.licence,
        "attribution": source.attribution,
        "fetched": counts.fetched.get(source.key, 0),
        "kept": counts.kept.get(source.key, 0),
        "features": counts.features.get(source.key, 0),
    }


@dataclass(frozen=True)
class Fetchers:
    """The three source reads, replaceable in tests."""

    osm: Callable[[Bounds], list[Mapping[str, object]]]
    ohm: Callable[[Bounds], list[Mapping[str, object]]]
    wikidata: Callable[[Bounds], list[Item]]


def http_fetchers(http: httpx.Client, sleep: Callable[[float], None]) -> Fetchers:
    """The real reads, through one client that sends the project's User-Agent."""
    return Fetchers(
        osm=lambda bounds: fetch_ways(http, OSM, osm_query(bounds), sleep),
        ohm=lambda bounds: fetch_ways(http, OHM, ohm_query(bounds), sleep),
        wikidata=lambda bounds: fetch_items(http, wikidata_query(bounds), sleep),
    )


def _streets_of(source: Source, elements: list[Mapping[str, object]], counts: Counts) -> list[Street]:
    streets = [street for street in (street_of(source, element) for element in elements) if street is not None]
    counts.fetched[source.key] = len(elements)
    counts.kept[source.key] = len(streets)
    return merge_streets(streets)


def _count_features(features: list[dict[str, object]], counts: Counts) -> None:
    """A source's elements as merged streets, counting what was fetched and kept."""
    for source in (OHM, OSM):
        counts.features[source.key] = sum(str(feature["id"]).startswith(f"ls-{source.key}-") for feature in features)


def build(bounds: Bounds, fetchers: Fetchers) -> tuple[dict[str, object], Counts]:
    """The FeatureCollection of a city's lost streets and what each source gave."""
    counts = Counts()
    # OHM first: it is the main source, and its ways come before OSM's in the file.
    streets = _streets_of(OHM, fetchers.ohm(bounds), counts) + _streets_of(OSM, fetchers.osm(bounds), counts)
    items = fetchers.wikidata(bounds)
    counts.fetched[WIKIDATA.key] = len(items)
    streets = enrich(streets, items, counts)
    counts.kept[WIKIDATA.key] = counts.enriched
    features = [feature for feature in (feature_of(street, bounds) for street in streets) if feature is not None]
    _count_features(features, counts)
    collection: dict[str, object] = {
        "type": "FeatureCollection",
        "sources": [_source_record(source, counts) for source in (OHM, OSM, WIKIDATA)],
        "features": features,
    }
    return collection, counts


def bounds_of(text: str) -> Bounds:
    """`W,S,E,N` as bounds; ValueError when it is not four numbers in order."""
    parts = text.split(",")
    if len(parts) != BOUNDS_VALUES:
        raise ValueError("bounds must be W,S,E,N")
    west, south, east, north = (float(part) for part in parts)
    return Bounds.of({"west": west, "south": south, "east": east, "north": north})


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="hcm_pipeline.lost_streets", description="Build a city's lost streets from open data.")
    parser.add_argument("--bounds", required=True, help="W,S,E,N in degrees")
    parser.add_argument("--out", required=True, type=Path, help="the GeoJSON file to write")
    return parser.parse_args(argv)


def run(bounds: Bounds, out: Path, fetchers: Fetchers) -> int:
    """Builds and writes the batch; 0 when written, 1 when a source did not answer."""
    try:
        collection, counts = build(bounds, fetchers)
    except (ReferenceUnavailableError, httpx.HTTPError, ValueError) as error:
        LOG.error("a source did not answer", extra=fields(reason=type(error).__name__, detail=str(error)))
        return 1
    out.write_text(json.dumps(collection, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    LOG.info(
        "lost streets written",
        extra=fields(out=str(out), fetched=counts.fetched, kept=counts.kept, features=counts.features, pointOnly=counts.point_only),
    )
    return 0


def main(argv: Sequence[str] | None = None, fetchers: Fetchers | None = None) -> int:
    """The command line entry point."""
    configure(sys.stderr)
    args = parse_args(argv)
    try:
        bounds = bounds_of(args.bounds)
    except ValueError as error:
        LOG.error("bad bounds", extra=fields(bounds=args.bounds, detail=str(error)))
        return 2
    if fetchers is not None:
        return run(bounds, args.out, fetchers)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json, application/sparql-results+json"}
    with httpx.Client(headers=headers, timeout=TIMEOUT_SECONDS) as http:
        return run(bounds, args.out, http_fetchers(http, time.sleep))


if __name__ == "__main__":
    sys.exit(main())
