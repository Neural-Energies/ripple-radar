"""The target macro universe: economic CONCEPTS, and the series that could serve them.

The brief names twenty economic families and asks for "essentially all
economically useful national-level data". This module is that target, written
down so coverage can be measured against something explicit instead of against
an impression of completeness.

WHY CONCEPTS AND NOT SERIES IDS

A gap list of series IDs answers the wrong question. "We are missing
CUSR0000SEHC" is a fact about FRED's naming; "we have no measure of owners'
equivalent rent, which is a third of core CPI" is a fact about the economy. So
each entry here is a CONCEPT with an ordered list of candidate series that could
serve it, and a family is covered when its concepts are covered — by whichever
candidate turns out to exist and to have the history.

The ordering inside `candidates` is a preference, not a fallback chain: the
first entry is the series a macroeconomist would reach for, and the later ones
are acceptable substitutes. `ace.universe.probe` decides which are actually
reachable, and records the ones that are not.

WHAT THIS MODULE DELIBERATELY DOES NOT DO

It does not decide which concepts belong in which factor. That is the whole
point of the brief — the data determines the factor structure, and a concept's
`family` here is a bookkeeping label for coverage accounting, not a block
assignment for a factor model. `ace.factors.panels` builds the modelling views,
and it is allowed to disagree with these labels.

It also does not assume every concept SHOULD be in a factor model.
`factor_eligible=False` marks a concept that belongs in the registry for
context, attribution or interpretation but not as a factor input — a
slow-moving demographic aggregate, say, which would load on nothing and
contribute a near-constant column.
"""
from __future__ import annotations

from dataclasses import dataclass, field

#: The families the brief names, in its order. The numbering is the brief's.
FAMILIES: tuple[str, ...] = (
    "output_activity",          # 1
    "inflation",                # 2
    "labor",                    # 3
    "consumer",                 # 4
    "housing",                  # 5
    "manufacturing",            # 6
    "credit",                   # 7
    "financial_conditions",     # 8
    "liquidity_money",          # 9
    "banking",                  # 10
    "fiscal",                   # 11
    "trade_external",           # 12
    "commodities",              # 13
    "energy",                   # 14
    "business_investment",      # 15
    "corporate_profits",        # 16
    "productivity",             # 17
    "demographics",             # 18
    "surveys_expectations",     # 19
    "market_expectations",      # 20
)

#: Which of the brief's DATA LAYERS a concept belongs to. Kept separate from
#: `family` because the two cut across each other: CPI and the ISM new-orders
#: index are both inflation-relevant, and one is a realised government
#: statistic while the other is a diffusion index built from a survey. A factor
#: model that mixes them without being able to separate them again cannot answer
#: "is this the economy or is this sentiment".
LAYERS: tuple[str, ...] = ("hard", "soft", "market", "derived")


@dataclass(frozen=True)
class Concept:
    """One economic quantity, and the series that could measure it."""

    concept: str
    family: str
    sub_family: str
    #: Candidate series, best first. Availability is measured, not assumed.
    candidates: tuple[str, ...]
    #: FRED-MD transform code. See `ace.state.transforms`. A hint for the
    #: registry, which may override it once the series' units are known.
    code: int
    #: Which data layer this belongs to, for the panel views.
    layer: str = "hard"
    #: Does using the revised series instead of the first release risk
    #: lookahead? False for a market quote, True for a statistical release.
    vintage_matters: bool = True
    #: Should this be offered to a factor model at all?
    factor_eligible: bool = True
    source: str = "FRED"
    note: str = ""

    def __post_init__(self) -> None:
        if self.family not in FAMILIES:
            raise ValueError(f"{self.concept}: unknown family {self.family!r}")
        if self.layer not in LAYERS:
            raise ValueError(f"{self.concept}: unknown layer {self.layer!r}")
        if not self.candidates:
            raise ValueError(f"{self.concept}: no candidate series")


def _c(concept, family, sub, candidates, code, **kw) -> Concept:
    """Shorthand, because there are several hundred of these."""
    return Concept(
        concept=concept, family=family, sub_family=sub,
        candidates=tuple(candidates.split()) if isinstance(candidates, str) else tuple(candidates),
        code=code, **kw,
    )


