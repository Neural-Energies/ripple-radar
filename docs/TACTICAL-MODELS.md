# Tactical models for NQ, ES, GC and CL

This is a research book for a personal futures account. It is not on the desk. Nothing here was fit to the 2023–2026 window, and the judgment at the end was written after that window was scored once.

**Paper-trade candidates.** Two sleeves are worth watching with paper fills.

- **Volatility-filtered trend** (`vol_filter_tsmom`), one contract. It made money in 2015–2022 and again in 2023–2026, on the four-market book and on each market in the later window. In the later window it made less than simply holding the contracts, because that window was a bull market in equities and gold.
- **Volatility-targeted size of a long** (`buy_hold_vol_target`). This is a sizing rule for a position that is already long, not a signal to get long. On the four-market book its out-of-sample Sharpe was 1.72 against 1.33 for an unscaled one-lot long, and the dollar drawdown was smaller ($98,645 against $155,180) on similar profit ($749,270 against $795,135).

**Leave these on the page, not in a paper account.** Twelve-month momentum made money after 2022 mostly by being long that same bull market, and it lost money on ES and gold in 2015–2022. Carry, five-year value, and both equal-weight composites lost money out of sample. Carry and value were short NQ, ES and gold for the entire test. That short is what those rules say to do when futures are rich and prices are above where they were five years ago.

Dollars below are variation margin on the standard contract: NQ at $20 a point, ES at $50, GC at $100 an ounce (the 100-ounce contract), CL at $1,000 a barrel (the 1,000-barrel contract).

## What was held fixed

| Rule | Value | Where it comes from |
|---|---|---|
| Train window | 1 Jan 2015 – 31 Dec 2022 | The volatility line is learned here, expanding, using only past months, then frozen |
| Test window | 1 Jan 2023 – 16 Oct 2026 | Scored once |
| Trend lookbacks | 21, 63, 126, 252 sessions | Moskowitz, Ooi and Pedersen (2012) |
| Value lookback | 1,260 sessions (five years) | Asness, Moskowitz and Pedersen (2013) |
| Vol window | 21 sessions | Moreira and Muir (2017) |
| High-vol line | 80th percentile of that 21-day vol | A coarse version of Barroso and Santa-Clara (2015) |
| One-lot vote | Average of the factor signs at least ½ | Pre-set. Two factors in agreement, or a stronger majority |
| Dollar-vol budget | $40,000 a year per market, cap 4 contracts | Maillard, Roncalli and Teiletche (2010), equal risk per market |
| Rebalance | Last session of each month | The papers rebalance monthly |
| Fill | Decided at the close. The new position earns the next session. Cost is charged on the decision day | No same-day fill |
| Costs, per side | NQ $7.50, ES $15, GC $22.50, CL $22.50 | $2.50 commission plus 1 tick on NQ and ES, 2 ticks on GC and CL |

A reversal pays two sides, because the book sells one contract and buys the other. The last file date is 16 Oct 2026, which is mid-month, so it is not treated as a monthly order. The position that day is the one set on 30 Sep 2026.

Sharpe is the mean daily dollar P&L divided by its standard deviation, times the square root of 252. Futures P&L is already the excess over cash, so no interest rate is subtracted. Max drawdown is the worst peak-to-trough of cumulative dollars inside that window, restarting at zero on the window's first day. Profit factor is the sum of the winning days divided by the absolute sum of the losing days, after costs. Trade count is the number of monthly orders that changed the position. Buy-and-hold shows zero trades inside both windows because the one-lot was opened in 2004, before either window.

## The data

Prices are Yahoo Finance daily closes for the continuous front month: `NQ=F`, `ES=F`, `GC=F`, `CL=F`, from January 2004 through 16 Oct 2026. The cash S&P 500 (`^GSPC`), the Nasdaq-100 (`^NDX`) and GLD are used only to see the roll. The 10-year real yield is the Treasury H.15 inflation-indexed series, which is the series FRED publishes as `DFII10`. FRED's own file download did not answer from this environment, so the Treasury file is the source on disk. The panel is `ace/tactical/data/daily.csv`.

