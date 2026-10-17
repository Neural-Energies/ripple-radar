"""Fixed rules for the tactical futures book.

Every number in this file was chosen before the 2023–2026 window was
scored. Nothing here is a search result. Citations are the papers the
rule is taken from; the plain-English writeup is docs/TACTICAL-MODELS.md.
"""
from __future__ import annotations

from dataclasses import dataclass


TRAIN_START = "2015-01-01"
TRAIN_END = "2022-12-31"
TEST_START = "2023-01-01"

# Moskowitz, Ooi, Pedersen (2012) look at 1, 3, 6 and 12 month signs.
MOM_LOOKBACKS = (21, 63, 126, 252)
# Asness, Moskowitz, Pedersen (2013): futures value is the five-year reversal.
VALUE_LOOKBACK = 252 * 5
# One trading month of realized volatility. Moreira and Muir (2017) use the
# previous month's realized variance to size the book.
VOL_WINDOW = 21
ANNUALIZATION = 252

# Regime cutoff is the 80th percentile of trailing realized vol, and the
# "quiet" side of the vol factor is below the median. The filter needs two
# years of month-end readings before it is allowed to speak.
REGIME_HIGH_Q = 0.80
REGIME_LOW_Q = 0.50
MIN_REGIME_OBS = 24

# On a scheduled roll session, futures-minus-cash returns inside this band
# are treated as the contract splice and removed. Anything larger is left in
# the P&L: a gap that big is a basis event, not a normal quarterly roll.
ROLL_CLIP = 0.02

# Equal-weight score at or beyond one-half (two of four factors, or a
# stronger majority) is a full one-lot. Inside the band the book is flat.
COMPOSITE_LOT_THRESHOLD = 0.5

# Dollar-volatility budget for one asset when the signal is at full strength.
# Inverse-vol weights with a common dollar budget are the equal-risk book
# (Maillard, Roncalli, Teiletche 2010, under the equal-correlation case).
VOL_BUDGET = 40_000.0
# Hard cap so a quiet tape cannot scale a signal into a large position.
# A risk limit, set before any results, not a fit.
MAX_CONTRACTS = 4

# Commission is a retail all-in above many discount FCMs, so the drag is
# slightly heavy rather than flattering. Slippage is one tick per side on the
# equity indexes and two ticks per side on gold and crude.
COMMISSION_PER_SIDE = 2.50

# Macro-surprise and news overlay. Fixed before the 2023–2026 overlay P&L
# was scored. The factor rules above are not retuned.
# Consensus for CPI and payrolls is the median of the previous 36 first
# releases. There is no free survey history, so this is a proxy.
SURPRISE_MEDIAN = 36
# Z-scores need two years of train-window surprises before they speak.
# The mean and standard deviation then freeze at the train-window close.
SURPRISE_MIN_Z = 24
# Smaller than this, the release is "in line" and the macro book abstains.
Z_ABSTAIN = 0.5
# At or above this, a surprise may flatten or replace the core position.
Z_OVERRIDE = 1.0
# Growth and inflation state: trailing median of the point-in-time 12-month
# change. Sixty months is five years. Fewer than that and the state is unknown.
REGIME_TRAIL = 60
# News filter: lagged monthly news-based EPU above its train-window 80th
# percentile flattens NQ and ES. It does not open a short.
EPU_HIGH_Q = 0.80
NEWS_ASSETS = ("NQ", "ES")
# The core the overlays sit on. Not chosen by searching the test window;
# it is the one-lot volatility-filtered trend from the factor book.
CORE_MODEL = "vol_filter_tsmom"


@dataclass(frozen=True)
class Contract:
    symbol: str
    name: str
    yahoo: str
    multiplier: float
    tick_size: float
    tick_value: float
    slippage_ticks: int
    # Cash series used to see the roll splice. None when the free history has
    # no separate cash market (crude: the usual "spot" series is the prompt).
    proxy: str | None
    roll: str

    @property
    def cost_per_side(self) -> float:
        return COMMISSION_PER_SIDE + self.slippage_ticks * self.tick_value


CONTRACTS: dict[str, Contract] = {
    "NQ": Contract("NQ", "E-mini Nasdaq-100", "NQ=F", 20.0, 0.25, 5.0, 1, "NDX", "quarterly"),
    "ES": Contract("ES", "E-mini S&P 500", "ES=F", 50.0, 0.25, 12.50, 1, "SPX", "quarterly"),
    "GC": Contract("GC", "COMEX gold, 100 oz", "GC=F", 100.0, 0.10, 10.0, 2, "GLD", "bimonthly"),
    "CL": Contract("CL", "NYMEX WTI, 1,000 bbl", "CL=F", 1000.0, 0.01, 10.0, 2, None, "monthly"),
}

PROXIES = {
    "SPX": "^GSPC",
    "NDX": "^NDX",
    "GLD": "GLD",
}

# Order is the order results are reported in.
MODELS: tuple[str, ...] = (
    "buy_hold",
    "buy_hold_vol_target",
    "tsmom_12",
    "tsmom_12_vol",
    "tsmom_multi",
    "carry",
    "value",
    "vol_filter_tsmom",
    "composite_1lot",
    "composite_vol_target",
)