# ---------------------------------------------------------------------------
# 1. OUTPUT / ECONOMIC ACTIVITY
# ---------------------------------------------------------------------------
OUTPUT: tuple[Concept, ...] = (
    _c("real GDP", "output_activity", "national accounts", "GDPC1", 5),
    _c("nominal GDP", "output_activity", "national accounts", "GDP", 5),
    _c("nominal gross domestic income", "output_activity", "national accounts",
       "GDI", 5,
       note="The income-side estimate of nominal GDP. The GDP-GDI gap is "
            "itself a measurement-error signal, so both are worth carrying."),
    _c("real gross domestic income", "output_activity", "national accounts",
       "A261RX1Q020SBEA", 5,
       note="Kept separate from nominal GDI rather than listed as a substitute "
            "for it. A deflated series and its nominal twin are different "
            "quantities, and the redundancy detector flagged the original "
            "single-concept version of this entry on its first run."),
    _c("government consumption expenditures (all levels)", "output_activity",
       "national accounts", "GCE", 5,
       note="All levels of government (federal + state + local) — the G in "
            "GDP's C+I+G+NX. Distinct from the fiscal family's federal-only "
            "FGCE, which measures federal budget policy specifically."),
    _c("real final sales", "output_activity", "national accounts", "FINSLC1", 5,
       note="GDP less inventory change — demand without the restocking cycle."),
    _c("industrial production", "output_activity", "production", "INDPRO", 5),
    _c("IP: final products", "output_activity", "production", "IPFINAL", 5),
    _c("IP: consumer goods", "output_activity", "production", "IPCONGD", 5),
    _c("IP: business equipment", "output_activity", "production", "IPBUSEQ", 5),
    _c("IP: materials", "output_activity", "production", "IPMAT", 5),
    _c("IP: manufacturing", "output_activity", "production", "IPMANSICS IPMAN", 5,
       note="SIC-basis (IPMANSICS) runs back to 1919; NAICS-basis (IPMAN) "
            "is the current classification standard but only starts 1972. "
            "Same concept, two classification eras."),
    _c("capacity utilization", "output_activity", "production", "TCU", 2),
    _c("capacity utilization: manufacturing", "output_activity", "production", "MCUMFN", 2),
    _c("business inventories", "output_activity", "inventories", "BUSINV", 5),
    _c("inventory/sales ratio", "output_activity", "inventories", "ISRATIO", 2),
    _c("wholesale inventories", "output_activity", "inventories", "WHLSLRIMSA", 5),
    _c("retail inventories", "output_activity", "inventories", "RETAILIRSA", 2,
       note="Retail inventory/sales. The channel a demand miss shows up in first."),
    _c("freight activity", "output_activity", "transport", "FRGSHPUSM649NCIS TSIFRGHT", 5,
       note="Cass/BTS freight shipments. A physical-volume cross-check on the "
            "survey-based activity measures."),
    _c("rail carloads", "output_activity", "transport", "RAILFRTCARLOADSD11", 5,
       factor_eligible=False,
       note="Weekly and noisy, and its secular decline is a modal-shift story "
            "rather than a cycle. Registry context, not a factor input."),
)

# ---------------------------------------------------------------------------
# 2. INFLATION — the brief is explicit that this must not reduce to CPI
# ---------------------------------------------------------------------------
INFLATION: tuple[Concept, ...] = (
    _c("CPI headline", "inflation", "CPI", "CPIAUCSL", 6),
    _c("CPI core", "inflation", "CPI", "CPILFESL", 6),
    _c("CPI services", "inflation", "CPI", "CUSR0000SAS", 6),
    _c("CPI commodities", "inflation", "CPI", "CUSR0000SAC", 6),
    _c("CPI shelter", "inflation", "CPI components", "CUSR0000SAH1", 6,
       note="A third of core CPI on its own, and the slowest-moving third."),
    _c("CPI rent of primary residence", "inflation", "CPI components", "CUSR0000SEHA", 6),
    _c("CPI owners' equivalent rent", "inflation", "CPI components", "CUSR0000SEHC", 6,
       note="Imputed, not transacted, and it lags market rents by roughly a "
            "year — which is why it has to be separable from the rest."),
    _c("CPI transportation", "inflation", "CPI components", "CPITRNSL", 6),
    _c("CPI medical care", "inflation", "CPI components", "CPIMEDSL", 6),
    _c("CPI food", "inflation", "CPI components", "CPIUFDSL", 6),
    _c("CPI energy", "inflation", "CPI components", "CPIENGSL", 6),
    _c("CPI used vehicles", "inflation", "CPI components", "CUSR0000SETA02", 6),
    _c("CPI new vehicles", "inflation", "CPI components", "CUSR0000SETA01", 6),
    _c("CPI apparel", "inflation", "CPI components", "CPIAPPSL", 6),
    _c("CPI recreation", "inflation", "CPI components", "CPIRECSL", 6),
    _c("CPI education and communication", "inflation", "CPI components", "CPIEDUSL", 6),
    _c("PCE price index", "inflation", "PCE", "PCEPI", 6),
    _c("core PCE", "inflation", "PCE", "PCEPILFE", 6,
       note="The number the FOMC statement refers to."),
    _c("PCE goods prices", "inflation", "PCE", "DGDSRG3M086SBEA", 6),
    _c("PCE services prices", "inflation", "PCE", "DSERRG3M086SBEA", 6),
    _c("PCE housing services prices", "inflation", "PCE", "DHUTRG3Q086SBEA", 6,
       note="Quarterly only — no monthly cut of this component exists on "
            "FRED."),
    _c("market-based core PCE", "inflation", "PCE", "DPCXRG3M086SBEA", 6,
       note="Excludes imputed prices. If it diverges from core PCE the "
            "difference is measurement convention, not inflation."),
    _c("PPI final demand", "inflation", "PPI", "PPIFIS", 6),
    _c("PPI final demand ex food and energy", "inflation", "PPI", "PPIFES WPSFD4131", 6,
       note="BLS retired the 'finished goods' PPI methodology for 'final "
            "demand' in 2014; WPSFD4131 is the older finished-goods cut "
            "with deeper history, PPIFES the current final-demand one."),
    _c("PPI all commodities", "inflation", "PPI", "PPIACO", 6),
    _c("PPI intermediate demand", "inflation", "PPI", "WPUID61 PPIITM", 6,
       note="PPIITM stopped updating in 2015 (BLS moved to the WPUID6x "
            "family); WPUID61 is the current series and listed first."),
    _c("PPI finished consumer goods", "inflation", "PPI", "WPSFD49207", 6),
    _c("import prices", "inflation", "external prices", "IR", 6,
       note="The tariff and dollar channel into goods inflation."),
    _c("export prices", "inflation", "external prices", "IQ", 6),
    _c("unit labor costs", "inflation", "costs", "ULCNFB", 6,
       note="Compensation per unit of output — the wage channel net of "
            "productivity, which average hourly earnings alone cannot give."),
    _c("trimmed mean PCE", "inflation", "robust measures", "PCETRIM12M159SFRBDAL", 2,
       note="Already an annualised rate, so differenced rather than "
            "double-log-differenced."),
    _c("median CPI", "inflation", "robust measures", "MEDCPIM158SFRBCLE", 2),
    _c("sticky-price CPI", "inflation", "robust measures", "CORESTICKM159SFRBATL", 2,
       note="Restricted to slow-repricing components, so it is closer to the "
            "persistent part than core is."),
    _c("average hourly earnings", "inflation", "wages", "CES0500000003", 6),
    _c("employment cost index: wages", "inflation", "wages", "ECIWAG", 6,
       note="Holds job mix fixed, so it does not move when the composition of "
            "employment shifts. Quarterly."),
    _c("1-year inflation expectations (survey)", "inflation", "expectations",
       "MICH", 2, layer="soft",
       note="University of Michigan household expectations. A survey, kept in "
            "the soft layer so it never silently substitutes for a price."),
)

