"""Build the tactical book.

    python -m ace.tactical --fetch     # refresh Yahoo and Treasury, write the csv
    python -m ace.tactical             # score the committed csv and write the book
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ace.tactical.data import DAILY_PATH, build_panel, load_panel, write_panel
from ace.tactical.report import build_book
from ace.tactical.spec import CONTRACTS, MODELS

BOOK_PATH = Path(__file__).resolve().parents[2] / "src" / "lib" / "tactical" / "book.json"


def _fmt(value, digits=0) -> str:
    if value is None:
        return "—"
    if digits == 0:
        return f"{value:,.0f}"
    return f"{value:,.{digits}f}"


def _print(book: dict) -> None:
    print(f"as of {book['as_of']}  train {book['windows']['train']['start']}..{book['windows']['train']['end']}  test {book['windows']['test']['start']}..{book['windows']['test']['end']}")
    header = f"{'model':<22} {'asset':<4} {'IS pnl':>12} {'IS sh':>7} {'IS dd':>12} {'IS pf':>6} {'IS n':>5} {'OOS pnl':>12} {'OOS sh':>7} {'OOS dd':>12} {'OOS pf':>6} {'OOS n':>5}"
    print(header)
    for model in MODELS:
        block = book["models"][model]
        rows = list(CONTRACTS) + ["BOOK"]
        for asset in rows:
            if asset == "BOOK":
                stats = block["book"]
            else:
                stats = block["assets"][asset]
            if not stats.get("available", True):
                print(f"{model:<22} {asset:<4} unavailable")
                continue
            inn = stats["in_sample"]
            out = stats["out_of_sample"]
            print(
                f"{model:<22} {asset:<4} "
                f"{_fmt(inn['total_pnl']):>12} {_fmt(inn['sharpe'], 2):>7} {_fmt(inn['max_drawdown']):>12} {_fmt(inn['profit_factor'], 2):>6} {inn['trade_count']:>5} "
                f"{_fmt(out['total_pnl']):>12} {_fmt(out['sharpe'], 2):>7} {_fmt(out['max_drawdown']):>12} {_fmt(out['profit_factor'], 2):>6} {out['trade_count']:>5}"
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Score the tactical futures book")
    parser.add_argument("--fetch", action="store_true", help="download Yahoo and Treasury data and rewrite the csv")
    args = parser.parse_args()
    if args.fetch or not DAILY_PATH.exists():
        panel = build_panel(refresh=args.fetch)
        write_panel(panel)
        print(f"wrote {DAILY_PATH}")
    else:
        panel = load_panel()
    book = build_book(panel)
    BOOK_PATH.parent.mkdir(parents=True, exist_ok=True)
    BOOK_PATH.write_text(json.dumps(book, indent=2) + "\n")
    print(f"wrote {BOOK_PATH}")
    _print(book)


if __name__ == "__main__":
    main()