The Yahoo front month splices two contracts together on a roll. On a scheduled roll session (equity expiry, or the gold first-notice date) the futures-versus-cash return is removed up to 2 percent of price. A gap wider than that is left in the P&L, because a gap that large is a basis event. Over the test window that adjustment removed about $12,950 from a long NQ, $3,785 from a long ES and $4,318 from a long gold, against the raw continuous series. Crude has no separate cash series in the free data (the usual "spot" print is the prompt future), so crude is not roll-adjusted. Crude's April 2020 path is the prompt settlement itself:

- 20 Apr 2020: **−$55,900** on one contract (18.27 to −37.63).
- 21 Apr 2020: **+$47,640** (the continuous series goes from −37.63 to 10.01).

Both days sit inside the training window. The test window does not contain them. The backtest assumes the account posted the variation margin and was not liquidated. A two-tick slippage assumption does not describe that week.

## The models

### Buy and hold, one contract

Always long one contract. This is the baseline. In 2023–2026, NQ, ES and gold were in a bull market, so this bar is high.

### Buy and hold, volatility targeted

Always long, but the number of contracts is chosen so the forecast annual dollar swing is about $40,000, and the result is rounded to a whole contract between −4 and 4. Forecast vol is the last month of daily returns, known at the close. When one contract already swings more than $80,000 a year, the rounded size is zero and the book is flat. That happens often on NQ, which is a large contract for this budget: out of sample the sized NQ long was on for 586 of 954 sessions and never held more than one contract.

This is the Moreira and Muir (2017) idea applied as a dollar budget, and it is also the equal-risk weight of Maillard, Roncalli and Teiletche (2010) when each market is given the same dollar risk.

### Twelve-month time-series momentum

Long one contract when the past 252 sessions are up, short when they are down. Moskowitz, Ooi and Pedersen (2012). The volatility-targeted twin (`tsmom_12_vol`) uses the same sign and the $40,000 budget.

### Multi-horizon time-series momentum

The sign of the average of the 1, 3, 6 and 12 month signs. One contract. Same paper; they show the sign pattern across those horizons rather than a single window.

### Carry

For NQ and ES, long when the future is cheap to the cash index and short when it is rich. That is the futures basis in Koijen, Moskowitz, Pedersen and Vrugt (2018). With interest rates above dividend yields the equity future is rich, so the carry trade is short.

For gold there is no deferred contract in the free history. The stand-in is the 10-year real yield: long when it is negative, short when it is positive (Erb and Harvey, 2013). From 2023 through October 2026 the real yield stayed positive, so gold carry was short one contract the whole test.

Crude carry is not run. A term-structure carry needs a second contract, and the free crude "spot" series is the prompt future.

### Value

Long when the price is below where it was five years ago, short when it is above. That is the futures value signal in Asness, Moskowitz and Pedersen (2013). On NQ and ES it was short for the entire train window and the entire test, because those indexes were higher than they had been five years earlier the whole time. It is a slow reversal, not a price-to-earnings model.

### Volatility filter on the trend

The multi-horizon sign, flattened when the last month's realized volatility is above the high line. Inside 2015–2022 the line is the expanding 80th percentile of prior month-end readings, and it stays quiet until 24 months exist. From January 2023 on, the line is frozen at the full train-window 80th percentile. For NQ that frozen line is an annualized realized vol of about 28 percent. Raising NQ's test-window prices by 80 percent does not move the line. In February 2020 the filter was already flat on NQ, ES, gold and (for the long side) crude, before the April crude settlement.

### Composite, one contract and volatility targeted

Equal-weight average of four votes, each −1, 0 or +1: multi-horizon momentum, carry, five-year value, and a volatility vote (long when recent vol is below the training median, short when it is above the high line, flat in between). Crude drops the carry vote, because that vote does not exist, and the average is taken over the three that do.