# ---------------------------------------------------------------------------
# 3. LABOR
# ---------------------------------------------------------------------------
LABOR: tuple[Concept, ...] = (
    _c("nonfarm payrolls", "labor", "establishment", "PAYEMS", 5),
    _c("private payrolls", "labor", "establishment", "USPRIV", 5),
    _c("government payrolls", "labor", "establishment", "USGOVT", 5),
    _c("manufacturing employment", "labor", "establishment", "MANEMP", 5),
    _c("construction employment", "labor", "establishment", "USCONS", 5),
    _c("retail trade employment", "labor", "establishment", "USTRADE", 5),
    _c("service-providing employment", "labor", "establishment", "SRVPRD", 5),
    _c("temporary help employment", "labor", "establishment", "TEMPHELPS", 5,
       note="The first margin employers cut, so it leads the headline."),
    _c("unemployment rate", "labor", "household", "UNRATE", 2),
    _c("U-6 underemployment", "labor", "household", "U6RATE", 2),
    _c("labor force participation", "labor", "household", "CIVPART", 2),
    _c("employment-population ratio", "labor", "household", "EMRATIO", 2,
       note="Free of the participation denominator, so it cannot improve "
            "because people stopped looking."),
    _c("household employment", "labor", "household", "CE16OV", 5,
       note="The other employment survey. A persistent payrolls/household gap "
            "is a measurement signal in its own right."),
    _c("labor force", "labor", "household", "CLF16OV", 5),
    _c("mean duration unemployed", "labor", "household", "UEMPMEAN", 2),
    _c("multiple jobholders", "labor", "household", "LNS12026620", 5, factor_eligible=False,
       note="Thin and noisy monthly; registry context."),
    _c("initial claims", "labor", "claims", "ICSA", 5,
       note="The highest-frequency labour read there is, five days behind."),
    _c("continuing claims", "labor", "claims", "CCSA", 5),
    _c("insured unemployment rate", "labor", "claims", "IURSA", 2),
    _c("JOLTS job openings", "labor", "JOLTS", "JTSJOL", 5),
    _c("JOLTS hires", "labor", "JOLTS", "JTSHIR", 5),
    _c("JOLTS quits rate", "labor", "JOLTS", "JTSQUR", 2),
    _c("JOLTS layoffs rate", "labor", "JOLTS", "JTSLDR", 2),
    _c("average weekly hours", "labor", "hours", "AWHAETP", 1),
    _c("manufacturing weekly hours", "labor", "hours", "AWHMAN", 1),
    _c("manufacturing overtime hours", "labor", "hours", "AWOTMAN", 2),
    _c("average weekly earnings", "labor", "earnings", "CES0500000011", 5),
)

# ---------------------------------------------------------------------------
# 4. CONSUMER
# ---------------------------------------------------------------------------
CONSUMER: tuple[Concept, ...] = (
    _c("retail sales", "consumer", "spending", "RSAFS", 5),
    _c("real retail sales", "consumer", "spending", "RRSFS", 5),
    _c("retail control group", "consumer", "spending", "RSFSXMV", 5,
       note="Ex autos, gas and building materials — the slice that maps into "
            "the GDP consumption estimate."),
    _c("personal consumption", "consumer", "spending", "PCE", 5),
    _c("real personal consumption", "consumer", "spending", "PCEC96", 5),
    _c("vehicle sales", "consumer", "spending", "TOTALSA", 5,
       note="The big-ticket, credit-financed end, where a rate shock lands first."),
    _c("personal income", "consumer", "income", "PI", 5),
    _c("real personal income", "consumer", "income", "RPI", 5),
    _c("disposable income", "consumer", "income", "DSPI", 5),
    _c("real disposable income", "consumer", "income", "DSPIC96", 5),
    _c("real income ex transfers", "consumer", "income", "W875RX1", 5,
       note="Earned income only — the cut the NBER dating committee watches."),
    _c("personal saving rate", "consumer", "income", "PSAVERT", 2),
    _c("household debt service ratio", "consumer", "balance sheet", "TDSP", 2,
       note="Debt payments as a share of disposable income — the affordability "
            "constraint that credit outstanding alone does not show."),
    _c("credit card delinquency rate", "consumer", "balance sheet", "DRCCLACBS", 2),
    _c("consumer sentiment", "consumer", "surveys", "UMCSENT", 2, layer="soft"),
    _c("consumer confidence", "consumer", "surveys", "CSCICP03USM665S", 2, layer="soft",
       note="OECD's US confidence indicator. The Conference Board series "
            "itself is not redistributable through FRED."),
)