MODEL_SUMMARY: dict[str, str] = {
    "buy_hold": "Always long one contract. The baseline a signal has to beat.",
    "buy_hold_vol_target": "Always long, sized to the dollar-vol budget. Shows what sizing alone does.",
    "tsmom_12": "Long or short one contract with the sign of the past-year return.",
    "tsmom_12_vol": "Same 12-month sign, sized to the dollar-vol budget. The Moskowitz, Ooi and Pedersen specification.",
    "tsmom_multi": "Sign of the average of the 1, 3, 6 and 12 month signs. One contract.",
    "carry": "Long when the contract is cheap to cash (or, for gold, when the 10-year real yield is negative). One contract.",
    "value": "Long when the contract is below its price of five years ago. One contract.",
    "vol_filter_tsmom": "The multi-horizon sign, flattened when recent volatility is above its training-era high line.",
    "composite_1lot": "Equal-weight vote of momentum, carry, value and volatility. One contract when the vote is decisive.",
    "composite_vol_target": "The same vote, sized so each market risks the same dollar volatility. The cross-asset book.",
}

CITATIONS: tuple[dict[str, str], ...] = (
    {
        "id": "mop2012",
        "short": "Moskowitz, Ooi and Pedersen (2012)",
        "cite": "Moskowitz, Tobias J., Yao Hua Ooi, and Lasse Heje Pedersen. \"Time Series Momentum.\" Journal of Financial Economics 104, no. 2 (2012): 228–250.",
        "used_for": "12-month sign, the average of 1/3/6/12 month signs, and sign times target-vol over forecast-vol.",
    },
    {
        "id": "amp2013",
        "short": "Asness, Moskowitz and Pedersen (2013)",
        "cite": "Asness, Clifford S., Tobias J. Moskowitz, and Lasse Heje Pedersen. \"Value and Momentum Everywhere.\" Journal of Finance 68, no. 3 (2013): 929–985.",
        "used_for": "Futures value as the sign of the negative five-year return.",
    },
    {
        "id": "kmpv2018",
        "short": "Koijen, Moskowitz, Pedersen and Vrugt (2018)",
        "cite": "Koijen, Ralph S. J., Tobias J. Moskowitz, Lasse Heje Pedersen, and Evert B. Vrugt. \"Carry.\" Journal of Financial Economics 127, no. 1 (2018): 197–225.",
        "used_for": "Carry as the sign of the futures basis versus cash. Gold uses a real-yield proxy because the deferred contract is not in the free history.",
    },
    {
        "id": "eh2013",
        "short": "Erb and Harvey (2013)",
        "cite": "Erb, Claude B., and Campbell R. Harvey. \"The Golden Dilemma.\" Financial Analysts Journal 69, no. 4 (2013): 10–42.",
        "used_for": "Gold's opportunity cost tracked with the 10-year real Treasury yield. Long gold when that yield is negative.",
    },
    {
        "id": "mm2017",
        "short": "Moreira and Muir (2017)",
        "cite": "Moreira, Alan, and Tyler Muir. \"Volatility-Managed Portfolios.\" Journal of Finance 72, no. 4 (2017): 1611–1644.",
        "used_for": "Scale exposure by the inverse of recent realized volatility. The regime filter is the coarse version: flat above the training-era 80th percentile.",
    },
    {
        "id": "bsc2015",
        "short": "Barroso and Santa-Clara (2015)",
        "cite": "Barroso, Pedro, and Pedro Santa-Clara. \"Momentum Has Its Moments.\" Journal of Financial Economics 116, no. 1 (2015): 111–120.",
        "used_for": "Why the momentum sleeve is cut in a high-volatility state. The paper scales by the volatility of the momentum strategy; the filter here is the simpler on/off rule.",
    },
    {
        "id": "mrt2010",
        "short": "Maillard, Roncalli and Teiletche (2010)",
        "cite": "Maillard, Sébastien, Thierry Roncalli, and Jérôme Teiletche. \"The Properties of Equally Weighted Risk Contribution Portfolios.\" Journal of Portfolio Management 36, no. 4 (2010): 60–70.",
        "used_for": "Equal risk contribution. With a common correlation assumption this is inverse-volatility weighting, applied here as an equal dollar-vol budget per market.",
    },
    {
        "id": "kuttner2001",
        "short": "Kuttner (2001)",
        "cite": "Kuttner, Kenneth N. \"Monetary Policy Surprises and Interest Rates: Evidence from the Fed Funds Futures Market.\" Journal of Monetary Economics 47, no. 3 (2001): 523–544.",
        "used_for": "The FOMC surprise is the change in the front 30-day fed-funds future on the statement day. A free Reuters poll of the decision does not exist for the full sample.",
    },
    {
        "id": "bhj2005",
        "short": "Boyd, Hu and Jagannathan (2005)",
        "cite": "Boyd, John H., Jian Hu, and Ravi Jagannathan. \"The Stock Market's Reaction to Unemployment News: Why Bad News Is Usually Good for Stocks.\" Journal of Finance 60, no. 2 (2005): 649–672.",
        "used_for": "The payroll surprise flips sign with the growth state. In an expansion a strong print is a short in the equity indexes; in a contraction it is a long.",
    },
    {
        "id": "bbd2016",
        "short": "Baker, Bloom and Davis (2016)",
        "cite": "Baker, Scott R., Nicholas Bloom, and Steven J. Davis. \"Measuring Economic Policy Uncertainty.\" Quarterly Journal of Economics 131, no. 4 (2016): 1593–1636.",
        "used_for": "The news layer is their daily news-based Economic Policy Uncertainty index, lagged one month, used only to flatten equity-index futures.",
    },
)
