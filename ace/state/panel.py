"""The macro panel, assembled point-in-time.

A factor model is only as honest as the panel under it. Two things can ruin one
and neither is visible in the output:

1. A value that had not been PUBLISHED on the date being modelled. The quad
   work measured what this costs on this exact data — 74.2% of real-time labels
   survived contact with the revised series, and 72% of the failures flipped
   the growth axis. A panel built from today's revised figures does not nowcast
   a state, it reads an almanac.

2. A transform applied before the point-in-time filter. Differencing the full
   revised series and THEN cutting to the vintage leaves the last difference
   computed against a number nobody had. The order here is filter first,
   transform second, always.

RAGGED EDGES ARE KEPT, NOT FILLED

Series publish on different calendars — payrolls at ~34 days, real consumption
at ~60, industrial production at ~45, the Treasury curve same-day — so on any
given date the newest observation differs per series. The panel keeps that
raggedness as NaN and hands it to `DynamicFactorMQ`, which is built for exactly
this via the Kalman filter. Forward-filling to square the panel would invent
observations and, far worse, would make the most-delayed series look as current
as the fastest.

A series is DROPPED rather than imputed when it has too little published
history to carry its transform. Absence is data; a fabricated value is not.

TWO FETCH ROUTES, AND WHY THE SPLIT IS NOT COSMETIC

A first sweep of 91 candidate series found 75 with an ALFRED first-release
archive and 16 without. Of those 16, thirteen are daily or weekly market
quotes — VIX, the Treasury curve, the Moody's spreads, the overnight repo
facility, the S&P 500 — for which FRED returns `output_type=4` as a 400 for the
simple reason that there is nothing to archive: a close never gets revised, so
the observation IS the first release. Dropping a whole block for want of a
vintage endpoint would be a self-inflicted hole in the exact place the
transmission work needs data.

So `SeriesSpec.revised` selects the route. It defaults to True, meaning a new
series must argue its way onto the unrevised path rather than fall onto it —
because taking that path for a revised statistical release would hand a model
the final value one day after the reference period. See
`ace.data.alfred.unrevised_history`.

MIXED FREQUENCY

The panel is monthly. Daily and weekly members are collapsed to a monthly
observation per `_to_monthly` below, and quarterly members (real GDP, the
employment cost index, the loan officer survey) are kept in a SEPARATE frame
and handed to `DynamicFactorMQ` as `endog_quarterly`, which applies the
Mariano-Murasawa aggregation — a quarterly reading is a weighted average of
three latent monthly values. Stacking a quarterly series into the monthly frame
with two NaNs out of every three would instead tell the model it is a monthly
series that is usually missing, which is a different and wrong claim.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from ace.data.alfred import release_history, unrevised_history
from ace.macro.quads import known_at
from ace.state.transforms import TRANSFORM_NAMES, apply_code, lags_consumed

#: Native publication frequencies the panel knows how to place on a monthly
#: (or, for quarterly members, a quarterly) index.
FREQUENCIES: frozenset[str] = frozenset({"daily", "weekly", "monthly", "quarterly"})

#: How many observations must have been PUBLISHED within a calendar month
#: before a higher-frequency series may contribute a value for that month.
#: A completed month clears this easily; the month in progress does not clear it
#: until roughly half-way through, which is the ragged edge doing its job rather
#: than a gap to be patched.
MONTH_COVERAGE: dict[str, int] = {"daily": 10, "weekly": 2}

#: The most a series may disagree with its own point-in-time history and still
#: be read via the unrevised route — as a SHARE of overlapping observations, not
#: a magnitude, because one corrected print is a typo and a thousand is a
#: methodology.
#:
#: Not a round number chosen in advance. The measured population separates by
#: three orders of magnitude: the series kept on this route sit at 0.000 to
#: 0.001 (VIX, two corrections in 2,020 days; the repo facility, one in 1,991),
#: and the one series rejected sits at 0.91 (the broad dollar index, whose
#: basket weights are re-estimated annually and applied backwards). Anything
#: landing between those two is a series nobody has looked at properly yet, and
#: 0.002 puts the line where the gap is rather than where it is convenient.
#: `artifacts/reports/macro_route_asof_check.json` holds the measurements.
MAX_UNREVISED_DIVERGENCE = 0.002

#: Series on the unrevised route whose route CANNOT be checked, and why. FRED's
#: licence for these refuses both the archive and the as-of snapshot, so the
#: claim rests on reasoning rather than measurement. Listed separately so a
#: reader never has to guess which is which.
UNVERIFIABLE_ROUTE: dict[str, str] = {
    "SP500": (
        "Rolling ten-year licence window: series/observations returns 400 for "
        "both output_type=4 and any realtime_start in the past, so neither "
        "check can run. An index close is not revised in any sense that would "
        "move a monthly panel, but that is an argument, not a measurement."
    ),
}


@dataclass(frozen=True)
class SeriesSpec:
    """One panel member, and the convention it is read under."""

    series_id: str
    label: str
    #: Economic block. The factor model uses this to place a block factor; the
    #: DRIVERS attribution uses it too, and so does a reader deciding whether a
    #: factor means what its name says.
    group: str
    #: FRED-MD transform code. See `ace.state.transforms`.
    code: int
    #: Median publication lag in days, measured from the vintage archive. Kept
    #: as documentation; the live figure is recomputed on every panel build.
    typical_lag_days: int
    note: str = ""
    #: True for a statistical release that gets revised — read from ALFRED's
    #: first-release archive. False ONLY for a series whose observation is its
    #: own first release, read from the standard endpoint. Defaulting to True
    #: means the unsafe route is never the accident.
    #:
    #: "Its own first release" is a MEASURED property here, not an assumption
    #: about what kind of series it is. Two checks stand behind every False in
    #: the panel — the first-release archive where ALFRED has one, and an
    #: ALFRED as-of snapshot two and four years back where it does not. The
    #: results are in artifacts/reports/macro_route_verification.json and
    #: macro_route_asof_check.json, and they cost one series its place on this
    #: route: the broad dollar index, which looks like a quote and is a
    #: reweighted index, disagrees with its archive on 91% of days.
    revised: bool = True
    #: Native frequency, which decides how the series is placed on the panel's
    #: monthly index.
    frequency: str = "monthly"
    #: Override the archive request's start date for this series only. FRED
    #: answers `output_type=4` from its own server, and for a long weekly series
    #: the full archive is large enough that the request comes back as a 504
    #: Gateway Time-out — measured, not guessed: NFCI 504s from 1980 and returns
    #: in 13 seconds from 2015. Setting this trades history for a series that is
    #: otherwise unreachable, and the traded-away years are recorded in the note.
    vintage_start: str | None = None

    def __post_init__(self) -> None:
        if self.code not in TRANSFORM_NAMES:
            raise ValueError(f"{self.series_id}: unknown transform code {self.code}")
        if self.frequency not in FREQUENCIES:
            raise ValueError(f"{self.series_id}: unknown frequency {self.frequency!r}")


#: The full panel: nine blocks, every series verified reachable against the live
#: API before it was written down here.
#:
#: Provenance of this list. A 91-candidate sweep recorded, per series, whether
#: ALFRED serves a first-release archive, how far back it goes and the median
#: publication lag — see `artifacts/reports/macro_panel_coverage.json`. Three
#: candidates did not survive and are recorded in `UNAVAILABLE` below rather
#: than quietly dropped, because "we have all the federal data" is a claim that
#: has to be auditable in both directions.
PANEL: tuple[SeriesSpec, ...] = (
    # --- output and growth --------------------------------------------------
    SeriesSpec("INDPRO", "Industrial production", "growth", 5, 45,
               "Cyclical and volatile; turns before the labour market."),
    SeriesSpec("IPFINAL", "IP: final products", "growth", 5, 45,
               "The demand end of the production chain."),
    SeriesSpec("IPCONGD", "IP: consumer goods", "growth", 5, 45,
               "Separates household demand from business demand inside IP."),
    SeriesSpec("IPBUSEQ", "IP: business equipment", "growth", 5, 45,
               "Capex in volume terms, and the most cyclical slice of IP."),
    SeriesSpec("IPMAT", "IP: materials", "growth", 5, 45,
               "Upstream of the other three, so it turns first in a goods cycle."),
    SeriesSpec("TCU", "Capacity utilization", "growth", 2, 45,
               "A utilisation rate, so differenced. The slack measure the "
               "Taylor rule work leans on."),
    SeriesSpec("GDPC1", "Real GDP", "growth", 5, 119, frequency="quarterly",
               note="The definition of output, four months late. Enters as a "
                    "quarterly block so the Mariano-Murasawa aggregation ties "
                    "it to three latent monthly values instead of pretending "
                    "it is a monthly series with gaps."),
    # --- manufacturing and orders -------------------------------------------
    SeriesSpec("IPMANSICS", "IP: manufacturing", "manufacturing", 5, 45,
               "Manufacturing on the SIC basis, the longest-running cut."),
    SeriesSpec("DGORDER", "Durable goods orders", "manufacturing", 5, 55,
               "Orders lead shipments lead production. Noisy: aircraft alone "
               "can move the headline several percent."),
    SeriesSpec("NEWORDER", "Core capital goods orders", "manufacturing", 5, 56,
               "Non-defence capital goods ex aircraft — the same signal with "
               "the two worst sources of noise removed."),
    SeriesSpec("AMDMUO", "Unfilled orders: durables", "manufacturing", 5, 55,
               "The backlog. Falling unfilled orders with flat shipments is "
               "production running ahead of demand."),
    SeriesSpec("BUSINV", "Business inventories", "manufacturing", 5, 74,
               "Slow, and worth the wait: inventory is where a demand miss "
               "shows up before anyone admits it."),
    SeriesSpec("ISRATIO", "Inventory/sales ratio", "manufacturing", 2, 74,
               "A ratio, so differenced. Rising means stock accumulating "
               "against sales, which is the recession tell."),
    # --- labor ---------------------------------------------------------------
    SeriesSpec("PAYEMS", "Nonfarm payrolls", "labor", 5, 34,
               "The fastest broad read, and the one the rest wait for."),
    SeriesSpec("UNRATE", "Unemployment rate", "labor", 2, 34,
               "A rate, so differenced rather than log-differenced."),
    SeriesSpec("U6RATE", "U-6 underemployment", "labor", 2, 34,
               "Includes part-time-for-economic-reasons, so it deteriorates "
               "before the headline rate does."),
    SeriesSpec("CIVPART", "Labor force participation", "labor", 2, 34,
               "The denominator. A falling unemployment rate on falling "
               "participation is not a tightening labour market."),
    SeriesSpec("AWHMAN", "Mfg weekly hours", "labor", 1, 34,
               "Hours move before heads; already stationary in level."),
    SeriesSpec("AWOTMAN", "Mfg overtime hours", "labor", 2, 34,
               "The first margin an employer cuts, ahead of hours and heads."),
    SeriesSpec("MANEMP", "Manufacturing employment", "labor", 5, 34,
               "The cyclical end of the labor market."),
    SeriesSpec("USCONS", "Construction employment", "labor", 5, 34,
               "The rate-sensitive end, and the fastest read on housing."),
    SeriesSpec("USTRADE", "Retail trade employment", "labor", 5, 34,
               "Hiring against expected consumption, not realised."),
    SeriesSpec("SRVPRD", "Service-providing employment", "labor", 5, 34,
               "Five sixths of jobs. Slow to turn, which is the point: it "
               "confirms rather than leads."),
    SeriesSpec("ICSA", "Initial claims", "labor", 5, 5, frequency="weekly",
               note="The highest-frequency labour read there is, five days "
                    "behind. Weekly, so collapsed to a monthly observation."),
    SeriesSpec("CCSA", "Continuing claims", "labor", 5, 12, frequency="weekly",
               note="Initial claims say who lost a job; continuing claims say "
                    "whether they found another."),
    SeriesSpec("JTSJOL", "JOLTS job openings", "labor", 5, 68,
               "Labour demand rather than labour outcomes. Slow, and the "
               "numerator of the vacancy-to-unemployed ratio."),
    SeriesSpec("JTSQUR", "JOLTS quits rate", "labor", 2, 68,
               "A rate, so differenced. Quits are a worker-confidence read "
               "and they lead wage growth."),
    SeriesSpec("JTSLDR", "JOLTS layoffs rate", "labor", 2, 68,
               "The other side of quits. Layoffs rising while quits fall is "
               "the labour market breaking, not cooling."),
    SeriesSpec("UEMPMEAN", "Mean duration unemployed", "labor", 2, 34,
               "Lengthening duration is how a soft landing turns hard."),
    # --- consumer ------------------------------------------------------------
    SeriesSpec("RRSFS", "Real retail sales", "consumer", 5, 45,
               "Consumption in volume terms, so inflation does not leak in."),
    SeriesSpec("PCEC96", "Real consumption", "consumer", 5, 60,
               "Two thirds of output, three weeks behind payrolls."),
    SeriesSpec("DSPIC96", "Real disposable income", "consumer", 5, 60,
               "What funds consumption; turns earlier in an income shock."),
    SeriesSpec("W875RX1", "Real income ex transfers", "consumer", 5, 59,
               "Strips out government payments, so it reads earned income "
               "only — the cut the NBER dating committee watches."),
    SeriesSpec("PSAVERT", "Personal saving rate", "consumer", 2, 59,
               "A rate, so differenced. Consumption held up by a falling "
               "saving rate is borrowed from next quarter."),
    SeriesSpec("UMCSENT", "U Michigan sentiment", "consumer", 2, 27,
               "A survey, so a level index rather than a quantity. Fast, and "
               "the soft-data counterweight to the hard series above."),
    SeriesSpec("TOTALSA", "Total vehicle sales", "consumer", 5, 34,
               "The big-ticket, credit-financed end of consumption — where a "
               "rate shock lands first."),
    # --- housing -------------------------------------------------------------
    SeriesSpec("HOUST", "Housing starts", "housing", 4, 47,
               "Rate-sensitive and early. Logged, not differenced — the level "
               "of log starts is the cycle."),
    SeriesSpec("PERMIT", "Building permits", "housing", 4, 47,
               "One step ahead of starts, and less weather-sensitive."),
    SeriesSpec("HOUSTNE", "Housing starts: Northeast", "housing", 4, 47,
               "The regional cuts are kept because the national figure is "
               "thin enough that one region's weather can carry it."),
    SeriesSpec("HOUSTMW", "Housing starts: Midwest", "housing", 4, 47,
               "See HOUSTNE."),
    SeriesSpec("HOUSTS", "Housing starts: South", "housing", 4, 47,
               "Roughly half of national starts, so it dominates the "
               "aggregate — worth watching on its own."),
    SeriesSpec("HOUSTW", "Housing starts: West", "housing", 4, 47,
               "The most rate-sensitive region by price level."),
    SeriesSpec("HSN1F", "New one-family houses sold", "housing", 4, 55,
               "Sales against the starts above; the gap is builder inventory."),
    SeriesSpec("CSUSHPINSA", "Case-Shiller national HPI", "housing", 6, 87,
               "A price index, so a second log difference. Three months late "
               "and a three-month moving average on top — slow by design."),
    SeriesSpec("MORTGAGE30US", "30y mortgage rate", "housing", 2, 0,
               frequency="weekly",
               note="The transmission channel from policy to housing, same-day "
                    "weekly. Differenced; the level is not stationary."),
    # --- prices --------------------------------------------------------------
    SeriesSpec("CPIAUCSL", "CPI", "inflation", 6, 45,
               "Price indices take a second log difference: the first gives "
               "inflation, the second gives whether inflation is turning."),
    SeriesSpec("CPILFESL", "Core CPI", "inflation", 6, 45,
               "Ex food and energy; less noisy, slower to turn."),
    SeriesSpec("CPIENGSL", "CPI energy", "inflation", 6, 45,
               "The volatile component the core strips out, kept separately "
               "so an energy shock is identifiable rather than absorbed."),
    SeriesSpec("CPIUFDSL", "CPI food", "inflation", 6, 45,
               "The other stripped component, and the one households feel."),
    SeriesSpec("CUSR0000SAC", "CPI commodities", "inflation", 6, 43,
               "Goods prices. Tradeable, so this is where the dollar and "
               "tariffs show up."),
    SeriesSpec("CUSR0000SAS", "CPI services", "inflation", 6, 43,
               "Non-tradeable and wage-driven, so it is the persistent half. "
               "The goods/services split is the whole 2021-2024 argument."),
    SeriesSpec("PCEPI", "PCE price index", "inflation", 6, 59,
               "The Fed's actual target, two weeks behind CPI."),
    SeriesSpec("PCEPILFE", "Core PCE", "inflation", 6, 59,
               "The specific number the FOMC statement refers to."),
    SeriesSpec("PPIACO", "PPI all commodities", "inflation", 6, 43,
               "Upstream, so it leads consumer prices on a cost shock."),
    SeriesSpec("PPIFIS", "PPI final demand", "inflation", 6, 43,
               "The current headline PPI concept; PPIACO is the long history."),
    SeriesSpec("WPSFD49207", "PPI finished consumer goods", "inflation", 6, 42,
               "The slice of PPI that maps most directly onto CPI goods."),
    SeriesSpec("CES0500000003", "Average hourly earnings", "inflation", 6, 34,
               "The wage side of inflation, and the fastest price read."),
    SeriesSpec("ECIWAG", "Employment cost index: wages", "inflation", 6, 120,
               frequency="quarterly",
               note="Slower than average hourly earnings and far cleaner: the "
                    "ECI holds job mix fixed, so it does not move when the "
                    "composition of employment shifts. Quarterly."),
    # --- money and liquidity -------------------------------------------------
    SeriesSpec("M1SL", "M1 money stock", "liquidity", 6, 43,
               "Narrow money. The 2020 definitional change makes the level "
               "incomparable across that break; the second difference of logs "
               "is what survives it."),
    SeriesSpec("M2SL", "M2 money stock", "liquidity", 6, 43,
               "Broad money, and the aggregate the 2021 inflation argument "
               "was actually conducted in."),
    SeriesSpec("M2REAL", "Real M2", "liquidity", 5, 49,
               "M2 deflated by CPI — purchasing power rather than nominal "
               "stock, so one log difference, not two."),
    SeriesSpec("BOGMBASE", "Monetary base", "liquidity", 6, 43,
               "Central bank money specifically, as distinct from deposits."),
    SeriesSpec("TOTRESNS", "Total reserves", "liquidity", 6, 39,
               "Bank reserves at the Fed — the quantity balance-sheet policy "
               "operates on directly."),
    SeriesSpec("WALCL", "Fed balance sheet", "liquidity", 1, 5,
               frequency="weekly",
               note="Total assets, weekly, one day behind. The quantitative "
                    "side of policy, which the funds rate does not capture."),
    SeriesSpec("WTREGEN", "Treasury general account", "liquidity", 1, 1,
               frequency="weekly",
               note="A level in billions, already stationary enough to use "
                    "raw. Moves reserves around without any policy decision, "
                    "which is why it belongs next to WALCL rather than inside "
                    "an interpretation of it."),
    SeriesSpec("RRPONTSYD", "Overnight reverse repo", "liquidity", 1, 0,
               revised=False, frequency="daily",
               note="The Fed's daily repo facility take-up, published same "
                    "day. The drain that stood between the balance sheet and "
                    "reserves through 2022-2024. One of ~2,000 observations "
                    "was corrected between the 2023 snapshot and today, by "
                    "$0.103bn against a series that routinely moves by "
                    "hundreds of billions."),
    # --- credit --------------------------------------------------------------
    SeriesSpec("TOTALSL", "Total consumer credit", "credit", 6, 67,
               "Household borrowing. Slow — a G.19 release is two months out."),
    SeriesSpec("REVOLSL", "Revolving consumer credit", "credit", 6, 67,
               "Card balances. Rising revolving credit against flat income is "
               "consumption being financed rather than earned."),
    SeriesSpec("NONREVSL", "Nonrevolving consumer credit", "credit", 6, 67,
               "Auto and student loans — a different decision from a card "
               "balance, so kept separate."),
    SeriesSpec("BUSLOANS", "Commercial & industrial loans", "credit", 6, 41,
               "Bank credit to firms, from the weekly H.8 aggregated monthly."),
    SeriesSpec("REALLN", "Real estate loans", "credit", 6, 41,
               "The largest bank asset class, and the one a CRE shock hits."),
    SeriesSpec("TOTCI", "Total C&I loans (weekly)", "credit", 6, 9,
               frequency="weekly",
               note="The same concept as BUSLOANS at weekly frequency, nine "
                    "days behind instead of six weeks. Both are kept: the "
                    "monthly one has the history, the weekly one has the edge."),
    SeriesSpec("DRTSCILM", "Loan officer survey: tightening", "credit", 1, 34,
               frequency="quarterly",
               note="A net-percentage diffusion index, already bounded, so it "
                    "enters in level. The only direct read on credit SUPPLY "
                    "rather than credit outstanding — quantities cannot "
                    "distinguish nobody wanting to borrow from nobody being "
                    "allowed to. Quarterly."),
    SeriesSpec("BAMLH0A0HYM2", "High yield OAS", "credit", 1, 0,
               revised=False, frequency="daily",
               note="A spread in percent, so level. FRED's ICE BofA licence "
                    "exposes only a rolling window — roughly three years of "
                    "history, which is why this cannot anchor a long "
                    "backtest and is present for the current-state read."),
    SeriesSpec("BAA10Y", "Baa - 10y spread", "credit", 1, 0,
               revised=False, frequency="daily",
               note="Moody's Baa over the 10y Treasury, daily back to 1986. "
                    "The long credit-stress history the ICE series lacks."),
    SeriesSpec("AAA10Y", "Aaa - 10y spread", "credit", 1, 0,
               revised=False, frequency="daily",
               note="The investment-grade end. Baa-minus-Aaa is the part of "
                    "the spread that is default risk rather than duration."),
    # --- financial conditions and policy -------------------------------------
    SeriesSpec("NFCI", "Chicago Fed financial conditions", "financial", 1, 5,
               frequency="weekly", vintage_start="2005-01-01",
               note="The broadest financial-conditions composite there is — 105 "
                    "indicators of risk, credit and leverage on one zero-centred "
                    "scale, so level. Two separate limits, measured: FRED 504s "
                    "on the archive request from 1980, which the 2005 start "
                    "works around, and the archive ITSELF only begins 2011-05-27 "
                    "whatever start is asked for. The revised series goes back "
                    "to 1971 and is deliberately not used."),
    SeriesSpec("ANFCI", "Adjusted NFCI", "financial", 1, 5,
               frequency="weekly", vintage_start="2005-01-01",
               note="NFCI with the part explained by the real economy and "
                    "inflation projected out, so what is left is financial "
                    "conditions that are NOT just the cycle. The pair is the "
                    "decomposition; neither half is the other's substitute."),
    SeriesSpec("STLFSI4", "St Louis financial stress", "financial", 1, 6,
               frequency="weekly",
               note="A composite index centred on zero, so level. The vintage "
                    "archive only starts in 2022 because the index was "
                    "rebuilt; point-in-time depth is short."),
    SeriesSpec("FEDFUNDS", "Fed funds effective", "financial", 2, 33,
               "The policy rate itself, differenced. The monthly average, "
               "which is the series the Taylor rule work is calibrated on."),
    SeriesSpec("DGS2", "2y Treasury", "financial", 2, 0,
               revised=False, frequency="daily",
               note="The maturity that prices the expected policy path. "
                    "Differenced; a yield level is not stationary."),
    SeriesSpec("DGS10", "10y Treasury", "financial", 2, 0,
               revised=False, frequency="daily",
               note="The discount rate for everything else."),
    SeriesSpec("T10Y2Y", "10y-2y slope", "financial", 1, 0,
               revised=False, frequency="daily",
               note="A spread, so level. Already the difference of two "
                    "non-stationary yields."),
    SeriesSpec("T10Y3M", "10y-3m slope", "financial", 1, 0,
               revised=False, frequency="daily",
               note="The slope with the better recession record of the two, "
                    "because the front end is the policy rate rather than an "
                    "expectation of it."),
    SeriesSpec("T10YIE", "10y breakeven", "financial", 1, 0,
               revised=False, frequency="daily",
               note="Market-implied inflation compensation. Not an "
                    "expectation — it carries a risk premium — but it is the "
                    "daily one, against surveys that are monthly at best."),
    SeriesSpec("DFII10", "10y TIPS real yield", "financial", 2, 0,
               revised=False, frequency="daily",
               note="The real rate. Nominal minus breakeven by construction, "
                    "and the channel a policy surprise travels down."),
    SeriesSpec("VIXCLS", "VIX", "financial", 1, 0,
               revised=False, frequency="daily",
               note="Implied volatility in points, so level. The regime work "
                    "found volatility, not means, is where monthly macro "
                    "regime structure actually lives. Not perfectly unrevised: "
                    "2 of 2,020 observations moved between the 2023 snapshot "
                    "and today, by at most 0.08 vol points — two corrections in "
                    "eight years, three orders of magnitude below the series' "
                    "own daily range. Stated rather than rounded to never."),
    SeriesSpec("DTWEXBGS", "Broad dollar index", "financial", 5, 5,
               frequency="daily",
               note="Trade-weighted, so it is the dollar that matters for "
                    "import prices rather than one cross. Reads the ARCHIVE, "
                    "not the current series, and that is a measured correction "
                    "rather than caution: the two disagree on 91% of overlapping "
                    "days by up to 2.18 index points, because the H.10 basket "
                    "weights are re-estimated annually and applied backwards. A "
                    "constructed index is not a quote. Costs history — the "
                    "archive starts 2019-02 — and is worth it. See "
                    "artifacts/reports/macro_route_verification.json."),
    SeriesSpec("SP500", "S&P 500", "financial", 5, 0,
               revised=False, frequency="daily",
               note="FRED serves a rolling ten-year window, so this cannot "
                    "carry a long backtest. The same licence makes the route "
                    "UNVERIFIABLE: both the archive and the as-of snapshot "
                    "return 400, so unlike the other members of this route "
                    "the no-revisions claim here is reasoning about an index "
                    "close, not a measurement. Flagged rather than filed with "
                    "the ones that were checked."),
)

#: Candidates that were probed and are NOT in the panel, with the measured
#: reason. Kept in code rather than a commit message: "we have every federal
#: series" is a claim, and a claim needs its exceptions written down where the
#: next person reads the panel.
UNAVAILABLE: dict[str, str] = {
    "EXHOSLUSM495S": (
        "Existing home sales. FRED holds 13 observations — a rolling "
        "13-month window — because the underlying data is licensed from the "
        "National Association of Realtors. Not a point-in-time problem and "
        "not fixable from the API: there is no history to fetch. HSN1F (new "
        "home sales) is the closest federal substitute and is in the panel."
    ),
    "AMDMNOx": (
        "FRED-MD's internal name for durable goods new orders, not a FRED "
        "series ID; AMDMNO does not exist either. DGORDER is the same concept "
        "under its real ID and is in the panel."
    ),
    "AMDMUOx": (
        "FRED-MD's internal name. The real ID is AMDMUO, which IS in the "
        "panel."
    ),
}

PANEL_BY_ID: dict[str, SeriesSpec] = {s.series_id: s for s in PANEL}

#: Canonical block order. `build_asof` derives the groups it reports from the
#: specs it was handed, so a caller passing a custom panel is not silently
#: filtered against this tuple; it is the display and iteration order for the
#: default panel.
GROUPS: tuple[str, ...] = (
    "growth", "manufacturing", "labor", "consumer", "housing",
    "inflation", "liquidity", "credit", "financial",
)

#: A series needs this many published observations AFTER its transform before
#: it may join. Below it the column is nearly all NaN and contributes a loading
#: estimated from a handful of points. Quarterly members get a lower bar in the
#: same units they are measured in — 20 quarters is five years.
MIN_USABLE_OBS = 36
MIN_USABLE_OBS_QUARTERLY = 20


@dataclass(frozen=True)
class PanelBuild:
    """A point-in-time panel and everything needed to audit it."""

    as_of: str
    #: Transformed, ragged, one column per surviving MONTHLY series (daily and
    #: weekly members having been collapsed to monthly).
    frame: pd.DataFrame
    #: Untransformed levels as published — kept so a reader can check a factor
    #: against the number a human would have seen.
    levels: pd.DataFrame
    used: tuple[str, ...]
    dropped: dict[str, str]
    #: Newest PUBLISHED observation month per series, and days behind `as_of`.
    edge: dict[str, dict]
    #: Whole months between the newest observation anywhere and `as_of`.
    months_behind: int | None = None
    groups: dict[str, tuple[str, ...]] = field(default_factory=dict)
    #: Transformed quarterly members, on a quarterly index. Handed to
    #: `DynamicFactorMQ` as `endog_quarterly`, never stacked into `frame`.
    frame_q: pd.DataFrame = field(default_factory=pd.DataFrame)
    #: Untransformed quarterly levels, for the same audit reason as `levels`.
    levels_q: pd.DataFrame = field(default_factory=pd.DataFrame)

    @property
    def n_series(self) -> int:
        return len(self.used)

    @property
    def n_monthly(self) -> int:
        return int(self.frame.shape[1])

    @property
    def n_quarterly(self) -> int:
        return int(self.frame_q.shape[1])

    def describe(self) -> str:
        lag = "unknown" if self.months_behind is None else f"{self.months_behind} month(s)"
        return (
            f"{self.n_series}/{len(PANEL)} series as of {self.as_of} "
            f"({self.n_monthly} monthly, {self.n_quarterly} quarterly), "
            f"newest observation {lag} behind, {len(self.dropped)} dropped"
        )


#: Why each series that failed to load failed, keyed by series id. Populated by
#: `load_vintages` and read by `build_asof`, so a dropped column is attributable
#: to a 400, a timeout or a missing key rather than all three collapsing into
#: "no vintage archive".
LOAD_ERRORS: dict[str, str] = {}


def load_vintages(
    specs: tuple[SeriesSpec, ...] = PANEL, start: str = "1980-01-01"
) -> dict[str, pd.DataFrame]:
    """Publication histories for every panel member, fetched once.

    Fetching once and filtering per date is what makes a historical replay
    cheap: a 300-month backtest is 300 filters, not 300 x 88 API calls.

    The route per series is `spec.revised`: ALFRED's first-release archive for a
    statistical release, the standard endpoint for a never-revised quote. See
    the module docstring and `ace.data.alfred.unrevised_history`.

    `start` is the default archive depth; a spec may pull its own start forward
    via `vintage_start` when the full archive exceeds what FRED will serve.

    A series that cannot be fetched comes back as an EMPTY frame with the
    correct columns, and the reason goes into the module-level `LOAD_ERRORS`.
    Returning an empty frame rather than omitting the key keeps `build_asof`'s
    loop uniform; recording the reason separately keeps the returned dict a
    clean `str -> DataFrame` mapping, which the previous `__error__<id>` sentinel
    did not.
    """
    LOAD_ERRORS.clear()
    out: dict[str, pd.DataFrame] = {}
    for spec in specs:
        try:
            begin = spec.vintage_start or start
            if spec.revised:
                out[spec.series_id] = release_history(spec.series_id, begin)
            else:
                out[spec.series_id] = unrevised_history(spec.series_id, begin)
        except Exception as exc:  # noqa: BLE001 — a missing series is data
            # Recorded as absent, never substituted. `build_asof` reports it.
            LOAD_ERRORS[spec.series_id] = f"{type(exc).__name__}: {exc}"
            out[spec.series_id] = pd.DataFrame(
                columns=["obs_date", "value", "published"]
            ).astype({"value": float})
    return out


def _utc(when: pd.Timestamp) -> pd.Timestamp:
    """A timestamp in UTC whether or not it arrived with a zone."""
    return when.tz_localize("UTC") if when.tzinfo is None else when.tz_convert("UTC")


def _to_monthly(published: pd.Series, spec: SeriesSpec) -> pd.Series:
    """Place a daily or weekly series on a monthly index. Others pass through.

    The monthly value is the LAST observation published within the calendar
    month, not the month's average. For the level series this route carries —
    yields, spreads, index points, a balance sheet total — "where it stood at
    the end of the month" is a well-defined statistic whether or not the month
    finished, whereas a mean over a part-finished month is a different statistic
    from a mean over a whole one, and differencing across that boundary would
    manufacture a change that did not happen.

    A month is emitted only once `MONTH_COVERAGE` observations have been
    published in it, which keeps a month from being represented by one early
    print. The month in progress therefore appears about half-way through and
    is NaN before that — the ragged edge behaving as the module docstring
    promises, not a hole to fill.

    Takes the series AFTER the point-in-time filter, so the aggregation can only
    ever see what had been published. Aggregating first would put days from
    after `as_of` into the current month's figure.
    """
    if spec.frequency not in MONTH_COVERAGE:
        return published
    if published.empty:
        return published
    idx = pd.DatetimeIndex(published.index)
    # A period is a span, not an instant, so a timezone on it means nothing —
    # pandas warns when converting a tz-aware index. Dropping the zone here
    # makes that deliberate. Every stamp in this panel is a FRED reference-date
    # label at midnight UTC, so nothing is lost.
    keys = (idx.tz_localize(None) if idx.tz is not None else idx).to_period("M")
    grouped = published.groupby(keys)
    counts = grouped.size()
    last = grouped.last()
    need = MONTH_COVERAGE[spec.frequency]
    keep = counts[counts >= need].index
    out = last.loc[last.index.isin(keep)]
    # Re-index to month START, matching the convention FRED uses for every
    # monthly series in the panel, so the frames align on join.
    out.index = pd.DatetimeIndex([p.to_timestamp(how="start") for p in out.index], tz="UTC")
    return out.sort_index()


def build_asof(
    when: pd.Timestamp | str,
    vintages: dict[str, pd.DataFrame],
    *,
    specs: tuple[SeriesSpec, ...] = PANEL,
    min_usable: int = MIN_USABLE_OBS,
) -> PanelBuild:
    """Assemble the panel using only what had been published by `when`.

    Filter first, aggregate second, transform third. See the module docstring
    for why the first two are not interchangeable with the third.
    """
    when = pd.Timestamp(when)
    if when.tzinfo is None:
        when = when.tz_localize("UTC")

    by_id = {s.series_id: s for s in specs}
    levels: dict[str, pd.Series] = {}
    transformed: dict[str, pd.Series] = {}
    levels_q: dict[str, pd.Series] = {}
    transformed_q: dict[str, pd.Series] = {}
    dropped: dict[str, str] = {}
    edge: dict[str, dict] = {}

    for spec in specs:
        quarterly = spec.frequency == "quarterly"
        floor = (
            min(min_usable, MIN_USABLE_OBS_QUARTERLY) if quarterly else min_usable
        )

        hist = vintages.get(spec.series_id)
        if hist is None or hist.empty:
            dropped[spec.series_id] = LOAD_ERRORS.get(
                spec.series_id, "no publication history returned"
            )
            continue

        # (1) point-in-time filter — first releases published on or before `when`
        published = known_at(hist, when)
        if published.empty:
            dropped[spec.series_id] = "nothing published by this date"
            continue

        # (2) collapse to the panel's frequency, on published rows only.
        # `native_newest` is captured BEFORE the collapse because it is the
        # honest answer to "how stale is this input": the 10y yield stamped into
        # the September row was printed on the 25th, not the 1st, and reporting
        # 25 days behind would understate the exact edge these series are here
        # to provide.
        n_raw = int(len(published))
        native_newest = pd.Timestamp(published.index.max())
        published = _to_monthly(published, spec)
        if published.empty:
            dropped[spec.series_id] = (
                f"{n_raw} {spec.frequency} observations, none in a month with "
                f"{MONTH_COVERAGE.get(spec.frequency, 1)} or more"
            )
            continue

        need = lags_consumed(spec.code) + floor
        if len(published) < need:
            dropped[spec.series_id] = (
                f"{len(published)} published observations, needs {need} "
                f"for transform {spec.code}"
            )
            continue

        # (3) transform, on the filtered and collapsed series only
        try:
            values = apply_code(published, spec.code)
        except Exception as exc:  # noqa: BLE001 — a bad transform is data
            dropped[spec.series_id] = f"transform failed: {exc}"
            continue

        usable = values.dropna()
        if len(usable) < floor:
            dropped[spec.series_id] = f"{len(usable)} usable after transform"
            continue

        if quarterly:
            levels_q[spec.series_id] = published
            transformed_q[spec.series_id] = values
        else:
            levels[spec.series_id] = published
            transformed[spec.series_id] = values
        # `known_at` returns a UTC-aware index; normalising here rather than
        # assuming either way keeps this working if that ever changes.
        stamp = _utc(pd.Timestamp(published.index.max()))
        newest = _utc(native_newest)
        edge[spec.series_id] = {
            # The newest real observation, and how stale it is. For a monthly
            # series these two are the same; for a collapsed one `through` is
            # the print date and `panel_month` is the row it landed in.
            "through": str(newest.date()),
            "days_behind": int((when - newest).days),
            "panel_month": str(stamp.date()),
            "n_published": int(len(published)),
            "n_usable": int(len(usable)),
            "frequency": spec.frequency,
            "route": "alfred_first_release" if spec.revised else "unrevised_observation",
        }
        if spec.frequency in MONTH_COVERAGE:
            # How many native prints stand behind the monthly column, so a
            # reader can see that 561 monthly values came from 11,684 daily ones
            # rather than from 561 observations of a monthly series.
            edge[spec.series_id]["n_native"] = n_raw

    if not transformed and not transformed_q:
        return PanelBuild(
            as_of=str(when.date()), frame=pd.DataFrame(), levels=pd.DataFrame(),
            used=(), dropped=dropped, edge={},
        )

    frame = pd.DataFrame(transformed).sort_index() if transformed else pd.DataFrame()
    level_frame = pd.DataFrame(levels).sort_index() if levels else pd.DataFrame()
    frame_q = pd.DataFrame(transformed_q).sort_index() if transformed_q else pd.DataFrame()
    level_frame_q = pd.DataFrame(levels_q).sort_index() if levels_q else pd.DataFrame()

    # Derived from `panel_month`, not `through`: this answers "how far back is
    # the newest ROW", which is a statement about the frame, where `through`
    # answers "how old is the newest number", which is a statement about an input.
    newest_row = max(pd.Timestamp(e["panel_month"]) for e in edge.values())
    months_behind = (when.year - newest_row.year) * 12 + (when.month - newest_row.month)

    # Monthly first, then quarterly: `used` is the audit order and the monthly
    # frame is what the factor model is primarily estimated on.
    used = tuple(frame.columns) + tuple(frame_q.columns)
    # Groups come from the specs actually passed, not the module-level default,
    # so a custom panel does not get silently filtered against `GROUPS`.
    order = tuple(GROUPS) + tuple(
        sorted({s.group for s in specs} - set(GROUPS))
    )
    groups = {
        g: tuple(s for s in used if by_id[s].group == g) for g in order
    }
    return PanelBuild(
        as_of=str(when.date()),
        frame=frame,
        levels=level_frame,
        used=used,
        dropped=dropped,
        edge=edge,
        months_behind=int(months_behind),
        groups={g: v for g, v in groups.items() if v},
        frame_q=frame_q,
        levels_q=level_frame_q,
    )