# ---------------------------------------------------------------------------
# 5. HOUSING / REAL ESTATE
# ---------------------------------------------------------------------------
HOUSING: tuple[Concept, ...] = (
    _c("housing starts", "housing", "construction", "HOUST", 4),
    _c("housing starts: single family", "housing", "construction", "HOUST1F", 4),
    _c("building permits", "housing", "construction", "PERMIT", 4),
    _c("housing completions", "housing", "construction", "COMPUTSA", 4),
    _c("housing starts: Northeast", "housing", "construction regional", "HOUSTNE", 4),
    _c("housing starts: Midwest", "housing", "construction regional", "HOUSTMW", 4),
    _c("housing starts: South", "housing", "construction regional", "HOUSTS", 4),
    _c("housing starts: West", "housing", "construction regional", "HOUSTW", 4),
    _c("new home sales", "housing", "sales", "HSN1F", 4),
    _c("existing home sales", "housing", "sales", "EXHOSLUSM495S", 4,
       note="FRED holds a 13-month rolling window under NAR licensing, so "
            "there is no history to fetch. Recorded so the absence is "
            "attributable to the licence rather than to an oversight."),
    _c("months supply of new homes", "housing", "inventory", "MSACSR", 2),
    _c("new houses for sale", "housing", "inventory", "HNFSEPUSSA", 4),
    _c("Case-Shiller national home prices", "housing", "prices", "CSUSHPINSA", 6),
    _c("FHFA house price index", "housing", "prices", "USSTHPI", 6,
       note="Purchase-only and repeat-sales, quarterly. A second price "
            "measurement with different coverage from Case-Shiller."),
    _c("30-year mortgage rate", "housing", "finance", "MORTGAGE30US", 2),
    _c("15-year mortgage rate", "housing", "finance", "MORTGAGE15US", 2),
    _c("housing affordability", "housing", "finance", "FIXHAI", 2, factor_eligible=False,
       note="NAR composite; discontinued/licence-limited on FRED. Carried as "
            "a concept so the gap is visible."),
    _c("total construction spending", "housing", "investment", "TTLCONS", 5),
    _c("residential fixed investment", "housing", "investment", "PRFI", 5),
    _c("rental vacancy rate", "housing", "vacancy", "RRVRUSQ156N", 2),
    _c("homeowner vacancy rate", "housing", "vacancy", "RHVRUSQ156N", 2),
)

# ---------------------------------------------------------------------------
# 6. MANUFACTURING / BUSINESS CYCLE
# ---------------------------------------------------------------------------
MANUFACTURING: tuple[Concept, ...] = (
    _c("durable goods orders", "manufacturing", "orders", "DGORDER", 5),
    _c("total manufacturing new orders", "manufacturing", "orders", "AMTMNO", 5),
    _c("unfilled orders: durables", "manufacturing", "orders", "AMDMUO", 5),
    _c("core capital goods orders", "manufacturing", "orders", "NEWORDER", 5,
       note="Non-defence ex aircraft — the same signal with the two worst "
            "sources of noise removed."),
    _c("manufacturing shipments", "manufacturing", "shipments", "AMDMVS", 5),
    _c("Chicago Fed national activity index", "manufacturing", "composite", "CFNAI", 1,
       note="Already a standardised composite centred on zero, so level. "
            "Built from 85 indicators, which makes it a useful external check "
            "on whatever the global factor turns out to be."),
    _c("leading index", "manufacturing", "composite", "USSLIND", 1, layer="derived"),
    _c("Philadelphia Fed manufacturing survey", "manufacturing", "regional surveys",
       "GACDFSA066MSFRBPHI", 1, layer="soft"),
    _c("Dallas Fed manufacturing survey", "manufacturing", "regional surveys",
       "BACTSAMFRBDAL", 1, layer="soft",
       note="Dallas Fed calls its headline series general business "
            "activity, not manufacturing, unlike the other regional "
            "surveys here."),
    _c("Kansas City Fed manufacturing survey", "manufacturing", "regional surveys",
       "GACDFNA066MNFRBKC", 1, layer="soft", factor_eligible=False,
       note="Confirmed absent: FRED search returns no Kansas City Fed "
            "manufacturing series under any query tried. The Fed publishes "
            "it directly; not mirrored through FRED's API."),
    _c("Richmond Fed manufacturing survey", "manufacturing", "regional surveys",
       "RCMFNO", 1, layer="soft", factor_eligible=False,
       note="Confirmed absent from FRED under any query tried; same gap as "
            "the Kansas City survey."),
    _c("Empire State manufacturing survey", "manufacturing", "regional surveys",
       "GACDISA066MSFRBNY", 1, layer="soft",
       note="The New York Fed's series has moved on and off FRED. Probed "
            "rather than assumed."),
    _c("ISM manufacturing PMI", "manufacturing", "national surveys", "NAPM MANEMP", 1,
       layer="soft",
       note="ISM withdrew redistribution rights, so the FRED series ends in "
            "2020 or 404s. Kept as a concept because its ABSENCE is the "
            "reason the regional surveys are carried."),
)

