/** Free public RSS the desk polls. Shared by the server and the feed check. */
export const NEWS_FEEDS: { source: string; url: string }[] = [
  { source: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { source: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { source: "NYT Business", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { source: "OilPrice", url: "https://oilprice.com/rss/main" },
  { source: "CNBC World", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html" },
  { source: "CNBC Markets", url: "https://www.cnbc.com/id/15839069/device/rss/rss.html" },
  { source: "Defense One", url: "https://www.defenseone.com/rss/all/" },
  { source: "Guardian", url: "https://www.theguardian.com/world/rss" },
  { source: "Guardian Business", url: "https://www.theguardian.com/uk/business/rss" },
  { source: "NPR World", url: "https://feeds.npr.org/1004/rss.xml" },
  { source: "NPR Business", url: "https://feeds.npr.org/1006/rss.xml" },
  { source: "Fed", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  {
    source: "Google News",
    url: "https://news.google.com/rss/search?q=when:1d+(markets+OR+geopolitics+OR+%22central+bank%22+OR+%22supply+chain%22+OR+sanctions+OR+hurricane+OR+semiconductor)&hl=en-US&gl=US&ceid=US:en",
  },
];
