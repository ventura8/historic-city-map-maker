# 1940s imagery and Esri Wayback: sources research

Research only (2026-11-16). Feeds the M28 Sources step (`docs/research/M28-sources.md`) and the M29 census
(`docs/research/M29-imagery-census.md`). Findings marked *unverified* need a check against the provider's own page
before any code.

## Summary

No 1940s source can be searched by place and fetched automatically today. The best option is a **guided source**:
the census reports that coverage probably exists and links to the place where it can be ordered, and Imagery ->
Upload takes the scans as they arrive. Esri Wayback can be shown with attribution, but it is 2014 and later, and
using it to align imagery is not clearly allowed, so do not use it for georeferencing.

## US National Archives (NARA), RG 373

- **Bucharest coverage**: RG 373 holds the Luftwaffe "GX" prints (1939-1945) and Allied sorties. The Ploiești
  and Bucharest raids of 1943-1944 make coverage likely, but per-frame records are rarely digitized or georeferenced.
  Most frames are described only at series or can level.
- **Search and fetch**: Catalog API v2, `GET https://catalog.archives.gov/api/v2/records/search` (docs:
  `https://catalog.archives.gov/api/v2/api-docs`). Uses an `x-api-key` header; the key is requested by email
  (`Catalog_API@nara.gov`), read-only, about 10,000 queries a month (*unverified*). Digitized objects come back
  as file URLs. There is no spatial search: results are text queries on series titles.
- **Licence**: US federal records, public domain. Captured German material in NARA is treated as public domain in
  practice (*unverified per item*).
- **Cost**: the API is free. Scanning undigitized frames needs a reproduction order or an in-person visit.
- **Integration**: a `nara` source that runs a text search ("Bucharest" / "Bukarest" plus `RG 373`) and lists only
  digitized hits as leads. No automatic layer.

## NCAP (National Collection of Aerial Photography, Edinburgh)

- **Bucharest coverage**: NCAP's Romania page lists ACIU (Allied, over 30 sorties, 1943-1945), MAPRW
  (Mediterranean Allied Photo Reconnaissance Wing) and uncatalogued German (GX) photography. NCAP also hosts
  scans of the NARA collection.
- **Search and fetch**: web search and browse only (`https://ncap.org.uk/search`,
  `https://ncap.org.uk/browse/countries/romania`); sortie plots exist for some collections. No public API was found.
  German frames need exact sortie and frame numbers to order.
- **Licence**: Crown copyright or NCAP licence. Standard licence terms apply per use, so a public web layer needs
  a licence.
- **Cost**: paid scans and licences per frame. No public price list was found; ask NCAP for a quote.
- **Integration**: a guided source. The census links to the NCAP Romania page and says "ask for a quote"; the
  owner uploads the delivered scans, and the existing calibration queue places them.

## Other 1940s sources

- **USGS EarthExplorer, Aerial Photo Single Frames**: mostly US coverage. Nothing useful for Romania in the 1940s.
  The existing M2M connection could check it at no cost, but it is not worth a new source.
- **Romania (ANCPI / national archives, the military archives)**: older aerial surveys exist, but there is no
  online catalogue or API. Requests are made in person or by letter. Treat it as a guided source with a link.
- **Europeana / German and Hungarian archives (Bundesarchiv, Hadtörténeti)**: there are scattered oblique photos
  but no searchable vertical surveys of Bucharest. These are useful for photos (the Photos module), not for layers.

## Esri World Imagery Wayback

- **What it is**: archived releases of World Imagery from 2014 on (WMTS per release; the list of releases is
  in the Wayback config JSON used by the open-source `Esri/wayback` app, Apache-2.0).
- **Terms**: the imagery falls under the Esri Master Agreement or Terms of Use. Esri staff have said that using
  the basemap and its variants (Clarity, Wayback) is allowed. Attribution is required:
  "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community". Exporting or caching tiles for
  offline use is not allowed with this layer (Esri offers a separate "for Export" layer). Free public use through
  ArcGIS needs an ArcGIS account or API key under the location-platform terms (*unverified for our tier*).
- **Display as a layer**: yes, as streamed raster tiles with attribution. Never copied to our bucket or to Mapbox.
- **Georeferencing**: not recommended. Maxar-derived imagery has the same restriction risk as Mapbox Satellite, and
  our rule keeps the reference to OSM plus Sentinel-2.
- **Rate limits**: none are published for the public tile endpoint; Esri asks for "reasonable use".

## Recommendation

1. M28: add **NCAP** and **NARA RG 373** as *guided* sources ("Order scans"), with no account and a cost of
   "per quote". Imagery -> Upload stays the way in.
2. M29: add a 1940s row to the census, "likely: Allied 1943-1944 sorties", with links to NCAP's country page and a
   NARA catalogue search. Fill it automatically only with digitized NARA hits.
3. Wayback: add it as an optional viewer overlay for recent years (2014 and later), with the attribution line,
   streamed and never cached. Exclude it from calibration.

## Sources

- <https://ncap.org.uk/browse/countries/romania>
- <https://ncap.org/image-collection/aciu>, <https://www.ncap.org/image-collection/maprw>,
  <https://ncap.org/image-collection/gx>, <https://ncap.org/image-collection/nara>
- <https://www.archives.gov/research/catalog/help/api>, <https://usnationalarchives.github.io/Catalog-API/>
- <https://goto.arcgis.com/maps/World_Imagery>, <https://github.com/Esri/wayback>,
  <https://wiki.openstreetmap.org/wiki/Esri>, <https://forum.openhistoricalmap.org/t/esri-world-imagery-wayback/381>