# ---------------------------------------------------------------------------
# 7. CREDIT
# ---------------------------------------------------------------------------
CREDIT: tuple[Concept, ...] = (
    _c("high yield OAS", "credit", "spreads", "BAMLH0A0HYM2", 1, layer="market",
       vintage_matters=False,
       note="FRED's ICE BofA licence exposes a rolling window only — roughly "
            "three years, so it cannot anchor a long backtest."),
    _c("investment grade OAS", "credit", "spreads", "BAMLC0A0CM", 1, layer="market",
       vintage_matters=False),
    _c("BBB OAS", "credit", "spreads", "BAMLC0A4CBBB", 1, layer="market",
       vintage_matters=False),
    _c("Baa - 10y spread", "credit", "spreads", "BAA10Y", 1, layer="market",
       vintage_matters=False,
       note="Moody's, daily back to 1986 — the long credit-stress history the "
            "ICE series lacks."),
    _c("Aaa - 10y spread", "credit", "spreads", "AAA10Y", 1, layer="market",
       vintage_matters=False,
       note="Baa minus Aaa is the part of the spread that is default risk "
            "rather than duration."),
    _c("commercial paper spread", "credit", "funding", "RIFSPPFAAD90NB", 1,
       layer="market", vintage_matters=False),
    _c("commercial and industrial loans", "credit", "bank lending", "BUSLOANS", 6),
    _c("C&I loans (weekly)", "credit", "bank lending", "TOTCI", 6,
       note="Same concept nine days behind instead of six weeks. Both are "
            "carried: one has the history, the other has the edge."),
    _c("real estate loans", "credit", "bank lending", "REALLN", 6),
    _c("consumer loans", "credit", "bank lending", "CONSUMER", 6),
    _c("total consumer credit", "credit", "household credit", "TOTALSL", 6),
    _c("revolving consumer credit", "credit", "household credit", "REVOLSL", 6),
    _c("nonrevolving consumer credit", "credit", "household credit", "NONREVSL", 6),
    _c("loan officer survey: C&I tightening", "credit", "standards", "DRTSCILM", 1,
       layer="soft",
       note="The only direct read on credit SUPPLY. Quantities cannot "
            "distinguish nobody wanting to borrow from nobody being allowed to."),
    _c("loan officer survey: mortgage tightening", "credit", "standards",
       "DRTSRMT", 1, layer="soft", factor_eligible=False,
       note="No broad residential-mortgage tightening series on FRED; only "
            "narrow post-2015 cuts by loan type (DRTSSP for subprime, and "
            "GSE-eligible/QM/non-QM equivalents), none of which covers what "
            "this concept means. DRTSCILM (C&I tightening) carries the "
            "credit-supply signal for this panel instead."),
    _c("single-family mortgage delinquency", "credit", "performance", "DRSFRMACBS", 2),
    _c("commercial bank charge-off rate", "credit", "performance", "CORALACBS", 2),
    _c("business bankruptcy filings", "credit", "performance", "BUSFIL", 5,
       factor_eligible=False,
       note="Not on FRED under any query tried; the series would in any "
            "case be quarterly and statutorily distorted by the 2005 reform."),
)

# ---------------------------------------------------------------------------
# 8. FINANCIAL CONDITIONS
# ---------------------------------------------------------------------------
FINANCIAL: tuple[Concept, ...] = (
    _c("effective fed funds (monthly)", "financial_conditions", "policy", "FEDFUNDS", 2),
    _c("effective fed funds (daily)", "financial_conditions", "policy", "DFF", 2,
       layer="market", vintage_matters=False),
    _c("SOFR", "financial_conditions", "policy", "SOFR", 2, layer="market",
       vintage_matters=False,
       note="Starts 2018. The post-LIBOR funding benchmark."),
    _c("interest on reserve balances", "financial_conditions", "policy", "IORB IOER", 2,
       layer="market", vintage_matters=False,
       note="IOER stopped 2021-07-28, IORB started 2021-07-29 — a direct "
            "handoff when the Fed eliminated the required/excess reserve "
            "distinction, not two measurements of different things."),
    _c("3-month Treasury", "financial_conditions", "curve", "DGS3MO", 2, layer="market",
       vintage_matters=False),
    _c("2-year Treasury", "financial_conditions", "curve", "DGS2", 2, layer="market",
       vintage_matters=False),
    _c("5-year Treasury", "financial_conditions", "curve", "DGS5", 2, layer="market",
       vintage_matters=False),
    _c("10-year Treasury", "financial_conditions", "curve", "DGS10", 2, layer="market",
       vintage_matters=False),
    _c("30-year Treasury", "financial_conditions", "curve", "DGS30", 2, layer="market",
       vintage_matters=False),
    _c("10y-2y slope", "financial_conditions", "curve slopes", "T10Y2Y", 1,
       layer="market", vintage_matters=False),
    _c("10y-3m slope", "financial_conditions", "curve slopes", "T10Y3M", 1,
       layer="market", vintage_matters=False,
       note="The slope with the better recession record, because its front end "
            "is the policy rate rather than an expectation of it."),
    _c("10y TIPS real yield", "financial_conditions", "real rates", "DFII10", 2,
       layer="market", vintage_matters=False),
    _c("5y TIPS real yield", "financial_conditions", "real rates", "DFII5", 2,
       layer="market", vintage_matters=False),
    _c("30y TIPS real yield", "financial_conditions", "real rates", "DFII30", 2,
       layer="market", vintage_matters=False),
    _c("VIX", "financial_conditions", "volatility", "VIXCLS", 1, layer="market",
       vintage_matters=False),
    _c("Nasdaq implied volatility", "financial_conditions", "volatility", "VXNCLS", 1,
       layer="market", vintage_matters=False),
    _c("Chicago Fed national financial conditions", "financial_conditions",
       "composites", "NFCI", 1, layer="derived",
       note="105 indicators on one zero-centred scale. Its vintage archive "
            "begins 2011-05 whatever start is requested."),
    _c("adjusted NFCI", "financial_conditions", "composites", "ANFCI", 1, layer="derived",
       note="NFCI with the part explained by the real economy projected out."),
    _c("St Louis financial stress", "financial_conditions", "composites", "STLFSI4", 1,
       layer="derived"),
    _c("broad dollar index", "financial_conditions", "dollar", "DTWEXBGS", 5,
       layer="market",
       note="A CONSTRUCTED index, not a quote: the H.10 basket weights are "
            "re-estimated annually and applied backwards, so it disagrees with "
            "its own archive on 91% of days. It needs the vintage route."),
    _c("S&P 500", "financial_conditions", "equity", "SP500", 5, layer="market",
       vintage_matters=False,
       note="FRED serves a rolling ten-year window, so this cannot carry a "
            "long backtest."),
    _c("Wilshire 5000", "financial_conditions", "equity", "WILL5000INDFC", 5,
       layer="market", vintage_matters=False, factor_eligible=False,
       note="Confirmed absent from FRED under any query tried; may have "
            "been discontinued. S&P 500 is the equity level actually in "
            "the panel."),
)

