const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 5177);
const PUBLIC_DIR = path.join(__dirname, "public");
const SHOPEE_LIMIT_MAX = 100;
const SHOPEE_MAX_PAGES = 200;
const PLAYWRIGHT_PACKAGE_PATH = process.env.PLAYWRIGHT_PACKAGE_PATH || "C:/Users/Admin/AppData/Local/ms-playwright-go/1.57.0/package";
const CHROME_PATH = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOPEE_PROFILE_DIR = path.join(__dirname, ".shopee-profile");
let shopeeSessionContext = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const browserHeaders = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
};

const shopeeApiHeaders = {
  ...browserHeaders,
  "accept": "application/json, text/plain, */*",
  "content-type": "application/json",
  "referer": "https://shopee.vn/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "x-api-source": "pc",
  "x-requested-with": "XMLHttpRequest"
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, name: "Competitor Analysis Dashboard" });
      return;
    }

    if (requestUrl.pathname === "/api/fetch") {
      await handleFetchProxy(requestUrl, res);
      return;
    }

    if (requestUrl.pathname === "/api/shopee/scan") {
      await handleShopeeScan(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/api/shopee/session/open") {
      await handleShopeeSessionOpen(res);
      return;
    }

    if (requestUrl.pathname === "/api/shopee/session/close") {
      await handleShopeeSessionClose(res);
      return;
    }

    await serveStatic(requestUrl.pathname, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`Competitor Analysis Dashboard running at http://localhost:${PORT}`);
});

async function serveStatic(rawPathname, res) {
  let pathname = decodeURIComponent(rawPathname);
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      const indexPath = path.join(PUBLIC_DIR, "index.html");
      const data = await fs.readFile(indexPath);
      res.writeHead(200, {
        "content-type": MIME_TYPES[".html"],
        "cache-control": "no-store"
      });
      res.end(data);
      return;
    }
    throw error;
  }
}

async function handleFetchProxy(requestUrl, res) {
  const target = requestUrl.searchParams.get("url") || "";
  let url;
  try {
    url = new URL(target);
  } catch {
    sendJson(res, 400, { ok: false, error: "URL khong hop le." });
    return;
  }

  if (!isAllowedThienLongHost(url)) {
    sendJson(res, 403, { ok: false, error: "Proxy chi cho phep thienlong.vn." });
    return;
  }

  const upstream = await fetch(url.href, {
    headers: {
      ...browserHeaders,
      referer: "https://thienlong.vn/"
    },
    redirect: "follow"
  });

  const text = await upstream.text();
  res.writeHead(upstream.ok ? 200 : upstream.status, {
    "content-type": upstream.headers.get("content-type") || "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-upstream-status": String(upstream.status)
  });
  res.end(text);
}

async function handleShopeeScan(req, res, requestUrl) {
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no"
  });

  const abortController = new AbortController();
  req.on("close", () => abortController.abort());

  const emit = (type, payload = {}) => {
    if (res.destroyed) {
      return;
    }
    res.write(`${JSON.stringify({ type, ...payload })}\n`);
  };

  try {
    const params = {
      url: requestUrl.searchParams.get("url") || "",
      maxItems: toPositiveInt(requestUrl.searchParams.get("maxItems")),
      limit: clamp(toPositiveInt(requestUrl.searchParams.get("limit")) || 60, 10, SHOPEE_LIMIT_MAX),
      delayMs: clamp(toPositiveInt(requestUrl.searchParams.get("delayMs")) || 700, 250, 10000)
    };
    await scanShopee(params, { signal: abortController.signal, emit });
  } catch (error) {
    if (!abortController.signal.aborted) {
      emit("ERROR", { error: error.message || String(error) });
    }
  } finally {
    res.end();
  }
}

