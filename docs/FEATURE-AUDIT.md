# Ripple Radar — feature audit

## Status as of 0.3.0

| Area | Status | Notes |
|---|---|---|
| Light / Dark / System theme | Fixed | Light is the default. The choice is saved. Settings has the switch. |
| World Tape | Fixed | Live headlines from the free feeds. Last good pull is kept. Per-source status, source filter, shock filter, and refresh interval are on the tape. |
| Headline ticker | Fixed | The strip under the header scrolls the same live headlines and opens the article. |
| Desk layout | Fixed | Show, hide, reorder, and side-column width persist. The exposed-markets filter persists. |
| Links | Fixed | Internal links are checked against the route list. External links must be http(s). The desktop window opens those in the browser and leaves the app's own address alone. |
| Backup, restore, tray, launch at startup, book export, data sources | Working | Shipped in 0.2.0. |
| Windows installer and updates | Working | Unsigned. SmartScreen warns. About → Check for updates reads GitHub Releases. |
| Code signing | Still missing | Azure Artifact Signing Basic is $9.99 a month. |
| Desktop sign-in | Still missing | The installed app is a local address. Saved accounts and billing stay on the hosted site. |
| Headline grouping and false book links | Still missing | Quiet days can still glue unrelated stories. Left alone on purpose. |
| Replay from a past date, filings, ship tracking | Still missing | The ledger does not rebuild a book as of a date. |
| Fed meeting dates on the brief | Still missing | They are not in the FRED release calendar. |

The sections below are the 2026-10-03 audit. Several "missing" rows there were built before 0.3.0. The table above is the current one.

# Ripple Radar — feature audit (2026-10-03)

**Branch:** `cursor/desktop-engine-depth-5477`  
**Date:** 2026-10-03  
**Scope:** What the app did when this note was written.

Later on this same branch: backup and restore, a data-sources page, tray alerts with optional launch at startup, book export, and the window title and logo say Ripple Radar. Code signing is still not done.

`docs/ROADMAP.md` is from 21 Sep 2026 and is behind the code. Freeze-and-learn, alerts, billing screens, the light theme, and engine tests are already in. This note treats the running app as the source of truth.

## 1. What you can do today

**Desk**

- Live Desk shows the event you have open: the causal chain, the scenario odds, what is already moving, and a session check.
- Paste a headline and turn it into a full research book, or open an empty book and fill it later.
- Rescore the current book when new stories arrive.
- A strip shows today's brief, the macro read, and volatility.
- Other live shocks sit in a "developing now" list so you can switch books.
- When the text names places, the desk draws a simple place map.

**World tape and brief**

- World Tape is the live headline stream, grouped into clusters, with counts for headlines, clusters, and high-importance books.
- Click a cluster to preview it, then open that book on the desk.
- The Brief is a daily read of books that touch your theses and watchlists, and you can mark it read.
- The Brief lists upcoming public data releases. Fed meeting dates are not on that list.

**Research**

- Ripple Map draws how the shock spreads. Click a node, or read the link table: direction, hops, confidence, and what would break the link.
- Scenarios lists the paths for this event, with odds that add up, and lets you add your own path.
- Probability bands appear only after a saved prior has been updated. An empty band stays empty.
- Game Theory shows the two-sided move table, what the players have done, and where the book stands.
- Assets ranks the names the graph reaches, with a scatter plot. Each name has a page for why it is there, which events link to it, and similar expressions.
- Macro is a set of regime pages (policy, inflation, cycle, growth, models, conditions, rates, global, shocks), filled from the published macro figures when those figures are available.

**Monitor**

- Theses lets you freeze a claim on a book and later mark it open, due, or reviewed.
- Watchlists are named ticker lists with last price, session change, and a research rank. You add names from the desk or from Assets.
- Alerts are rules on book odds, scenario moves, evidence, and prices. The app toasts you when a rule is met, and you can send the hit to a web address.
- Portfolio is that book's ranked expressions, grouped by how far they sit from the shock. It is not a brokerage account.

**Learning, help, account**

- Learning shows calibration charts, your reviewed thesis outcomes, and a ledger of forecasts that were locked before the outcome.
- A slider walks those locked snapshots in order. It does not rebuild the book as if you were back on that date.
- Docs is a short in-app guide to the desk, the tape, the map, scenarios, and what the numbers mean.
- You can sign in. Watchlists, alerts, theses, and desk saves then stay with the account. The desk itself works signed out.
- When payments are configured on the server, a signed-in user can subscribe or open the billing portal.
- About shows the icon, the name Ripple Radar, the version, and Check for updates. In the installed app it also shows where your data folder is.

**Around the pages**

- Ctrl or Cmd+K opens a jump box for pages, current events, and current tickers.
- The top bar says whether the tape is live, connecting, or stale, how old it is, and a short reason when a feed failed.
- The left rail collapses, and the same pages work on a narrow screen.
- If a page fails, you get Try again and Reload on a light screen.
- The interface is light. It does not follow a dark Windows theme.

**Windows app (this branch)**

- The installer puts Ripple Radar in its own window, on the taskbar, and in the Start menu, with no console window.
- Check for updates looks at GitHub Releases. Update downloads the new build and restarts into it. Your data folder sits outside the install folder.
- A second launch focuses the window you already have.
- No release has been published yet, and the installer is not code-signed, so Windows warns the first time you run it.

## 2. Compared with a serious desk

