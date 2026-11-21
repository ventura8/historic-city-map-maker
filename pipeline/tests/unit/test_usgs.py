"""The M2M download calls: options, the labelled request, retrieval and the best-effort order removal."""

from collections.abc import Mapping

from hcm_pipeline.m2m import M2MError
from hcm_pipeline.usgs import DownloadOption, download_option, label_for, remove_order, request_download, retrieve_download


class ScriptedSession:
    """An M2M session answering each endpoint with scripted data (or raising)."""

    def __init__(self, answers: Mapping[str, object]) -> None:
        self.answers = dict(answers)
        self.calls: list[tuple[str, Mapping[str, object] | None]] = []

    def request(self, endpoint: str, payload: Mapping[str, object] | None = None) -> object:
        self.calls.append((endpoint, payload))
        answer = self.answers.get(endpoint)
        if isinstance(answer, Exception):
            raise answer
        return answer


def test_happy_path_the_largest_available_product_is_chosen() -> None:
    session = ScriptedSession(
        {
            "download-options": [
                {"id": "p1", "available": True, "filesize": 10},
                {"id": "p2", "available": True, "filesize": 900},
                {"id": "p3", "available": False, "filesize": 9999},
                {"id": "p4", "available": True, "filesize": 0},
                "not a record",
            ]
        }
    )

    assert download_option(session, "corona2", "E1") == DownloadOption("p2", 900)
    assert session.calls == [("download-options", {"datasetName": "corona2", "entityIds": ["E1"]})]


def test_happy_path_a_landsat_product_bundle_is_preferred_over_a_larger_band() -> None:
    """Landsat's download-options lists several products; the Product Bundle is the one we request (M25)."""
    session = ScriptedSession(
        {
            "download-options": [
                {
                    "id": "look",
                    "available": True,
                    "filesize": 50,
                    "productName": "LandsatLook Images",
                    "secondaryDownloads": [
                        {
                            "id": "bundle",
                            "available": True,
                            "filesize": "100",
                            "productName": "Landsat Collection 2 Level-1 Product Bundle",
                        }
                    ],
                },
                {"id": "band", "available": True, "filesize": 500, "productName": "Landsat Collection 2 Level-1 Band File"},
            ]
        }
    )

    assert download_option(session, "landsat_ot_c2_l1", "LC81820292019178LGN00") == DownloadOption("bundle", 100)


def test_bad_path_a_scene_without_an_available_product_is_not_scanned() -> None:
    assert download_option(ScriptedSession({"download-options": [{"id": "p", "available": False, "filesize": 5}]}), "corona2", "E1") is None
    assert download_option(ScriptedSession({"download-options": None}), "corona2", "E1") is None


def test_happy_path_requests_and_retrievals_answer_the_signed_address_when_ready() -> None:
    ready = ScriptedSession({"download-request": {"availableDownloads": [{"url": ""}, {"url": "https://dds.cr.usgs.gov/x?sig=1"}]}})
    preparing = ScriptedSession({"download-request": {"availableDownloads": [], "preparingDownloads": [{"downloadId": 7}]}})
    retrieved = ScriptedSession({"download-retrieve": {"available": [{"url": "https://dds.cr.usgs.gov/y?sig=2"}]}})

    assert request_download(ready, "E1", "p2", label_for("job-1")) == "https://dds.cr.usgs.gov/x?sig=1"
    assert ready.calls[0][1] == {"downloads": [{"entityId": "E1", "productId": "p2"}], "label": "hcm-job-1"}
    assert request_download(preparing, "E1", "p2", "hcm-job-1") is None
    assert retrieve_download(retrieved, "hcm-job-1") == "https://dds.cr.usgs.gov/y?sig=2"
    assert retrieve_download(ScriptedSession({"download-retrieve": "odd"}), "hcm-job-1") is None


def test_bad_path_removing_the_order_is_best_effort() -> None:
    failing = ScriptedSession({"download-order-remove": M2MError("gone")})

    remove_order(failing, "hcm-job-1")
    remove_order(ScriptedSession({}), "hcm-job-1")

    assert failing.calls == [("download-order-remove", {"label": "hcm-job-1"})]
