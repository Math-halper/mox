import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "./types.ts";
import { ToolError, num, requireStr, str } from "./types.ts";
import { htmlToText, resolveUserPath, truncateEnd } from "../util.ts";

/**
 * Tier 2 (browser) seam.
 *
 * Playwright is an optional dependency: `npm i playwright && npx playwright install chromium`.
 * Without it, the tool explains what to install instead of failing cryptically.
 * State is kept in a module-level browser so that a login persists across calls.
 */

type PlaywrightPage = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  title: () => Promise<string>;
  url: () => string;
  content: () => Promise<string>;
  innerText: (selector: string) => Promise<string>;
  click: (selector: string, opts?: { timeout?: number }) => Promise<void>;
  fill: (selector: string, value: string, opts?: { timeout?: number }) => Promise<void>;
  press: (selector: string, key: string) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<Buffer>;
  keyboard: { press: (key: string) => Promise<void> };
  close: () => Promise<void>;
};

type PlaywrightBrowser = {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
};

type PlaywrightModule = {
  chromium: { launch: (opts: { headless: boolean }) => Promise<PlaywrightBrowser> };
};

let browser: PlaywrightBrowser | null = null;
let page: PlaywrightPage | null = null;

async function loadPlaywright(): Promise<PlaywrightModule> {
  const specifier = "playwright";
  try {
    const mod = (await import(specifier)) as PlaywrightModule;
    return mod;
  } catch {
    throw new ToolError(
      "browser automation needs Playwright. Install it with:\n" +
        "  npm i playwright && npx playwright install chromium\n" +
        'Then set tools.browser to true in mox.config.json (or leave it true).',
    );
  }
}

async function getPage(config: { browser?: { headless?: boolean } }, fresh = false): Promise<PlaywrightPage> {
  if (fresh && page) {
    await page.close().catch(() => undefined);
    page = null;
  }
  if (!page) {
    const { chromium } = await loadPlaywright();
    browser ??= await chromium.launch({ headless: config.browser?.headless !== false });
    page = await browser.newPage();
  }
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (page) await page.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  page = null;
  browser = null;
}

export const browserTool: ToolDef = {
  name: "browser",
  description:
    "Drive a real Chromium browser. Actions: `open` (navigate), `text` (readable page text), " +
    "`click` (CSS selector), `fill` (selector + value), `press` (key), `screenshot` (saves a PNG), `close`. " +
    "Requires Playwright. Prefer `http_request` for simple GETs.",
  readOnly: false,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "One of: open, text, click, fill, press, screenshot, close.",
      },
      url: { type: "string", description: "URL for `open`." },
      selector: { type: "string", description: "CSS selector for click/fill/press." },
      value: { type: "string", description: "Text for `fill`, key for `press`." },
      path: { type: "string", description: "Output path for `screenshot`." },
      timeout_ms: { type: "integer", description: "Action timeout (default 20000)." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  summarize: (args) => `${str(args, "action")} ${str(args, "url") || str(args, "selector")}`.trim(),
  async execute(args, ctx) {
    const action = requireStr(args, "action").toLowerCase();
    const timeout = Math.min(num(args, "timeout_ms", 20_000), 120_000);
    const target = await getPage({}, action === "open");

    switch (action) {
      case "open": {
        const url = requireStr(args, "url");
        await target.goto(url, { waitUntil: "domcontentloaded", timeout });
        return `opened ${target.url()} — title: ${await target.title()}`;
      }
      case "text": {
        const body = await target.content();
        return truncateEnd(htmlToText(body), ctx.config.agent.maxToolOutputChars);
      }
      case "click": {
        await target.click(requireStr(args, "selector"), { timeout });
        return `clicked ${str(args, "selector")} — now at ${target.url()}`;
      }
      case "fill": {
        await target.fill(requireStr(args, "selector"), str(args, "value"), { timeout });
        return `filled ${str(args, "selector")}`;
      }
      case "press": {
        const key = str(args, "value", "Enter");
        const selector = str(args, "selector");
        if (selector) await target.press(selector, key);
        else await target.keyboard.press(key);
        return `pressed ${key}`;
      }
      case "screenshot": {
        const dest = resolveUserPath(ctx.cwd, str(args, "path", ".mox/screenshot.png"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await target.screenshot({ path: dest, fullPage: true });
        return `screenshot saved to ${dest}`;
      }
      case "close": {
        await closeBrowser();
        return "browser closed";
      }
      default:
        throw new ToolError(`unknown action "${action}"`);
    }
  },
};

export const browserTools = [browserTool];