**Core analysis.** The spine is here: live tape, clusters, a full book (map, scenarios, players, ranked names), paste-to-analyze, rescore, and macro pages. Numbers that were not measured are labeled that way. What is still thin: quiet days can glue unrelated headlines together, a player move does not change the map, and several different ideas are folded into one rank score.

**Alerts and notifications.** Rules, in-app toasts, an optional web address, and a scheduled checker on the hosted site. No Windows notification, no email, no sound, and nothing fires after you close the window. The installed app does not run that hosted checker on its own.

**Watchlists and saved views.** Named lists, pinned names, saved theses, and versioned saves when you are signed in. No saved screen layout, and no named view such as "my energy desk."

**Search.** The jump box finds pages, events on the desk now, and tickers on the desk now. It does not search old headlines, notes, or past books.

**History, replay, and backtesting.** The slider and the ledger show what the desk had locked, and they do not rewrite it later. There is no way to rebuild a book from only what was known on a past date, and no test of whether following the ranks would have helped.

**Export and sharing.** Nothing to download, copy out, or send. A book leaves the app only as a screenshot.

**Settings and onboarding.** About, version, update check, the data-folder path, the in-app guide, and sign-in. No first-run tour, no place to enter feed keys, and no notification preferences. About is the only settings screen.

**Data-source status.** One line in the top bar, plus a short note when a feed fails. No page that lists each source, when it last worked, or whether a key is missing.

**Desktop basics.** Own window, taskbar icon, Start menu entry, one-click installer, update check, data kept across updates, light UI, one window at a time. Missing: a signed installer, a tray icon, launch at startup, backup and restore, crash reports, and any shortcut besides the jump box. Sign-in inside the installed app is not wired for its local address.

**Promised in the docs and not built.**

- A smarter grouper, so quiet days stop merging unrelated stories.
- Fewer false links between books that only share a word.
- A checker that labels live clusters before they become books.
- A closer read of who and what is in a story, attached to the map first.
- Player moves that change the map.
- A true replay that rebuilds the book from that day's information only.
- How a shock moves prices over time, options and curves, uncertainty bands, regime models, and portfolio stress ranges. The docs hold the bands back until the evidence behind them is real.
- Filings, ship tracking, and prediction-market text as inputs.
- Fed meeting dates on the brief.
- The hosted site is not finished: scheduled jobs, the model key, database migrations, one real payment test, and an uptime check.
- A script test suite still fails (17 of 201) and is not in the automated checks.
- A broader-factor check on the macro "quad" is still open.
- Confirming that a signed-in desk really syncs to the hosted database.
- The mark in the corner still says Alpha Recon in places, while the window title says Ripple Radar.

## 3. Missing, in the order I would do them

"Must-have" means a first desktop release is awkward or unsafe to rely on without it. Research depth comes after the shell, because the desk already builds a book.

1. **Code-signed installer.** Windows warns, and some PCs block an unsigned setup. Size M. Must-have for v1: yes.
2. **Backup and restore.** Theses, alerts, and the local database live in one folder. An update is not supposed to delete it, and there is still no button to copy it out or put it back. Size S. Must-have for v1: yes.
3. **A data-source status page.** One status line cannot say whether news, prices, or the macro feed failed, or that a key is missing. Size S. Must-have for v1: yes.
4. **Windows notifications for alerts.** A toast inside an open window is easy to miss, and closing the app stops them. Size M. Must-have for v1: yes.
5. **Sign-in that works in the installed app.** Saved desk and billing assume a normal web address. The desktop app is a local address, so those features do not come with it. Size M. Must-have for v1: no, while this PC is the only copy. Yes before the same account is used on the web and the PC.
6. **Export a book.** You cannot hand someone the map, the paths, and the names. Size S. Must-have for v1: no.
7. **Tray icon and launch at startup.** Alerts and a live tape want the app up after login, including with the window closed. Size S. Must-have for v1: no. Do it together with Windows notifications.
8. **Search across headlines, notes, and old books.** The jump box only sees what is on the desk right now. Size M. Must-have for v1: no.
9. **Saved views.** A serious desk reopens a layout by name. Size M. Must-have for v1: no. Watchlists already cover the ticker half.
10. **A short first-run setup.** A new install lands on the desk with no walkthrough of keys, sign-in, or where data lives. Size S. Must-have for v1: no. Docs and About cover the minimum.
11. **Crash reports.** A closed window leaves no note in the product. The app already writes a log file on the PC. Size S. Must-have for v1: no.
12. **More keyboard shortcuts.** Only the jump box has one. Size S. Must-have for v1: no.
13. **Cleaner grouping and fewer false links.** The book is only as good as the story it came from, and the docs still call this the main engine gap. Size L. Must-have for v1: no. First research item once the shell is trustworthy.
14. **True historical replay, then a simple backtest.** The slider shows what was locked, not what the model would have said that day, and nothing checks whether the ranks would have helped. Size L. Must-have for v1: no. The docs put full replay in "later" on purpose.
15. **Fed dates, the failing script tests, the hosted deploy, a live payment test, and the Alpha Recon mark.** Known leftovers. Size S each, except the deploy, which is M. Must-have for a v1 desktop: no. Fed dates and the script tests belong with the next pass over those areas. Deploy and payments matter for the website, not for the PC install.
16. **Deeper market evidence.** Options, curves, price responses over time, uncertainty bands, filings, ship tracking. Size L. Must-have for v1: no. The docs already hold the bands until the evidence behind them exists.