The one-lot version is long at an average of +½ or more, short at −½ or less, and flat in between. The sized version (`composite_vol_target`) multiplies that average by the $40,000 budget and rounds to whole contracts. Giving every market the same dollar budget is the risk-parity book.

## Results

P&L is net of the costs above. "Book" is the sum of the four markets (three, for carry). Trade count on the book is the sum of the legs.

### Buy and hold, one contract

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | 122,994 | 0.35 | −107,991 | 1.07 | 0 | 354,435 | 1.10 | −94,054 | 1.22 | 0 |
| ES | 76,600 | 0.33 | −60,741 | 1.07 | 0 | 188,378 | 1.18 | −54,669 | 1.24 | 0 |
| GC | 56,564 | 0.31 | −49,949 | 1.06 | 0 | 231,172 | 0.78 | −131,588 | 1.18 | 0 |
| CL | 26,990 | 0.09 | −114,040 | 1.02 | 0 | 21,150 | 0.17 | −44,400 | 1.03 | 0 |
| Book | 283,148 | 0.40 | −186,209 | 1.08 | 0 | 795,135 | 1.33 | −155,180 | 1.28 | 0 |

### Buy and hold, volatility targeted

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | 286,386 | 0.72 | −76,905 | 1.14 | 45 | 221,322 | 1.15 | −49,465 | 1.28 | 9 |
| ES | 112,785 | 0.29 | −90,340 | 1.05 | 50 | 198,926 | 1.13 | −54,669 | 1.22 | 14 |
| GC | 97,543 | 0.27 | −97,778 | 1.05 | 49 | 252,131 | 1.41 | −48,941 | 1.35 | 13 |
| CL | −4,728 | −0.01 | −234,260 | 1.00 | 54 | 76,890 | 0.41 | −72,423 | 1.08 | 23 |
| Book | 491,986 | 0.48 | −265,286 | 1.09 | 198 | 749,270 | 1.72 | −98,645 | 1.36 | 59 |

In-sample, the sized long improved the book Sharpe from 0.40 to 0.48 and made more dollars, with a deeper book drawdown. Out of sample the Sharpe rose from 1.33 to 1.72 and the book drawdown shrank, on slightly less profit. Crude was about flat in-sample, including the April 2020 path, and made money out of sample.

### Twelve-month momentum, one contract

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | 125,749 | 0.35 | −87,770 | 1.07 | 9 | 265,427 | 0.82 | −94,054 | 1.16 | 1 |
| ES | −42,266 | −0.18 | −110,378 | 0.96 | 17 | 133,952 | 0.84 | −54,669 | 1.16 | 1 |
| GC | −44,611 | −0.24 | −63,550 | 0.96 | 13 | 204,426 | 0.69 | −131,588 | 1.15 | 2 |
| CL | 23,275 | 0.08 | −91,200 | 1.02 | 7 | −42,850 | −0.35 | −86,405 | 0.94 | 8 |
| Book | 62,147 | 0.09 | −164,527 | 1.02 | 46 | 560,955 | 0.95 | −217,996 | 1.19 | 12 |

The out-of-sample NQ and ES trade counts are 1. The book was short coming out of 2022 and flipped long in the spring of 2023, then stayed long. The profit is the bull market after that flip. In-sample, ES and gold lost money. Crude lost money out of sample.

### Twelve-month momentum, volatility targeted

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | 210,673 | 0.53 | −79,105 | 1.10 | 49 | 132,314 | 0.68 | −54,082 | 1.16 | 10 |
| ES | −59,506 | −0.15 | −187,791 | 0.97 | 54 | 144,301 | 0.82 | −56,553 | 1.16 | 14 |
| GC | −98,763 | −0.27 | −118,000 | 0.95 | 55 | 198,685 | 1.11 | −88,304 | 1.27 | 14 |
| CL | 95,887 | 0.22 | −102,015 | 1.05 | 57 | −89,590 | −0.48 | −145,253 | 0.92 | 26 |
| Book | 148,293 | 0.16 | −340,153 | 1.03 | 215 | 385,710 | 0.91 | −186,179 | 1.17 | 64 |

