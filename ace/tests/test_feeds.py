"""Feed adapter tests.

These test PARSING against fixtures rather than hitting the network, so they
are deterministic and do not fail because a public API is briefly down. The
network paths are exercised by the backfill job and the model runs.

The GDELT schema tests matter most: the 1.0 daily export and the 2.0 15-minute
export put geography in different columns, and reading 2.0's positions against
a 1.0 file silently places a source URL where latitude belongs. That is the
kind of defect that produces a working pipeline and wrong data.
"""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.feeds.gdelt import DAILY_COLUMNS, QUAD_CLASS
from ace.feeds.gdelt import COLUMNS as V2_COLUMNS


def test_gdelt_daily_and_v2_schemas_are_distinct():
    """The two GDELT feeds are NOT interchangeable."""
    assert DAILY_COLUMNS[53] == "action_geo_lat"
    assert DAILY_COLUMNS[56] == "date_added"
    assert DAILY_COLUMNS[57] == "source_url"
    # v2 puts date_added and source_url at 59/60, and geo at 56/57
    assert V2_COLUMNS[59] == "date_added"
    assert V2_COLUMNS[60] == "source_url"
    assert DAILY_COLUMNS[56] != V2_COLUMNS[56], "reading v2 positions on a 1.0 file misplaces geography"


def test_gdelt_daily_indices_stay_within_the_58_column_schema():
    assert max(DAILY_COLUMNS) < 58
    assert max(V2_COLUMNS) < 61


def test_quad_class_covers_the_cameo_taxonomy():
    assert QUAD_CLASS == {
        1: "verbal_cooperation",
        2: "material_cooperation",
        3: "verbal_conflict",
        4: "material_conflict",
    }


def _fake_daily_zip(rows: list[list[str]]) -> bytes:
    body = "\n".join("\t".join(r) for r in rows)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("20240115.export.CSV", body)
    return buf.getvalue()


def test_gdelt_daily_parser_reads_the_right_columns(monkeypatch, tmp_path):
    import ace.feeds.gdelt as g

    row = [""] * 58
    row[0] = "123456"
    row[1] = "20230115"          # event date, deliberately a year before the file
    row[6] = "CORPORATION"
    row[26] = "071"
    row[28] = "07"
    row[29] = "2"
    row[30] = "7.4"
    row[31] = "3"
    row[33] = "3"
    row[34] = "3.079"
    row[51] = "US"
    row[53] = "38.5168"
    row[54] = "-76.383"
    row[56] = "20240115"         # observed date
    row[57] = "https://example.com/a"

    blob = _fake_daily_zip([row])

    class _Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return blob

    monkeypatch.setattr(g, "CACHE", tmp_path)
    monkeypatch.setattr(g, "_throttle", lambda: None)
    monkeypatch.setattr(g.urllib.request, "urlopen", lambda *a, **k: _Resp())

    df = g.fetch_daily("20240115")
    assert len(df) == 1
    r = df.iloc[0]
    assert r["action_geo_lat"] == pytest.approx(38.5168)
    assert r["action_geo_long"] == pytest.approx(-76.383)
    assert r["source_url"] == "https://example.com/a"
    assert r["goldstein_scale"] == pytest.approx(7.4)
    # observed_at is the file date; event_date is when it happened
    assert str(r["observed_at"].date()) == "2024-01-15"
    assert str(r["event_date"].date()) == "2023-01-15"


def test_gdelt_daily_filters_apply_before_caching(monkeypatch, tmp_path):
    import ace.feeds.gdelt as g

    def mk(mentions: str, quad: str) -> list[str]:
        r = [""] * 58
        r[0], r[1], r[29], r[31], r[56] = "1", "20240115", quad, mentions, "20240115"
        return r

    blob = _fake_daily_zip([mk("50", "4"), mk("2", "4"), mk("50", "1")])

    class _Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return blob

    monkeypatch.setattr(g, "CACHE", tmp_path)
    monkeypatch.setattr(g, "_throttle", lambda: None)
    monkeypatch.setattr(g.urllib.request, "urlopen", lambda *a, **k: _Resp())

    df = g.fetch_daily("20240115", min_mentions=10, quad_classes=(3, 4))
    assert len(df) == 1, "only the high-mention conflict event should survive"
    assert int(df.iloc[0]["num_mentions"]) == 50
    assert int(df.iloc[0]["quad_class"]) == 4


def test_usgs_event_times_are_days_since_first_event():
    from ace.feeds.usgs import event_times_days

    df = pd.DataFrame({"time": pd.to_datetime(
        ["2020-01-01", "2020-01-02", "2020-01-11"], utc=True)})
    t, t0 = event_times_days(df)
    assert t[0] == 0.0
    assert t[1] == pytest.approx(1.0)
    assert t[2] == pytest.approx(10.0)
    assert str(t0.date()) == "2020-01-01"


def test_feed_errors_are_typed_so_callers_can_surface_them():
    from ace.feeds.gdelt import FeedUnavailable as G
    from ace.feeds.public import FeedUnavailable as P
    from ace.feeds.usgs import FeedUnavailable as U

    for exc in (G, P, U):
        assert issubclass(exc, RuntimeError)