# ---------------------------------------------------------------------------
# 9. LIQUIDITY / MONEY
# ---------------------------------------------------------------------------
LIQUIDITY: tuple[Concept, ...] = (
    _c("M1", "liquidity_money", "aggregates", "M1SL", 6,
       note="The 2020 definitional change makes the level incomparable across "
            "that break; the second log difference survives it."),
    _c("M2", "liquidity_money", "aggregates", "M2SL", 6),
    _c("real M2", "liquidity_money", "aggregates", "M2REAL", 5),
    _c("monetary base", "liquidity_money", "aggregates", "BOGMBASE", 6),
    _c("total reserves", "liquidity_money", "reserves", "TOTRESNS", 6),
    _c("reserve balances at the Fed", "liquidity_money", "reserves", "WRESBAL", 5,
       note="The quantity balance-sheet policy operates on directly, weekly."),
    _c("Fed total assets", "liquidity_money", "central bank", "WALCL", 1),
    _c("Treasury general account", "liquidity_money", "central bank", "WTREGEN", 1,
       note="Moves reserves around without any policy decision, which is why "
            "it belongs beside WALCL rather than inside a reading of it."),
    _c("overnight reverse repo", "liquidity_money", "central bank", "RRPONTSYD", 1,
       layer="market", vintage_matters=False,
       note="The drain that stood between the balance sheet and reserves "
            "through 2022-2024."),
    _c("commercial bank deposits", "liquidity_money", "banking system",
       "DPSACBW027SBOG", 5),
)

# ---------------------------------------------------------------------------
# 10. BANKING
# ---------------------------------------------------------------------------
BANKING: tuple[Concept, ...] = (
    _c("total bank credit", "banking", "assets", "TOTBKCR", 5),
    _c("bank total assets", "banking", "assets", "TLAACBW027SBOG", 5),
    _c("bank securities holdings", "banking", "assets", "USGSEC", 5),
    _c("commercial real estate loans", "banking", "lending", "CREACBM027NBOG", 6),
    _c("net interest margin", "banking", "profitability", "USNIM", 2,
       factor_eligible=False, note="Quarterly and thin; interpretation context."),
)

# ---------------------------------------------------------------------------
# 11. GOVERNMENT / FISCAL
# ---------------------------------------------------------------------------
FISCAL: tuple[Concept, ...] = (
    _c("federal receipts", "fiscal", "flows", "FGRECPT", 5,
       note="'Current receipts' (all receipts: taxes, fees, transfers "
            "from business). W006RC1Q027SBEA (tax receipts only) is "
            "narrower scope, not offered as a substitute."),
    _c("federal expenditures", "fiscal", "flows", "FGEXPND", 5,
       note="'Current expenditures'. W019RCQ027SBEA ('total' "
            "expenditures) may include capital outlays FGEXPND excludes; "
            "not offered as a substitute without confirming the scope."),
    _c("federal surplus/deficit", "fiscal", "flows", "MTSDS133FMS FYFSD", 1,
       note="A level in dollars that crosses zero, so it cannot be logged."),
    _c("federal consumption expenditures and investment", "fiscal",
       "national accounts", "FGCE", 5,
       note="Federal only. GCE (all levels of government) is a different, "
            "broader quantity — carried separately under output_activity, "
            "since it is literally the G in GDP's C+I+G+NX."),
    _c("federal debt held by the public", "fiscal", "stocks", "FYGFDPUN", 5,
       note="Excludes intragovernmental holdings (e.g. the Social "
            "Security trust fund). GFDEBTN (gross federal debt) is a "
            "different, larger quantity — carried as its own concept."),
    _c("federal debt, gross", "fiscal", "stocks", "GFDEBTN", 5,
       note="Includes intragovernmental holdings; the debt-ceiling "
            "quantity, distinct from debt held by the public."),
    _c("federal interest outlays", "fiscal", "debt service", "A091RC1Q027SBEA", 5),
    _c("government employment", "fiscal", "employment", "USGOVT", 5),
)

# ---------------------------------------------------------------------------
# 12. TRADE / EXTERNAL
# ---------------------------------------------------------------------------
TRADE: tuple[Concept, ...] = (
    _c("exports of goods and services", "trade_external", "flows", "EXPGS", 5),
    _c("imports of goods and services", "trade_external", "flows", "IMPGS", 5),
    _c("real exports", "trade_external", "flows", "EXPGSC1", 5),
    _c("real imports", "trade_external", "flows", "IMPGSC1", 5),
    _c("trade balance", "trade_external", "balance", "BOPGSTB", 1,
       note="Crosses zero by construction, so level."),
    _c("goods exports", "trade_external", "composition", "BOPGEXP", 5),
    _c("goods imports", "trade_external", "composition", "BOPGIMP", 5),
    _c("services exports", "trade_external", "composition", "BOPSEXP", 5),
    _c("services imports", "trade_external", "composition", "BOPSIMP", 5),
    _c("current account balance", "trade_external", "balance", "IEABC", 1),
    _c("net international investment position", "trade_external", "balance",
       "IIPUSNETIQ", 1, factor_eligible=False,
       note="A stock, not a flow, and quarterly. Registry context for the "
            "external sector rather than a factor input."),
    _c("EUR/USD", "trade_external", "FX", "DEXUSEU", 5, layer="market",
       vintage_matters=False),
    _c("USD/JPY", "trade_external", "FX", "DEXJPUS", 5, layer="market",
       vintage_matters=False),
    _c("USD/CNY", "trade_external", "FX", "DEXCHUS", 5, layer="market",
       vintage_matters=False),
)