Sizing did not repair the in-sample losses on ES and gold. Out of sample, gold's Sharpe rose above the one-lot trend, and crude's loss got larger. Book Sharpe 0.16 in-sample, 0.91 out-of-sample, both below the unscaled long.

### Multi-horizon momentum, one contract

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | 54,537 | 0.16 | −85,824 | 1.03 | 25 | 44,617 | 0.14 | −126,946 | 1.03 | 14 |
| ES | −62,850 | −0.32 | −89,029 | 0.93 | 35 | 42,547 | 0.30 | −60,944 | 1.06 | 10 |
| GC | 3,444 | 0.02 | −60,570 | 1.00 | 40 | 201,901 | 0.74 | −122,385 | 1.19 | 12 |
| CL | 44,148 | 0.16 | −87,330 | 1.05 | 36 | −14,623 | −0.13 | −52,945 | 0.97 | 22 |
| Book | 39,278 | 0.06 | −140,219 | 1.01 | 136 | 274,442 | 0.53 | −251,377 | 1.10 | 58 |

More trades than the twelve-month sign, and a weaker out-of-sample book. NQ's out-of-sample drawdown ($126,946) is deeper than buy-and-hold's ($94,054) on much less profit.

### Carry

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | 187,885 | 0.53 | −87,362 | 1.11 | 33 | −354,435 | −1.10 | −400,310 | 0.82 | 0 |
| ES | 63,180 | 0.27 | −70,899 | 1.06 | 15 | −188,378 | −1.18 | −198,465 | 0.81 | 0 |
| GC | −28,774 | −0.16 | −85,220 | 0.97 | 8 | −231,172 | −0.78 | −354,467 | 0.85 | 0 |
| CL | — | — | — | — | — | — | — | — | — | — |
| Book | 222,291 | 0.40 | −197,442 | 1.08 | 56 | −773,985 | −1.29 | −855,839 | 0.79 | 0 |

In-sample, equity carry made money (the short side had stretches that paid). Out of sample the position never changed: short one NQ, short one ES, short one gold, for all 954 sessions. The P&L is buy-and-hold with the sign flipped. Crude is blank on purpose.

### Value

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | −122,994 | −0.35 | −233,739 | 0.93 | 0 | −354,435 | −1.10 | −400,310 | 0.82 | 0 |
| ES | −76,600 | −0.33 | −133,637 | 0.94 | 0 | −188,378 | −1.18 | −198,465 | 0.81 | 0 |
| GC | −39,456 | −0.21 | −84,237 | 0.96 | 4 | −231,172 | −0.78 | −354,467 | 0.85 | 0 |
| CL | −5,695 | −0.02 | −84,810 | 1.00 | 5 | 31,330 | 0.25 | −57,680 | 1.05 | 4 |
| Book | −244,746 | −0.36 | −414,995 | 0.93 | 9 | −742,655 | −1.23 | −856,865 | 0.80 | 4 |

NQ and ES value are a continuous short of the one-lot long. Crude value made $31,330 out of sample over 4 trades. That is the only value cell that paid in the test, and it is too small a sample to lean on.

### Volatility-filtered trend

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | 74,319 | 0.33 | −58,109 | 1.08 | 29 | 91,382 | 0.33 | −112,886 | 1.07 | 15 |
| ES | 47,417 | 0.34 | −28,298 | 1.08 | 28 | 59,027 | 0.43 | −60,944 | 1.08 | 9 |
| GC | −29,161 | −0.20 | −57,668 | 0.96 | 45 | 74,796 | 0.59 | −37,630 | 1.21 | 23 |
| CL | 44,863 | 0.27 | −35,510 | 1.06 | 44 | 22,897 | 0.25 | −45,440 | 1.05 | 23 |
| Book | 137,437 | 0.32 | −90,821 | 1.07 | 146 | 248,103 | 0.58 | −149,661 | 1.11 | 70 |

