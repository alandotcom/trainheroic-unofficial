/* Loaded by Blume only in production, after analytics consent. No export-app tracking. */
(() => {
  const id = "G-936T4SZM4K";
  const origin = "https://trainheroic-unofficial.com";
  if (location.origin !== origin || window.blumeConsent?.analytics !== true) return;

  let loaded = false;
  let lastPage = null;
  const page = () => {
    if (window.blumeConsent?.analytics !== true) return null;
    // Canonicals come from the static build, never from visitor input or URL parameters.
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    if (!canonical) return null;
    const url = new URL(canonical);
    if (url.origin !== origin || /\/export\/?$/.test(url.pathname)) return null;
    return `${origin}${url.pathname}`;
  };
  function gtag() {
    // Keep Google separate from Blume's automatic search/feedback event queue.
    window.trainheroicAnalytics ??= [];
    window.trainheroicAnalytics.push(arguments);
  }
  let referrer = "";
  try {
    referrer = new URL(document.referrer).origin;
  } catch {}

  const visit = () => {
    const url = page();
    if (!url || url === lastPage) return;
    lastPage = url;
    if (!loaded) gtag("js", new Date());
    gtag("config", id, {
      send_page_view: false,
      page_location: url,
      page_referrer: referrer,
      page_title: document.title,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_expires: 60 * 60 * 24 * 90,
    });
    gtag("event", "page_view", { send_to: id });
    referrer = url;
    if (!loaded) {
      loaded = true;
      const tag = document.createElement("script");
      tag.async = true;
      tag.src = `https://www.googletagmanager.com/gtag/js?id=${id}&l=trainheroicAnalytics`;
      document.head.append(tag);
    }
  };
  visit();
  document.addEventListener("astro:page-load", visit);
  document.addEventListener("click", (event) => {
    if (!page()) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) return;
    const url = new URL(link.href, origin);
    let name;
    if (link.getAttribute("download") === "trainheroic-sample.csv") name = "sample_csv_download";
    else if (url.origin === origin && url.pathname.replace(/\/$/, "") === "/export")
      name = "export_open";
    else if (url.origin === origin && url.pathname.replace(/\/$/, "") === "/connect")
      name = "connector_setup_open";
    else if (url.origin === "https://mcp.trainheroic-unofficial.com")
      name = "connector_endpoint_open";
    if (name) gtag("event", name, { send_to: id });
  });
})();
