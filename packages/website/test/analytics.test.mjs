import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/analytics.js", import.meta.url), "utf8");
const origin = "https://trainheroic-unofficial.com";

function browser({ consent = true, host = origin, path = "/faq" } = {}) {
  const listeners = new Map();
  const scripts = [];
  let canonical = `${origin}${path}?private=value#private`;
  class Element {
    constructor(href, download) {
      this.href = href;
      this.download = download;
    }
    closest() {
      return this;
    }
    getAttribute(name) {
      return name === "download" ? this.download : null;
    }
  }
  const window = { blumeConsent: { analytics: consent } };
  const document = {
    referrer: "https://example.com/private/person?email=private@example.com#secret",
    title: "FAQ · TrainHeroic Unofficial",
    querySelector: () => ({ href: canonical }),
    createElement: () => ({}),
    head: { append: (script) => scripts.push(script) },
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  runInNewContext(source, { window, document, location: { origin: host }, URL, Element });
  return {
    window,
    scripts,
    commands: () => Array.from(window.trainheroicAnalytics ?? [], (command) => Array.from(command)),
    navigate: (nextPath) => {
      canonical = `${origin}${nextPath}`;
      listeners.get("astro:page-load")?.();
    },
    click: (href, download) => listeners.get("click")?.({ target: new Element(href, download) }),
  };
}

test("denied, missing consent, and preview origins send nothing", () => {
  for (const options of [
    { consent: false },
    { consent: null },
    { host: "http://localhost:4321" },
  ]) {
    const page = browser(options);
    assert.equal(page.scripts.length, 0);
    assert.deepEqual(page.commands(), []);
  }
});

test("export app never initializes Google or sends actions", () => {
  for (const path of ["/export", "/export/"]) {
    const page = browser({ path });
    page.click(`${origin}/connect`);
    assert.equal(page.scripts.length, 0);
    assert.deepEqual(page.commands(), []);
  }
});

test("public page views strip URL parameters and referrer paths", () => {
  const page = browser();
  const commands = page.commands();
  assert.equal(commands[0][0], "js");
  assert.equal(commands[1][0], "config");
  assert.equal(commands[1][1], "G-936T4SZM4K");
  const config = commands[1][2];
  assert.equal(config.page_location, `${origin}/faq`);
  assert.equal(config.page_referrer, "https://example.com");
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(config.send_page_view, false);
  assert.equal(page.scripts.length, 1);
  assert.equal(
    page.scripts[0].src,
    "https://www.googletagmanager.com/gtag/js?id=G-936T4SZM4K&l=trainheroicAnalytics",
  );
  assert.equal(page.window.dataLayer, undefined);
  assert.equal(page.window.gtag, undefined);
  assert.equal(JSON.stringify(commands).includes("private"), false);
});

test("Astro navigation counts each page once and reuses the loader", () => {
  const page = browser();
  page.navigate("/faq");
  page.navigate("/connect?code=secret");
  page.navigate("/connect?different=secret");
  assert.equal(page.commands().filter((entry) => entry[1] === "page_view").length, 2);
  assert.equal(page.scripts.length, 1);
  assert.equal(JSON.stringify(page.commands()).includes("secret"), false);
  const before = page.commands().length;
  page.navigate("/export");
  page.click(`${origin}/connect`);
  assert.equal(page.commands().length, before);
});

test("only fixed public actions are sent, without link contents", () => {
  const page = browser();
  page.click(`${origin}/export?email=private@example.com`);
  page.click(`${origin}/connect#private`);
  page.click("https://mcp.trainheroic-unofficial.com/mcp?token=private");
  page.click("data:text/csv,private", "trainheroic-sample.csv");
  page.click("https://example.com/private");
  const events = page.commands().filter((entry) => entry[0] === "event");
  assert.deepEqual(
    events.map((entry) => entry[1]),
    [
      "page_view",
      "export_open",
      "connector_setup_open",
      "connector_endpoint_open",
      "sample_csv_download",
    ],
  );
  assert.equal(JSON.stringify(events).includes("private"), false);
  page.window.blumeConsent.analytics = false;
  page.navigate("/guides");
  page.click(`${origin}/connect`);
  assert.equal(page.commands().filter((entry) => entry[0] === "event").length, events.length);
});