async function handleShopeeSessionOpen(res) {
  const context = await openShopeeSession();
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  await page.goto("https://shopee.vn", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.bringToFront().catch(() => {});
  sendJson(res, 200, {
    ok: true,
    message: "Da mo Chrome profile rieng cho Shopee."
  });
}

async function handleShopeeSessionClose(res) {
  if (shopeeSessionContext) {
    await shopeeSessionContext.close().catch(() => {});
    shopeeSessionContext = null;
  }
  sendJson(res, 200, { ok: true });
}

async function scanShopee(params, context) {
  const { signal, emit } = context;
  const parsed = parseShopeeUrl(params.url);
  const jar = createCookieJar();

  emit("STARTED", { shopUrl: parsed.shopUrl });
  emit("LOG", { message: "Dang khoi tao phien Shopee local..." });

  await fetchWithCookies(parsed.shopUrl, {
    headers: {
      ...browserHeaders,
      referer: "https://shopee.vn/"
    },
    jar,
    signal
  }).catch(() => null);

  const shop = await resolveShopeeShop(parsed, { jar, signal, emit });
  emit("SHOP_INFO", { shop });

  const items = [];
  const seen = new Set();
  let offset = 0;
  let page = 0;
  let total = shop.item_count || null;
  let emptyStreak = 0;

  try {
    while (!signal.aborted && page < SHOPEE_MAX_PAGES) {
      if (params.maxItems > 0 && items.length >= params.maxItems) {
        break;
      }
      page += 1;
      emit("LOG", { message: `Dang tai Shopee page ${page} bang API...` });

      const data = await fetchShopeeSearchPage(shop.shopid, offset, params.limit, {
        jar,
        signal
      });
      const rawItems = extractShopeeItems(data.json);
      const pageTotal = extractShopeeTotal(data.json);
      if (pageTotal && !total) {
        total = pageTotal;
        emit("TOTAL", { total });
      }

      let added = 0;
      for (const raw of rawItems) {
        const item = normalizeShopeeItem(raw, shop);
        if (!item || !item.itemid || !item.shopid) {
          continue;
        }
        const key = `${item.shopid}_${item.itemid}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        items.push(item);
        added += 1;
        if (params.maxItems > 0 && items.length >= params.maxItems) {
          break;
        }
      }

      emit("PAGE_DONE", {
        page,
        count: items.length,
        added,
        total,
        source: data.source
      });

      if (rawItems.length === 0 || added === 0) {
        emptyStreak += 1;
      } else {
        emptyStreak = 0;
      }
      if (emptyStreak >= 2) {
        emit("LOG", { message: "Hai page lien tiep khong co san pham moi, dung quet." });
        break;
      }
      if (total && items.length >= total) {
        break;
      }

      offset += params.limit;
      await sleep(params.delayMs, signal);
    }
  } catch (error) {
    if (items.length > 0 || signal.aborted) {
      throw error;
    }
    emit("LOG", { message: `API Shopee bi chan (${error.message}). Chuyen sang DOM browser fallback...` });
    const fallback = await scanShopeeWithBrowser(parsed, shop, params, { signal, emit });
    emit("DONE", {
      items: fallback.items,
      shop,
      stopped: signal.aborted
    });
    return;
  }

  emit("DONE", {
    items,
    shop,
    stopped: signal.aborted
  });
}

async function scanShopeeWithBrowser(parsed, shop, params, context) {
  const { signal, emit } = context;
  const output = [];
  const seen = new Set();
  let pageIndex = 0;
  let emptyStreak = 0;
  const browserHandle = await getShopeeBrowserContext();

  try {
    const page = await browserHandle.context.newPage();
    page.setDefaultTimeout(35000);
    const baseUrl = parsed.username
      ? `https://shopee.vn/${encodeURIComponent(parsed.username)}`
      : `https://shopee.vn/shop/${shop.shopid}`;

    while (!signal.aborted && pageIndex < SHOPEE_MAX_PAGES) {
      if (params.maxItems > 0 && output.length >= params.maxItems) {
        break;
      }

      pageIndex += 1;
      const url = buildShopeeDomPageUrl(baseUrl, pageIndex - 1);
      emit("LOG", { message: `DOM browser page ${pageIndex}: ${url}` });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);

      const data = await page.evaluate(extractShopeeDomItemsInPage, {
        scrollSteps: 12,
        scrollDelay: 450
      });

      if (data.loginRequired) {
        throw new Error("Shopee yeu cau dang nhap trong phien browser local. Bam nut 'Phien Shopee' tren dashboard, dang nhap trong cua so Chrome vua mo, roi chay lai.");
      }

      let added = 0;
      for (const raw of data.items || []) {
        const item = normalizeShopeeItem(raw, shop);
        if (!item || !item.itemid || !item.shopid) {
          continue;
        }
        const key = `${item.shopid}_${item.itemid}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        output.push(item);
        added += 1;
        if (params.maxItems > 0 && output.length >= params.maxItems) {
          break;
        }
      }

      emit("PAGE_DONE", {
        page: pageIndex,
        count: output.length,
        added,
        total: shop.item_count || null,
        source: "dom-browser"
      });

      if (added === 0) {
        emptyStreak += 1;
      } else {
        emptyStreak = 0;
      }
      if (emptyStreak >= 2) {
        break;
      }
      if (shop.item_count && output.length >= shop.item_count) {
        break;
      }
      await sleep(params.delayMs, signal);
    }
  } finally {
    if (browserHandle.closeAfterUse) {
      await browserHandle.context.close().catch(() => {});
    }
  }

  return { items: output };
}

async function openShopeeSession() {
  if (shopeeSessionContext) {
    return shopeeSessionContext;
  }
  const playwright = require(PLAYWRIGHT_PACKAGE_PATH);
  const executablePath = await fileExists(CHROME_PATH) ? CHROME_PATH : undefined;
  shopeeSessionContext = await playwright.chromium.launchPersistentContext(SHOPEE_PROFILE_DIR, {
    headless: false,
    executablePath,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1366, height: 900 },
    userAgent: browserHeaders["user-agent"],
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"]
  });
  shopeeSessionContext.on("close", () => {
    shopeeSessionContext = null;
  });
  return shopeeSessionContext;
}

async function getShopeeBrowserContext() {
  if (shopeeSessionContext) {
    return { context: shopeeSessionContext, closeAfterUse: false };
  }
  const playwright = require(PLAYWRIGHT_PACKAGE_PATH);
  const executablePath = await fileExists(CHROME_PATH) ? CHROME_PATH : undefined;
  const context = await playwright.chromium.launchPersistentContext(SHOPEE_PROFILE_DIR, {
    headless: true,
    executablePath,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1366, height: 900 },
    userAgent: browserHeaders["user-agent"],
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox"]
  });
  return { context, closeAfterUse: true };
}

function buildShopeeDomPageUrl(baseUrl, pageParam) {
  const url = new URL(baseUrl);
  if (pageParam > 0) {
    url.searchParams.set("page", String(pageParam));
    if (!url.searchParams.has("sortBy")) {
      url.searchParams.set("sortBy", "ctime");
    }
    if (!url.searchParams.has("order")) {
      url.searchParams.set("order", "desc");
    }
  } else {
    url.searchParams.delete("page");
  }
  return url.href;
}

function extractShopeeDomItemsInPage(config) {
  return new Promise(async (resolve) => {
    const { scrollSteps = 10, scrollDelay = 500 } = config || {};
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

    function cleanText(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function parseVnPrice(value) {
      const digits = String(value || "").replace(/[^\d]/g, "");
      if (!digits) {
        return null;
      }
      const number = Number.parseInt(digits, 10);
      return Number.isFinite(number) ? number : null;
    }

    function addUniqueNumber(values, value) {
      if (value == null || !Number.isFinite(value) || value < 1000 || values.includes(value)) {
        return;
      }
      values.push(value);
    }

    function extractPriceNumbers(text) {
      const source = cleanText(text);
      const values = [];
      const patterns = [
        /[₫đ]\s*([\d][\d.,]*)\s*(?:[-–—~]\s*[₫đ]?\s*([\d][\d.,]*))?/gi,
        /([\d][\d.,]*)\s*[₫đ]\s*(?:[-–—~]\s*([\d][\d.,]*)\s*[₫đ]?)?/gi
      ];
      for (const regex of patterns) {
        let match;
        while ((match = regex.exec(source))) {
          addUniqueNumber(values, parseVnPrice(match[1]));
          addUniqueNumber(values, parseVnPrice(match[2]));
        }
      }
      return values;
    }

    function parseAbbrevNumber(value) {
      const match = String(value || "").match(/([\d][\d.,]*)\s*\+?\s*([kKmM])?/);
      if (!match) {
        return null;
      }
      const raw = match[1];
      const suffix = match[2];
      let number;
      if (suffix && raw.includes(",")) {
        number = Number.parseFloat(raw.replace(/\./g, "").replace(",", "."));
      } else if (suffix && /^\d+\.\d{1,2}$/.test(raw)) {
        number = Number.parseFloat(raw);
      } else {
        number = Number.parseInt(raw.replace(/[.,]/g, ""), 10);
      }
      if (!Number.isFinite(number)) {
        return null;
      }
      if (/k/i.test(suffix || "")) {
        number *= 1000;
      }
      if (/m/i.test(suffix || "")) {
        number *= 1000000;
      }
      return Math.round(number);
    }

    function imageFromElement(img) {
      const src = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
      const match = src.match(/\/file\/([a-zA-Z0-9_-]+)/);
      if (match) {
        return match[1];
      }
      return src && !/^data:/i.test(src) ? src : "";
    }

    const waitStart = Date.now();
    while (Date.now() - waitStart < 15000) {
      if (document.querySelector('a[href*="-i."], a[href*=".i."]')) {
        break;
      }
      await sleep(400);
    }

    let lastHeight = 0;
    for (let step = 1; step <= scrollSteps; step += 1) {
      const height = document.documentElement.scrollHeight || document.body.scrollHeight;
      window.scrollTo(0, Math.round(height * (step / scrollSteps)));
      await sleep(scrollDelay);
      if (height === lastHeight && step > 4) {
        break;
      }
      lastHeight = height;
    }
    window.scrollTo(0, 0);
    await sleep(400);

    const bodyText = cleanText(document.body?.innerText || document.body?.textContent || "");
    const loginRequired = /chưa đăng nhập|dang nhap de tiep tuc|đăng nhập để tiếp tục|trang không khả dụng|trang khong kha dung/i.test(bodyText);
    const productMap = new Map();
    document.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const match = href.match(/(?:-i\.|\.i\.)(\d+)\.(\d+)(?:[/?#]|$)/);
      if (!match) {
        return;
      }
      const shopid = Number.parseInt(match[1], 10);
      const itemid = Number.parseInt(match[2], 10);
      if (!shopid || !itemid) {
        return;
      }
      const key = `${shopid}_${itemid}`;
      if (!productMap.has(key)) {
        productMap.set(key, { anchor, shopid, itemid });
      }
    });

    const items = [];
    for (const { anchor, shopid, itemid } of productMap.values()) {
      let card = anchor;
      for (let depth = 0; depth < 14; depth += 1) {
        const parent = card.parentElement;
        if (!parent) {
          break;
        }
        const productAnchors = Array.from(parent.querySelectorAll('a[href*="-i."], a[href*=".i."]'))
          .filter((item) => /(?:-i\.|\.i\.)\d+\.\d+/.test(item.getAttribute("href") || ""));
        if (productAnchors.length >= 2 && card !== anchor) {
          break;
        }
        card = parent;
        if (parent.tagName === "LI" || parent.getAttribute("data-sqe") === "item") {
          break;
        }
      }

      const img = card.querySelector("img");
      let name = cleanText(img?.getAttribute("alt") || "");
      if (!name) {
        name = cleanText(card.querySelector('[data-sqe="name"]')?.textContent || "");
      }
      if (!name) {
        name = cleanText(anchor.getAttribute("title") || anchor.getAttribute("aria-label") || "");
      }
      if (!name) {
        const texts = Array.from(card.querySelectorAll("div, span")).map((node) => cleanText(node.textContent))
          .filter((text) => text.length > 8 && !/[₫đ%]|đã\s*bán/i.test(text));
        name = texts.sort((a, b) => b.length - a.length)[0] || "";
      }
      if (!name) {
        continue;
      }

      const cardText = cleanText(card.textContent);
      const prices = extractPriceNumbers(cardText);
      const discountMatch = cardText.match(/-\s*(\d{1,2})\s*%/) || cardText.match(/\b(\d{1,2})\s*%\b/);
      const soldMatch = cardText.match(/Đã\s*bán\s*([\d][\d.,]*\s*[kKmM]?\+?)/i) ||
        cardText.match(/([\d][\d.,]*\s*[kKmM]?\+?)\s*đã\s*bán/i);
      const priceMin = prices.length ? Math.min(...prices) : null;
      const priceMax = prices.length ? Math.max(...prices) : null;

      items.push({
        source: "Shopee",
        itemid,
        shopid,
        name,
        category: "Tất cả sản phẩm",
        price_min: priceMin,
        price_max: priceMax,
        price: priceMin,
        original_price_min: null,
        original_price_max: null,
        price_before_discount: null,
        discount_percent: discountMatch ? Number.parseInt(discountMatch[1], 10) : null,
        historical_sold: soldMatch ? parseAbbrevNumber(soldMatch[1]) : null,
        rating_star: null,
        review_count: null,
        stock: null,
        liked_count: null,
        image: imageFromElement(img),
        _source: "dom-browser"
      });
    }

    resolve({ items, loginRequired });
  });
}

function parseShopeeUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("Link Shopee khong hop le.");
  }

  const host = url.hostname.toLowerCase();
  if (host !== "shopee.vn" && !host.endsWith(".shopee.vn")) {
    throw new Error("Link phai thuoc mien shopee.vn.");
  }

  const firstSegment = url.pathname.replace(/^\/+/, "").split("/")[0];
  if (!firstSegment) {
    throw new Error("Khong tim thay username hoac shopId trong link.");
  }

  if (firstSegment === "shop") {
    const shopId = Number(url.pathname.split("/")[2]);
    if (!Number.isFinite(shopId) || shopId <= 0) {
      throw new Error("Thieu shopId trong link /shop/...");
    }
    return {
      username: "",
      shopId,
      shopUrl: `https://shopee.vn/shop/${shopId}`
    };
  }

  const productMatch = url.pathname.match(/(?:-i\.|\.i\.)(\d+)\.(\d+)/);
  if (productMatch) {
    const shopId = Number(productMatch[1]);
    return {
      username: "",
      shopId,
      shopUrl: `https://shopee.vn/shop/${shopId}`
    };
  }

  const username = decodeURIComponent(firstSegment);
  return {
    username,
    shopId: null,
    shopUrl: `https://shopee.vn/${encodeURIComponent(username)}`
  };
}

async function resolveShopeeShop(parsed, context) {
  const { emit } = context;
  const candidates = [];
  if (parsed.username) {
    candidates.push(`https://shopee.vn/api/v4/shop/get_shop_detail?username=${encodeURIComponent(parsed.username)}`);
  }
  if (parsed.shopId) {
    candidates.push(`https://shopee.vn/api/v4/shop/get_shop_detail?shopid=${parsed.shopId}`);
  }

  for (const url of candidates) {
    try {
      const response = await fetchJsonWithCookies(url, {
        ...context,
        headers: shopeeApiHeaders
      });
      const shop = normalizeShopeeShop(response, parsed);
      if (shop && shop.shopid) {
        return shop;
      }
    } catch (error) {
      emit("LOG", { message: `Shop detail API chua thanh cong: ${error.message}` });
    }
  }

  const html = await fetchWithCookies(parsed.shopUrl, {
    ...context,
    headers: {
      ...browserHeaders,
      referer: "https://shopee.vn/"
    }
  }).then((response) => response.text()).catch(() => "");
  const fallbackId = parsed.shopId || readFirstNumber(html, /"shopid"\s*:\s*(\d+)/i) || readFirstNumber(html, /shopid[=:](\d+)/i);

  if (!fallbackId) {
    throw new Error("Khong xac dinh duoc shopid. Shopee co the dang chan request local.");
  }

  return {
    shopid: fallbackId,
    name: parsed.username || `shop-${fallbackId}`,
    account: parsed.username || "",
    item_count: null,
    follower_count: null
  };
}

async function fetchShopeeSearchPage(shopId, offset, limit, context) {
  const candidates = [
    {
      source: "search/search_items",
      url: `https://shopee.vn/api/v4/search/search_items?by=relevancy&limit=${limit}&match_id=${shopId}&newest=${offset}&order=desc&page_type=shop&scenario=PAGE_OTHERS&version=2`
    },
    {
      source: "shop/search_items",
      url: `https://shopee.vn/api/v4/shop/search_items?limit=${limit}&offset=${offset}&shopid=${shopId}&sort_by=ctime`
    }
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const json = await fetchJsonWithCookies(candidate.url, {
        ...context,
        headers: {
          ...shopeeApiHeaders,
          referer: `https://shopee.vn/shop/${shopId}`
        }
      });
      const items = extractShopeeItems(json);
      if (Array.isArray(items)) {
        return { source: candidate.source, json };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Khong doc duoc du lieu san pham Shopee.");
}

function normalizeShopeeShop(payload, parsed) {
  const roots = [
    payload?.data,
    payload?.shop_detail,
    payload?.response,
    payload
  ].filter(Boolean);

  for (const root of roots) {
    const shop = root.shop || root.account || root;
    const shopid = toNumber(shop.shopid || shop.shop_id || root.shopid || root.shop_id || parsed.shopId);
    if (!shopid) {
      continue;
    }
    return {
      shopid,
      name: cleanText(shop.name || root.name || parsed.username || `shop-${shopid}`),
      account: cleanText(shop.username || shop.account?.username || parsed.username || ""),
      item_count: toNumber(shop.item_count || root.item_count || root.total_count),
      follower_count: toNumber(shop.follower_count || root.follower_count)
    };
  }

  return null;
}

function extractShopeeItems(payload) {
  const sectionItems = Array.isArray(payload?.data?.sections)
    ? payload.data.sections.flatMap((section) => section?.data?.item || section?.data?.items || [])
    : null;
  const roots = [
    payload?.data?.items,
    payload?.items,
    sectionItems,
    payload?.data?.item_cards,
    payload?.response?.items
  ].filter(Boolean);

  for (const root of roots) {
    if (!Array.isArray(root)) {
      continue;
    }
    return root.map((item) => item?.item_basic || item?.item_card_displayed_asset || item?.item || item).filter(Boolean);
  }

  return [];
}

function extractShopeeTotal(payload) {
  return toNumber(
    payload?.data?.total_count ||
    payload?.data?.total ||
    payload?.total_count ||
    payload?.total ||
    payload?.response?.total_count
  );
}

function normalizeShopeeItem(raw, shop) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const itemid = toNumber(raw.itemid || raw.item_id || raw.item?.itemid);
  const shopid = toNumber(raw.shopid || raw.shop_id || shop.shopid);
  const priceMin = normalizeShopeePrice(raw.price_min ?? raw.price ?? raw.price_min_before_discount);
  const priceMax = normalizeShopeePrice(raw.price_max ?? raw.price ?? raw.price_max_before_discount);
  const originalMin = normalizeShopeePrice(raw.price_min_before_discount ?? raw.price_before_discount ?? raw.original_price_min);
  const originalMax = normalizeShopeePrice(raw.price_max_before_discount ?? raw.price_before_discount ?? raw.original_price_max);

  return {
    source: "Shopee",
    itemid,
    shopid,
    name: cleanText(raw.name || raw.title || ""),
    shop_name: cleanText(raw.shop_name || shop.name || ""),
    category: cleanText(raw.category_name || raw.catname || raw.category || "Tat ca san pham"),
    brand: cleanText(raw.brand || raw.brand_name || ""),
    price_min: priceMin,
    price_max: priceMax || priceMin,
    original_price_min: originalMin,
    original_price_max: originalMax || originalMin,
    discount_percent: parseDiscount(raw.discount) || parseDiscount(raw.raw_discount) || computeDiscount(priceMin, originalMin),
    historical_sold: toNumber(raw.historical_sold ?? raw.sold ?? raw.global_sold_count),
    rating_star: toNumber(raw.item_rating?.rating_star ?? raw.rating_star),
    review_count: toNumber(Array.isArray(raw.item_rating?.rating_count) ? raw.item_rating.rating_count[0] : raw.review_count),
    stock: toNumber(raw.stock),
    liked_count: toNumber(raw.liked_count),
    image: raw.image || raw.image_id || raw.cover,
    capture_at: new Date().toISOString()
  };
}

async function fetchJsonWithCookies(url, options) {
  const response = await fetchWithCookies(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Shopee tra ve du lieu khong phai JSON.");
  }
}

async function fetchWithCookies(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };
  const cookieHeader = options.jar?.header();
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }

  const response = await fetch(url, {
    headers,
    redirect: "follow",
    signal: options.signal
  });

  options.jar?.store(response.headers);
  return response;
}

function createCookieJar() {
  const values = new Map();
  return {
    store(headers) {
      const cookies = readSetCookie(headers);
      for (const line of cookies) {
        const pair = line.split(";")[0];
        const index = pair.indexOf("=");
        if (index <= 0) {
          continue;
        }
        values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header() {
      return Array.from(values.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
    }
  };
}

function readSetCookie(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const value = headers.get("set-cookie");
  if (!value) {
    return [];
  }
  return value.split(/,(?=[^;,]+=)/g);
}

function isAllowedThienLongHost(url) {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && (host === "thienlong.vn" || host.endsWith(".thienlong.vn"));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function toPositiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeShopeePrice(value) {
  const number = toNumber(value);
  if (number === null) {
    return null;
  }
  if (number > 100000000) {
    return Math.round(number / 100000);
  }
  return Math.round(number);
}

function parseDiscount(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.min(99, Math.round(number));
}

function computeDiscount(price, original) {
  if (!price || !original || original <= price) {
    return null;
  }
  return Math.round(((original - price) / original) * 100);
}

function readFirstNumber(text, regex) {
  const match = String(text || "").match(regex);
  return match ? toNumber(match[1]) : null;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    }, { once: true });
  });
}
