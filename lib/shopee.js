const SHOPEE_LIMIT_MAX = 100;
const SHOPEE_MAX_PAGES = 120;

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

async function scanShopee(params, context) {
  const { signal, emit } = context;
  const parsed = parseShopeeUrl(params.url);
  const jar = createCookieJar();

  emit("STARTED", { shopUrl: parsed.shopUrl });
  emit("LOG", { message: "Dang khoi tao phien Shopee tren Vercel..." });

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

  while (!signal.aborted && page < SHOPEE_MAX_PAGES) {
    if (params.maxItems > 0 && items.length >= params.maxItems) {
      break;
    }
    page += 1;
    emit("LOG", { message: `Dang tai Shopee page ${page} bang API public...` });

    const data = await fetchShopeeSearchPage(shop.shopid, offset, params.limit, { jar, signal });
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
    if (emptyStreak >= 2 || (total && items.length >= total)) {
      break;
    }

    offset += params.limit;
    await sleep(params.delayMs, signal);
  }

  emit("DONE", { items, shop, stopped: signal.aborted });
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
    return { username: "", shopId, shopUrl: `https://shopee.vn/shop/${shopId}` };
  }

  const productMatch = url.pathname.match(/(?:-i\.|\.i\.)(\d+)\.(\d+)/);
  if (productMatch) {
    const shopId = Number(productMatch[1]);
    return { username: "", shopId, shopUrl: `https://shopee.vn/shop/${shopId}` };
  }

  const username = decodeURIComponent(firstSegment);
  return { username, shopId: null, shopUrl: `https://shopee.vn/${encodeURIComponent(username)}` };
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
      const response = await fetchJsonWithCookies(url, { ...context, headers: shopeeApiHeaders });
      const shop = normalizeShopeeShop(response, parsed);
      if (shop?.shopid) {
        return shop;
      }
    } catch (error) {
      emit("LOG", { message: `Shop detail API chua thanh cong: ${error.message}` });
    }
  }

  throw new Error("Khong xac dinh duoc shopid. Shopee co the dang chan request tu Vercel.");
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
  const roots = [payload?.data, payload?.shop_detail, payload?.response, payload].filter(Boolean);
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
    if (Array.isArray(root)) {
      return root.map((item) => item?.item_basic || item?.item_card_displayed_asset || item?.item || item).filter(Boolean);
    }
  }
  return [];
}

function extractShopeeTotal(payload) {
  return toNumber(payload?.data?.total_count || payload?.data?.total || payload?.total_count || payload?.total || payload?.response?.total_count);
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
  const headers = { ...(options.headers || {}) };
  const cookieHeader = options.jar?.header();
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  const response = await fetch(url, { headers, redirect: "follow", signal: options.signal });
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
        if (index > 0) {
          values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
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
  return value ? value.split(/,(?=[^;,]+=)/g) : [];
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
  return Math.round(number > 100000000 ? number / 100000 : number);
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

module.exports = {
  scanShopee,
  toPositiveInt,
  clamp,
  SHOPEE_LIMIT_MAX
};