# ---------------------------------------------------------------------------
# 13. COMMODITIES / INPUT COSTS
# ---------------------------------------------------------------------------
COMMODITIES: tuple[Concept, ...] = (
    _c("WTI crude", "commodities", "energy prices", "DCOILWTICO", 5, layer="market",
       vintage_matters=False),
    _c("Brent crude", "commodities", "energy prices", "DCOILBRENTEU", 5,
       layer="market", vintage_matters=False),
    _c("retail gasoline", "commodities", "energy prices", "GASREGW", 5, layer="market",
       vintage_matters=False),
    _c("Henry Hub natural gas", "commodities", "energy prices", "DHHNGSP", 5,
       layer="market", vintage_matters=False),
    _c("copper", "commodities", "industrial metals", "PCOPPUSDM", 5, layer="market",
       vintage_matters=False,
       note="The classic industrial-demand proxy; monthly on FRED."),
    _c("gold", "commodities", "precious metals", "GOLDPMGBD228NLBM", 5,
       layer="market", vintage_matters=False, factor_eligible=False,
       note="The LBMA daily fixing FRED used to carry is gone; FRED search "
            "returns nothing under 'gold price'. IQ12260 (Export Price Index: "
            "Nonmonetary Gold) exists but is a trade-price concept, not a spot "
            "quote, so it is not offered as a substitute here."),
    _c("all-commodity price index", "commodities", "broad", "PALLFNFINDEXM", 5,
       layer="market", vintage_matters=False),
    _c("industrial inputs price index", "commodities", "broad", "PINDUINDEXM", 5,
       layer="market", vintage_matters=False),
    _c("agricultural raw materials index", "commodities", "agriculture",
       "PRAWMINDEXM", 5, layer="market", vintage_matters=False),
    _c("global supply chain pressure", "commodities", "freight", "GSCPI", 1,
       layer="derived", factor_eligible=False,
       note="New York Fed index. Not served by FRED; recorded so the gap is "
            "attributable to the source rather than to the audit."),
)

# ---------------------------------------------------------------------------
# 14. ENERGY (EIA, largely served through FRED)
# ---------------------------------------------------------------------------
ENERGY: tuple[Concept, ...] = (
    _c("crude oil production", "energy", "supply", "WCRFPUS2", 5, source="EIA",
       factor_eligible=False,
       note="EIA weekly/monthly production series are not mirrored on "
            "FRED; they require EIA's own API and a separate key. Out of "
            "scope for this pass — recorded as a known gap, not silently "
            "dropped."),
    _c("crude oil stocks", "energy", "inventories", "WCESTUS1", 5, source="EIA",
       factor_eligible=False, note="Same EIA-API gap as crude production."),
    _c("gasoline stocks", "energy", "inventories", "WGTSTUS1", 5, source="EIA",
       factor_eligible=False, note="Same EIA-API gap as crude production."),
    _c("distillate stocks", "energy", "inventories", "WDISTUS1", 5, source="EIA",
       factor_eligible=False, note="Same EIA-API gap as crude production."),
    _c("refinery utilization", "energy", "capacity", "WPULEUS3", 2, source="EIA",
       factor_eligible=False,
       note="The utilization rate itself is EIA-API only. IPG32411S "
            "(Industrial Production: petroleum refining) is a volume proxy "
            "on FRED and is carried as its own concept below instead of "
            "being offered as a substitute for a rate."),
    _c("petroleum refining output", "energy", "capacity", "IPG32411S", 5,
       note="A volume proxy for refinery activity, since the EIA "
            "utilization RATE is not on FRED."),
    _c("natural gas storage", "energy", "inventories", "WNGSTUS1", 5,
       source="EIA", factor_eligible=False,
       note="Same EIA-API gap as crude production."),
    _c("natural gas production", "energy", "supply", "N9070US2", 5, source="EIA",
       factor_eligible=False, note="Same EIA-API gap as crude production."),
    _c("electricity generation", "energy", "demand", "IPUTIL", 5,
       note="IP: utilities is the FRED-native proxy for electricity output."),
)

# ---------------------------------------------------------------------------
# 15. BUSINESS INVESTMENT
# ---------------------------------------------------------------------------
INVESTMENT: tuple[Concept, ...] = (
    _c("nondefense capital goods orders ex aircraft", "business_investment", "orders",
       "NEWORDER", 5),
    _c("nondefense capital goods shipments", "business_investment",
       "shipments", "ANDEVS", 5,
       note="AMNMNO (originally listed as an alternate) turned out to be "
            "nondurable-goods new ORDERS — a different concept entirely, "
            "not a substitute. ANDEVS is total nondefense capital goods "
            "shipments; no ex-aircraft cut of shipments (as opposed to "
            "orders, where NEWORDER already provides one) was found on "
            "FRED."),
    _c("private nonresidential fixed investment", "business_investment", "accounts",
       "PNFI", 5),
    _c("investment in equipment", "business_investment", "accounts",
       "Y033RC1Q027SBEA", 5),
    _c("investment in structures", "business_investment", "accounts",
       "B009RC1Q027SBEA", 5),
    _c("intellectual property investment", "business_investment", "accounts",
       "Y001RC1Q027SBEA", 5),
    _c("nonresidential construction spending", "business_investment", "construction",
       "PNRESCONS", 5,
       note="Private only, matching 'business' investment. TLNRESCONS "
            "(total, public+private) is a different, broader quantity."),
)

