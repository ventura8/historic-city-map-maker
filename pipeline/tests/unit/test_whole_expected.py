"""Where the city likely lies on a whole frame's shrunk scan (`steps/locate.py` `on_scan`; admin sweep 2026-11-14, bug 6: a 15,034-pixel
Corona strip opened whole in the georeferencer, the city a few pixels)."""

from hcm_pipeline.steps.locate import on_scan
from hcm_pipeline.steps.whole import WholeFrame


def test_the_city_boxes_land_on_the_shrunk_scan_most_voted_first() -> None:
    """Scenarios: S-P01-HAPPY-WHOLE-EXPECTED"""
    whole = WholeFrame(8, 1000, 0)

    found = on_scan([(9000, 800, 25000, 4800), (90000, 800, 106000, 4800)], whole, (15034, 1171))

    assert found == [{"x": 1000, "y": 100, "width": 2000, "height": 500}, {"x": 11125, "y": 100, "width": 2000, "height": 500}]


def test_a_box_off_the_scan_is_left_out_and_one_over_its_edge_is_clipped() -> None:
    """Scenarios: S-P01-BAD-WHOLE-EXPECTED-OFF"""
    whole = WholeFrame(8, 0, 0)

    found = on_scan([(200_000, 0, 210_000, 800), (119_000, 0, 130_000, 9000)], whole, (15034, 1171))

    assert found == [{"x": 14875, "y": 0, "width": 159, "height": 1125}]