This is the active book that was positive on the combined account in both windows, and positive on every market out of sample. Gold lost money in-sample. The out-of-sample book Sharpe of 0.58 is below buy-and-hold's 1.33. The out-of-sample NQ drawdown ($112,886) is deeper than buy-and-hold's. What the filter did buy: ES in-sample drawdown of $28,298 against $60,741 for the one-lot long, and a crude in-sample drawdown of $35,510 against $114,040, because the book was flat or short through the worst of early 2020 rather than long the prompt into the negative print. Costs on the out-of-sample book were $1,522.

### Composite, one contract

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | 57,484 | 0.23 | −70,996 | 1.08 | 26 | −164,489 | −0.97 | −210,907 | 0.66 | 11 |
| ES | −19,330 | −0.13 | −80,801 | 0.96 | 25 | −76,945 | −0.88 | −78,545 | 0.63 | 7 |
| GC | −20,065 | −0.18 | −25,255 | 0.94 | 29 | −137,170 | −0.51 | −258,155 | 0.87 | 20 |
| CL | 8,460 | 0.09 | −21,980 | 1.02 | 24 | 7,935 | 0.19 | −11,390 | 1.07 | 10 |
| Book | 26,549 | 0.06 | −150,682 | 1.02 | 104 | −370,669 | −0.99 | −486,565 | 0.79 | 48 |

The in-sample book was about flat (Sharpe 0.06). The test lost $370,669. Carry and value voted short often enough to outweigh momentum. Crude's one-lot composite made a small profit in both windows, with a shallow out-of-sample drawdown ($11,390) over 10 trades.

### Composite, volatility targeted (the risk-parity book)

| Market | IS P&L | IS Sharpe | IS max DD | IS PF | IS trades | OOS P&L | OOS Sharpe | OOS max DD | OOS PF | OOS trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NQ | −63,423 | −0.39 | −81,713 | 0.89 | 43 | −22,602 | −0.78 | −28,040 | 0.43 | 1 |
| ES | −10,275 | −0.07 | −64,163 | 0.98 | 45 | −63,778 | −1.44 | −65,378 | 0.47 | 5 |
| GC | −4,937 | −0.03 | −30,313 | 0.99 | 46 | −11,132 | −0.34 | −25,719 | 0.84 | 7 |
| CL | 0 | 0.00 | −69,620 | 1.00 | 56 | −24,425 | −0.33 | −44,795 | 0.94 | 20 |
| Book | −78,635 | −0.21 | −127,461 | 0.96 | 190 | −121,937 | −1.19 | −126,137 | 0.78 | 33 |

Same votes, smaller size. Still a loss in both windows. Crude's in-sample gross P&L was $1,620 and costs were $1,620, so the net is about zero after a $69,620 round trip. Sizing did not save the mix.

## What to paper trade

Paper trade means a simulated fill at the monthly close, one account, the costs above, no discretion on the exceptions.

1. **Volatility-filtered trend, one contract, all four markets.** It is the only timing book that made money on the combined account in both windows and on every market in the test, with 70 test-window trades rather than one flip. Expect it to lag a plain long when the indexes trend up smoothly. The in-sample gold loss is a reason to keep the size at one contract. Revisit the paper account if a year of live marks diverges from this path by more than the in-sample drawdown on that market.

2. **Volatility-targeted size, and only on risk he already wants to hold long.** The test says this improved Sharpe and cut the book drawdown relative to one unscaled contract of each. It will go flat NQ for long stretches under a $40,000 budget, because one NQ is often already a bigger risk than that. If the budget is wrong for the account, change it before paper trading and accept that the new budget has not been scored here. Do not retune it on the 2023–2026 path.

Do not paper trade carry, five-year value, or the equal-weight composite on these four markets until the mix is redesigned from research that is not this test window. The composite's loss is the information: an equal vote handed the book to two factors that were structurally short a bull market.