# ---------------------------------------------------------------------------
# 16. CORPORATE / PROFITS
# ---------------------------------------------------------------------------
CORPORATE: tuple[Concept, ...] = (
    _c("corporate profits", "corporate_profits", "profits", "CP", 5),
    _c("corporate profits after tax", "corporate_profits", "profits", "CPATAX", 5),
    _c("profit share of GDP", "corporate_profits", "margins", "W273RE1A156NBEA", 2,
       note="A ratio, so differenced. The margin measure that does not need "
            "constructing from two series."),
    _c("nonfarm business compensation", "corporate_profits", "costs", "COMPNFB", 5),
    _c("proprietors' income", "corporate_profits", "income", "PROPINC", 5),
)

# ---------------------------------------------------------------------------
# 17. PRODUCTIVITY
# ---------------------------------------------------------------------------
PRODUCTIVITY: tuple[Concept, ...] = (
    _c("labor productivity (output per hour)", "productivity", "productivity",
       "OPHNFB", 5),
    _c("unit labor costs", "productivity", "costs", "ULCNFB", 6),
    _c("hours worked", "productivity", "inputs", "HOANBS", 5),
    _c("nonfarm business output", "productivity", "output", "OUTNFB", 5),
    _c("real compensation per hour", "productivity", "compensation", "RCPHBS", 5),
)

# ---------------------------------------------------------------------------
# 18. DEMOGRAPHICS / STRUCTURAL
# ---------------------------------------------------------------------------
DEMOGRAPHICS: tuple[Concept, ...] = (
    _c("working-age population", "demographics", "population", "LFWA64TTUSM647S", 5,
       factor_eligible=False),
    _c("civilian noninstitutional population", "demographics", "population",
       "CNP16OV", 5, factor_eligible=False),
    _c("total population", "demographics", "population", "POPTHM", 5,
       factor_eligible=False),
)
# Every demographic concept is factor_eligible=False on purpose. At monthly
# frequency these are near-deterministic trends: standardised, they become
# almost constant columns that a factor model will either ignore or, worse,
# load a trend onto and call a cycle. They belong in the registry for
# long-horizon interpretation and per-capita constructions, not in the panel.

# ---------------------------------------------------------------------------
# 19. SURVEYS / EXPECTATIONS  (hard/soft separation is the point)
# ---------------------------------------------------------------------------
SURVEYS: tuple[Concept, ...] = (
    _c("economic policy uncertainty", "surveys_expectations", "uncertainty",
       "USEPUINDXD", 1, layer="soft", vintage_matters=False),
    _c("equity market uncertainty", "surveys_expectations", "uncertainty",
       "WLEMUINDXD", 1, layer="soft", vintage_matters=False),
    _c("Michigan current conditions sub-index", "surveys_expectations", "consumer",
       "UMCSENT1", 2, layer="soft", factor_eligible=False,
       note="UMCSENT1 is not a current-conditions component — it is the "
            "PREDECESSOR of UMCSENT itself, discontinued in 1977 when "
            "UMCSENT began. The current-conditions sub-index is not "
            "separately published on FRED; UMCSENT (the composite, "
            "already a concept above) is what is actually available."),
    _c("small business optimism", "surveys_expectations", "business", "NFIB", 1,
       layer="soft", factor_eligible=False,
       note="NFIB is not redistributed through FRED. Recorded as a known hole."),
)

# ---------------------------------------------------------------------------
# 20. MARKET-BASED EXPECTATIONS
# ---------------------------------------------------------------------------
MARKET_EXPECTATIONS: tuple[Concept, ...] = (
    _c("10-year breakeven", "market_expectations", "inflation compensation",
       "T10YIE", 1, layer="market", vintage_matters=False,
       note="Not an expectation — it carries a risk premium — but it is the "
            "daily one, against surveys that are monthly at best."),
    _c("5-year breakeven", "market_expectations", "inflation compensation",
       "T5YIE", 1, layer="market", vintage_matters=False),
    _c("5y5y forward breakeven", "market_expectations", "inflation compensation",
       "T5YIFR", 1, layer="market", vintage_matters=False,
       note="Strips the near-term energy pass-through out of breakevens."),
)


#: The whole target universe.
UNIVERSE: tuple[Concept, ...] = (
    OUTPUT + INFLATION + LABOR + CONSUMER + HOUSING + MANUFACTURING + CREDIT
    + FINANCIAL + LIQUIDITY + BANKING + FISCAL + TRADE + COMMODITIES + ENERGY
    + INVESTMENT + CORPORATE + PRODUCTIVITY + DEMOGRAPHICS + SURVEYS
    + MARKET_EXPECTATIONS
)

BY_FAMILY: dict[str, tuple[Concept, ...]] = {
    family: tuple(c for c in UNIVERSE if c.family == family) for family in FAMILIES
}


def all_candidate_ids() -> tuple[str, ...]:
    """Every series id named anywhere in the universe, deduplicated."""
    seen: dict[str, None] = {}
    for concept in UNIVERSE:
        for series_id in concept.candidates:
            seen.setdefault(series_id, None)
    return tuple(seen)


def concepts_for(series_id: str) -> tuple[Concept, ...]:
    """Which concepts a given series could serve. Usually one; sometimes more."""
    return tuple(c for c in UNIVERSE if series_id in c.candidates)