Twelve-month momentum is the textbook rule and it is reported in full. It is a weak paper-trade candidate next to the filter. The in-sample book Sharpe was 0.09, ES and gold lost money in that window, and the out-of-sample profit is one flip into a bull market.

## Limitations

- One account, four markets, one test window of about 954 sessions. A Sharpe of 0.5 on that window is a small number of independent bets.
- The volatility line and the volatility vote saw 2015–2022, including 2020, before the test. The sign rules (momentum, carry, value) have no estimated weight. No lookback, threshold, cost or budget was changed after the test was scored. The choice of which sleeve is worth papering was made after seeing the test, and it is a judgment, not a new parameter.
- Fills are at the daily close. There is no open, no stop, no margin call and no liquidation. April 2020 crude is marked as if the account survived both settlements.
- The equity and gold roll adjustment is a cap, not a second contract. A real roll fills both the expiring contract and the next one. Crude rolls are unadjusted, so a prompt-continuous crude P&L still contains splice noise smaller than the April 2020 break.
- Yahoo's continuous prices are the free front month, not a paid back-adjusted series from the exchange.
- The gold carry input is the real yield, not the gold curve. Equity carry is the basis against the cash index, which is the right object and, in this decade, a standing short.
- Five-year value on an equity index is a reversal, not a valuation. A price-to-earnings sleeve would be a different model and was not built, because that series was not in the free panel used here.
- Integer contracts and a $40,000 budget mean the sized book often holds 0, 1 or 2 contracts. A fractional contract would look different and was not reported, because the account trades whole contracts.
- Costs are a published schedule, not a fit to fills. They are small next to the six-figure swings. They are the whole story only for the sized crude composite in-sample, where gross profit and costs both came out to $1,620.

## Where the output lives

The desk does not render this. Two places hold it:

- `GET /api/tactical` returns the book as JSON (`src/routes/api/tactical.ts`).
- `readTacticalBook()` in `src/lib/tactical/book.ts` is the same object for a server function.

Each model has, per market, the in-sample and out-of-sample metrics, the month-end equity curve in dollars from 2015 on, and the contracts the rule was holding on the last session. A later screen can read that payload. It should label the numbers as a research backtest with a frozen test window, and it should keep buy-and-hold on the same page as any sleeve it shows.

Rebuild with `python -m ace.tactical` after a price refresh (`python -m ace.tactical --fetch`). The tests check that the committed JSON matches a fresh run of the committed prices, and that moving test-window prices does not move the frozen volatility line.

## Papers

- Moskowitz, Tobias J., Yao Hua Ooi, and Lasse Heje Pedersen. "Time Series Momentum." *Journal of Financial Economics* 104, no. 2 (2012): 228–250.
- Asness, Clifford S., Tobias J. Moskowitz, and Lasse Heje Pedersen. "Value and Momentum Everywhere." *Journal of Finance* 68, no. 3 (2013): 929–985.
- Koijen, Ralph S. J., Tobias J. Moskowitz, Lasse Heje Pedersen, and Evert B. Vrugt. "Carry." *Journal of Financial Economics* 127, no. 1 (2018): 197–225.
- Erb, Claude B., and Campbell R. Harvey. "The Golden Dilemma." *Financial Analysts Journal* 69, no. 4 (2013): 10–42.
- Moreira, Alan, and Tyler Muir. "Volatility-Managed Portfolios." *Journal of Finance* 72, no. 4 (2017): 1611–1644.
- Barroso, Pedro, and Pedro Santa-Clara. "Momentum Has Its Moments." *Journal of Financial Economics* 116, no. 1 (2015): 111–120.
- Maillard, Sébastien, Thierry Roncalli, and Jérôme Teiletche. "The Properties of Equally Weighted Risk Contribution Portfolios." *Journal of Portfolio Management* 36, no. 4 (2010): 60–70.
