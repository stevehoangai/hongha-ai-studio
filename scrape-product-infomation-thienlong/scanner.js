const SOURCE = "thienlong.vn";
const DEFAULT_START_URL = "https://thienlong.vn/products/";
const STORAGE_KEY = "thienlong_scanner_rows_v1";
const MAX_TABLE_PREVIEW = 500;
const EMPTY_PAGE_STREAK_LIMIT = 3;

const EXPORT_COLUMNS = [
  ["source", "Nguồn"],
  ["category", "Danh mục"],
  ["breadcrumbs", "Breadcrumbs"],
  ["name", "Tên sản phẩm"],
  ["brand", "Thương hiệu"],
  ["sku", "Mã sản phẩm"],
  ["status", "Tình trạng"],
  ["price", "Giá bán"],
  ["original_price", "Giá gốc"],
  ["discount_percent", "% giảm"],
  ["public_sold_count", "Số đã bán công khai"],
  ["colors", "Màu sắc / phân loại"],
  ["product_url", "Link sản phẩm"],
  ["collection_url", "Link danh mục"],
  ["list_page_url", "Trang list"],
  ["image_urls", "Hình ảnh"],
  ["specifications", "Thông số kỹ thuật"],
  ["description_text", "Mô tả"],
  ["captured_at", "Thời điểm quét"],
  ["detail_scanned_at", "Thời điểm quét chi tiết"],
  ["notes", "Ghi chú"]
];

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
]);

const els = {};
const state = {
  running: false,
  stopRequested: false,
  products: [],
  seenProductUrls: new Set(),
  metrics: {
    collections: 0,
    details: 0,
    errors: 0
  },
  saveTimer: 0
};

init();

async function init() {
  bindElements();
  bindEvents();
  renderAll();
  await restoreRows();
}

function bindElements() {
  [
    "startUrl",
    "maxPages",
    "maxProducts",
    "delayMs",
    "scanDetails",
    "startBtn",
    "stopBtn",
    "exportXlsxBtn",
    "exportCsvBtn",
    "clearBtn",
    "statusPill",
    "collectionCount",
    "productCount",
    "detailCount",
    "errorCount",
    "currentTask",
    "capturedAt",
    "progressBar",
    "logList",
    "productRows",
    "tableNote"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.startBtn.addEventListener("click", () => {
    startScan().catch((error) => {
      state.running = false;
      state.stopRequested = false;
      state.metrics.errors += 1;
      setStatus("Có lỗi", "error");
      setTask(error.message || String(error));
      log(`Lỗi tổng: ${error.message || error}`);
      renderAll();
    });
  });

  els.stopBtn.addEventListener("click", () => {
    state.stopRequested = true;
    setTask("Đang dừng sau request hiện tại...");
  });

  els.exportXlsxBtn.addEventListener("click", exportXlsx);
  els.exportCsvBtn.addEventListener("click", exportCsv);
  els.clearBtn.addEventListener("click", clearRows);
}

async function restoreRows() {
  if (!hasChromeStorage()) {
    return;
  }

  const saved = await chrome.storage.local.get(STORAGE_KEY);
  const rows = Array.isArray(saved[STORAGE_KEY]) ? saved[STORAGE_KEY] : [];
  if (rows.length === 0) {
    return;
  }

  state.products = rows;
  state.seenProductUrls = new Set(rows.map((row) => row.product_url).filter(Boolean));
  log(`Đã khôi phục ${rows.length} sản phẩm từ lần chạy trước.`);
  renderAll();
}

async function clearRows() {
  if (state.running) {
    return;
  }

  state.products = [];
  state.seenProductUrls = new Set();
  state.metrics = { collections: 0, details: 0, errors: 0 };
  if (hasChromeStorage()) {
    await chrome.storage.local.remove(STORAGE_KEY);
  }
  setTask("Đã xóa bảng");
  setProgress(0);
  renderAll();
}

async function startScan() {
  if (state.running) {
    return;
  }

  const settings = readSettings();
  resetForRun();
  state.running = true;
  setStatus("Đang quét", "running");
  setTask("Đang tải trang bắt đầu...");
  renderAll();

  try {
    const firstDoc = await fetchDocument(settings.startUrl);
    const startUrl = normalizeAbsoluteUrl(settings.startUrl, DEFAULT_START_URL);

    if (isProductDetailUrl(startUrl)) {
      await scanSingleProduct(firstDoc, startUrl);
    } else {
      const collections = buildCollectionQueue(firstDoc, startUrl);
      state.metrics.collections = collections.length;
      log(`Tìm thấy ${collections.length} danh mục/collection để quét.`);
      renderMetrics();

      if (collections.length === 0) {
        const fallbackName = getCollectionName(firstDoc, startUrl);
        await crawlCollection({ name: fallbackName, url: startUrl, firstDoc }, settings);
      } else {
        collections[0].firstDoc = samePath(collections[0].url, startUrl) ? firstDoc : null;
        for (const collection of collections) {
          if (shouldStop(settings)) {
            break;
          }
          await crawlCollection(collection, settings);
        }
      }

      if (settings.scanDetails && !state.stopRequested && state.products.length > 0) {
        await scanDetails(settings);
      }
    }

    state.running = false;
    const finalStatus = state.stopRequested ? "Đã dừng" : "Hoàn tất";
    setStatus(finalStatus, state.metrics.errors > 0 ? "error" : "");
    setTask(`${finalStatus}: ${state.products.length} sản phẩm.`);
    setProgress(100);
    await saveRowsNow();
  } finally {
    state.running = false;
    state.stopRequested = false;
    renderAll();
  }
}

function readSettings() {
  const startUrl = normalizeAbsoluteUrl(els.startUrl.value.trim() || DEFAULT_START_URL, DEFAULT_START_URL);
  const maxPages = readPositiveInt(els.maxPages.value);
  const maxProducts = readPositiveInt(els.maxProducts.value);
  const delayMs = Math.max(500, readPositiveInt(els.delayMs.value) || 2000);

  return {
    startUrl,
    maxPages,
    maxProducts,
    delayMs,
    scanDetails: els.scanDetails.checked
  };
}

function resetForRun() {
  state.stopRequested = false;
  state.products = [];
  state.seenProductUrls = new Set();
  state.metrics = { collections: 0, details: 0, errors: 0 };
  els.logList.replaceChildren();
  setProgress(0);
}

async function scanSingleProduct(doc, productUrl) {
  const detail = parseProductDetail(doc, productUrl);
  addOrMergeProduct({
    source: SOURCE,
    product_url: productUrl,
    captured_at: new Date().toISOString(),
    ...detail
  });
  state.metrics.details = 1;
  log("Đã quét 1 trang sản phẩm.");
}

function buildCollectionQueue(doc, startUrl) {
  if (isCollectionUrl(startUrl)) {
    return [{ name: getCollectionName(doc, startUrl), url: stripHash(startUrl), firstDoc: doc }];
  }

  const links = extractCollectionLinks(doc, startUrl);
  if (links.length > 0) {
    return links;
  }

  return [];
}

async function crawlCollection(collection, settings) {
  const collectionUrl = stripHash(collection.url);
  const maxPages = settings.maxPages > 0 ? settings.maxPages : Number.POSITIVE_INFINITY;
  let detectedLastPage = null;
  let emptyPageStreak = 0;
  let page = 1;

  log(`Quét danh mục: ${collection.name}`);

  while (page <= maxPages && !shouldStop(settings)) {
    const pageUrl = makePageUrl(collectionUrl, page);
    setTask(`Danh mục "${collection.name}", trang ${page}`);
    setSoftProgress(settings);

    let doc;
    try {
      doc = page === 1 && collection.firstDoc ? collection.firstDoc : await fetchDocument(pageUrl);
    } catch (error) {
      state.metrics.errors += 1;
      log(`Không tải được ${pageUrl}: ${error.message || error}`);
      break;
    }

    if (detectedLastPage === null) {
      detectedLastPage = detectLastPage(doc, pageUrl);
    }

    const rows = parseCollectionProducts(doc, pageUrl, collection.name, collectionUrl);
    let addedCount = 0;
    for (const row of rows) {
      if (shouldStop(settings)) {
        break;
      }
      if (addOrMergeProduct(row)) {
        addedCount += 1;
      }
    }

    if (rows.length === 0) {
      emptyPageStreak += 1;
      log(`Trang ${page} không có sản phẩm đọc được.`);
    } else {
      emptyPageStreak = 0;
      log(`Trang ${page}: đọc ${rows.length}, thêm mới ${addedCount}.`);
    }

    renderAll();
    scheduleSaveRows();

    if (emptyPageStreak >= EMPTY_PAGE_STREAK_LIMIT) {
      log(`Dừng danh mục "${collection.name}" vì ${EMPTY_PAGE_STREAK_LIMIT} trang liên tiếp không có sản phẩm.`);
      break;
    }

    if (settings.maxProducts > 0 && state.products.length >= settings.maxProducts) {
      log(`Đã đạt giới hạn ${settings.maxProducts} sản phẩm.`);
      break;
    }

    if (settings.maxPages === 0) {
      if (detectedLastPage && page >= detectedLastPage) {
        break;
      }
      if (page > 1 && addedCount === 0) {
        break;
      }
      if (!detectedLastPage && rows.length === 0) {
        break;
      }
    }

    page += 1;
    if (page <= maxPages && !shouldStop(settings)) {
      await sleep(settings.delayMs);
    }
  }
}

async function scanDetails(settings) {
  const total = state.products.length;
  log(`Bắt đầu quét chi tiết ${total} sản phẩm.`);

  for (let index = 0; index < state.products.length; index += 1) {
    if (shouldStop(settings)) {
      break;
    }

    const product = state.products[index];
    if (!product.product_url || product.detail_scanned_at) {
      continue;
    }

    setTask(`Chi tiết ${index + 1}/${total}: ${product.name || product.product_url}`);
    setProgress(Math.round(((index + 1) / total) * 100));

    try {
      const doc = await fetchDocument(product.product_url);
      const detail = parseProductDetail(doc, product.product_url);
      mergeProduct(product, detail);
      product.detail_scanned_at = new Date().toISOString();
      state.metrics.details += 1;
    } catch (error) {
      product.notes = appendNote(product.notes, `detail_error: ${error.message || error}`);
      state.metrics.errors += 1;
      log(`Lỗi chi tiết ${product.product_url}: ${error.message || error}`);
    }

    renderAll();
    scheduleSaveRows();
    if (index < state.products.length - 1 && !shouldStop(settings)) {
      await sleep(settings.delayMs);
    }
  }
}

async function fetchDocument(url) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  const html = await response.text();
  return new DOMParser().parseFromString(html, "text/html");
}

function extractCollectionLinks(doc, baseUrl) {
  const seen = new Set();
  const links = [];

  doc.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    const url = normalizeAbsoluteUrl(href, baseUrl);
    if (!url || !isCollectionUrl(url)) {
      return;
    }

    const parsed = new URL(url);
    if (parsed.hostname !== SOURCE) {
      return;
    }

    const key = parsed.pathname.replace(/\/$/, "");
    if (seen.has(key)) {
      return;
    }

    const name = cleanText(anchor.textContent) || decodeHandle(parsed.pathname.split("/").pop());
    if (!name || /trang chủ|danh mục/i.test(name)) {
      return;
    }

    seen.add(key);
    links.push({
      name,
      url: `${parsed.origin}${key}`
    });
  });

  return links;
}

function parseCollectionProducts(doc, pageUrl, category, collectionUrl) {
  const anchorMap = new Map();

  doc.querySelectorAll("a[href]").forEach((anchor) => {
    const productUrl = normalizeProductUrl(anchor.getAttribute("href"), pageUrl);
    if (!productUrl) {
      return;
    }

    const text = cleanText(anchor.textContent);
    const title = cleanText(anchor.getAttribute("title") || "");
    const imgAlt = cleanText(anchor.querySelector("img")?.getAttribute("alt") || "");
    const candidateText = chooseBestText([text, title, imgAlt]);

    if (!anchorMap.has(productUrl)) {
      anchorMap.set(productUrl, { anchors: [], bestText: "", bestAnchor: anchor });
    }

    const entry = anchorMap.get(productUrl);
    entry.anchors.push(anchor);
    if (isBetterTitle(candidateText, entry.bestText)) {
      entry.bestText = candidateText;
      entry.bestAnchor = anchor;
    }
  });

  const capturedAt = new Date().toISOString();
  const rows = [];

  anchorMap.forEach((entry, productUrl) => {
    const card = findProductCard(entry.bestAnchor, entry.anchors);
    const cardText = getReadableText(card || entry.bestAnchor);
    const hTitle = cleanText(
      card?.querySelector("h3 a[href*='/products/'], h2 a[href*='/products/'], h4 a[href*='/products/']")?.textContent || ""
    );
    const name = chooseBestText([hTitle, entry.bestText, cleanText(card?.querySelector("img")?.getAttribute("alt") || "")]);

    if (!name || /xem nhanh|xem chi tiết sản phẩm/i.test(name)) {
      return;
    }

    const prices = parseMoneyValues(cardText);
    const row = {
      source: SOURCE,
      category,
      collection_url: collectionUrl || pageUrl,
      list_page_url: pageUrl,
      product_url: productUrl,
      name,
      price: prices[0] || null,
      original_price: prices[1] || null,
      discount_percent: parseDiscount(cardText),
      public_sold_count: parseSoldCount(cardText),
      image_urls: compactUnique([extractImageUrl(card, pageUrl)]),
      captured_at: capturedAt,
      notes: ""
    };

    rows.push(row);
  });

  return rows;
}

function parseProductDetail(doc, productUrl) {
  const jsonLd = extractJsonLdProduct(doc);
  const titleEl = doc.querySelector("h1");
  const detailRoot = findDetailRoot(titleEl, doc);
  const rootText = getReadableText(detailRoot);
  const bodyText = getReadableText(doc.body || doc);
  const descriptionText = extractDescription(bodyText);
  const priceSourceText = rootText || bodyText;
  const prices = parseMoneyValues(priceSourceText);
  const jsonOffer = Array.isArray(jsonLd?.offers) ? jsonLd.offers[0] : jsonLd?.offers;
  const jsonPrice = toNumber(jsonOffer?.price || jsonLd?.price);

  return {
    name: cleanText(titleEl?.textContent || jsonLd?.name || ""),
    brand: extractLabel(rootText, "Thương hiệu") || readBrandFromJsonLd(jsonLd),
    sku: extractLabel(rootText, "Mã sản phẩm") || cleanText(jsonLd?.sku || ""),
    status: extractLabel(rootText, "Tình trạng") || cleanText(jsonOffer?.availability || ""),
    price: jsonPrice || prices[0] || null,
    original_price: prices[1] || null,
    discount_percent: parseDiscount(rootText),
    colors: extractVariantOptions(doc, bodyText),
    image_urls: extractDetailImages(doc, productUrl, cleanText(titleEl?.textContent || jsonLd?.name || "")),
    specifications: extractSpecifications(doc, descriptionText || bodyText),
    description_text: descriptionText,
    breadcrumbs: extractBreadcrumbs(doc),
    source: SOURCE,
    product_url: productUrl
  };
}

function addOrMergeProduct(row) {
  const productUrl = normalizeProductUrl(row.product_url, DEFAULT_START_URL);
  if (!productUrl) {
    return false;
  }

  row.product_url = productUrl;
  const existing = state.products.find((item) => item.product_url === productUrl);
  if (existing) {
    mergeProduct(existing, row);
    return false;
  }

  state.seenProductUrls.add(productUrl);
  state.products.push(normalizeRow(row));
  return true;
}

function mergeProduct(target, source) {
  Object.entries(source).forEach(([key, value]) => {
    if (!hasValue(value)) {
      return;
    }

    if (Array.isArray(value)) {
      target[key] = compactUnique([...(Array.isArray(target[key]) ? target[key] : []), ...value]);
      return;
    }

    if (isPlainObject(value)) {
      target[key] = {
        ...(isPlainObject(target[key]) ? target[key] : {}),
        ...value
      };
      return;
    }

    if (!hasValue(target[key]) || ["name", "brand", "sku", "status", "price", "original_price", "discount_percent"].includes(key)) {
      target[key] = value;
    }
  });
}

function normalizeRow(row) {
  return {
    source: SOURCE,
    category: "",
    breadcrumbs: [],
    name: "",
    brand: "",
    sku: "",
    status: "",
    price: null,
    original_price: null,
    discount_percent: null,
    public_sold_count: null,
    colors: [],
    product_url: "",
    collection_url: "",
    list_page_url: "",
    image_urls: [],
    specifications: {},
    description_text: "",
    captured_at: new Date().toISOString(),
    detail_scanned_at: "",
    notes: "",
    ...row
  };
}

function findProductCard(bestAnchor, allAnchors) {
  const anchors = [bestAnchor, ...allAnchors].filter(Boolean);
  const candidates = [];

  for (const anchor of anchors) {
    const direct = anchor.closest(
      ".product-loop, .pro-loop, .product-item, .product-card, .item_product_main, .item-product, .item, article, li"
    );
    if (direct) {
      candidates.push(direct);
    }

    let current = anchor;
    for (let depth = 0; depth < 7 && current?.parentElement; depth += 1) {
      current = current.parentElement;
      const productLinkCount = current.querySelectorAll("a[href*='/products/']").length;
      const text = getReadableText(current);
      if (productLinkCount <= 5 && /(₫|Đã\s*bán|Chính hãng)/i.test(text)) {
        candidates.push(current);
      }
      if (productLinkCount > 10) {
        break;
      }
    }
  }

  return candidates
    .filter(Boolean)
    .sort((a, b) => {
      const aText = getReadableText(a);
      const bText = getReadableText(b);
      const aLinks = a.querySelectorAll("a[href*='/products/']").length;
      const bLinks = b.querySelectorAll("a[href*='/products/']").length;
      return aLinks - bLinks || aText.length - bText.length;
    })[0] || bestAnchor?.parentElement || bestAnchor;
}

function findDetailRoot(titleEl, doc) {
  if (!titleEl) {
    return doc.body || doc;
  }

  let current = titleEl;
  let best = titleEl.parentElement || titleEl;
  for (let depth = 0; depth < 8 && current?.parentElement; depth += 1) {
    current = current.parentElement;
    const text = getReadableText(current);
    if (/Mã sản phẩm|Thương hiệu|Số lượng|Thêm vào giỏ/i.test(text)) {
      best = current;
      if (text.length > 500 && text.length < 8000) {
        return current;
      }
    }
    if (text.length > 12000) {
      break;
    }
  }
  return best;
}

function extractImageUrl(root, baseUrl) {
  if (!root) {
    return "";
  }

  const img = root.querySelector("img");
  return img ? normalizeImageUrl(readImageSrc(img), baseUrl) : "";
}

function extractDetailImages(doc, productUrl, productName) {
  const urls = [];
  doc.querySelectorAll("img").forEach((img) => {
    const src = normalizeImageUrl(readImageSrc(img), productUrl);
    const alt = cleanText(img.getAttribute("alt") || "");
    if (!src) {
      return;
    }
    const isProductHost = /product\.hstatic\.net/i.test(src);
    const isNamedImage = productName && alt && normalizeComparable(alt).includes(normalizeComparable(productName).slice(0, 20));
    if (isProductHost || isNamedImage) {
      urls.push(src);
    }
  });
  return compactUnique(urls).slice(0, 40);
}

function extractVariantOptions(doc, bodyText) {
  const values = [];
  const root =
    doc.querySelector("form[action*='/cart/add']") ||
    doc.querySelector(".product-info, .product-detail, .product-single, .product-content") ||
    doc;

  root.querySelectorAll("select option").forEach((option) => {
    values.push(cleanOption(option.textContent || option.value));
  });

  root.querySelectorAll("input[type='radio'], input[type='checkbox']").forEach((input) => {
    const id = input.getAttribute("id");
    const labelText = id ? cleanText(findLabelByFor(root, id)?.textContent || "") : "";
    values.push(cleanOption(labelText || input.value));
  });

  root.querySelectorAll(".swatch label, .variant label, .selector-wrapper label, .product-variant label").forEach((label) => {
    values.push(cleanOption(label.textContent));
  });

  ["Màu sắc", "Phân loại"].forEach((label) => {
    const section = sliceAfterLabel(bodyText, label, ["Số lượng", "Thêm vào giỏ", "Mua ngay"]);
    section.split("\n").forEach((line) => values.push(cleanOption(line)));
  });

  return compactUnique(values.filter(isUsefulOption));
}

function extractSpecifications(doc, text) {
  const specs = {};

  doc.querySelectorAll("table").forEach((table) => {
    table.querySelectorAll("tr").forEach((row) => {
      const cells = Array.from(row.querySelectorAll("th, td")).map((cell) => cleanText(cell.textContent));
      if (cells.length >= 2) {
        addSpec(specs, cells[0], cells.slice(1).join(" "));
      }
    });
  });

  const section = extractSpecSection(text);
  if (section) {
    const lines = section.split("\n").map(cleanText).filter(Boolean);
    for (let index = 0; index < lines.length - 1; index += 1) {
      const key = lines[index];
      const value = lines[index + 1];
      if (isSpecKey(key) && isSpecValue(value)) {
        addSpec(specs, key, value);
        index += 1;
      }
    }

    [
      "Tên danh mục",
      "Thương hiệu",
      "Đường kính viên bi",
      "Khối lượng mực",
      "Đóng gói",
      "Trọng lượng",
      "Đầu gôm",
      "Kiểu dáng",
      "Độ cứng ruột chì",
      "Chiều dài bút",
      "Đường kính ruột chì",
      "Kích thước",
      "Quy cách",
      "Khuyến cáo"
    ].forEach((label) => {
      const value = extractLooseSpec(section, label);
      if (value) {
        addSpec(specs, label, value);
      }
    });
  }

  return specs;
}

function addSpec(specs, key, value) {
  const cleanKey = cleanText(key).replace(/[:：|]+$/g, "");
  const cleanValue = cleanText(value);
  if (!isSpecKey(cleanKey) || !isSpecValue(cleanValue)) {
    return;
  }
  specs[cleanKey] = cleanValue;
}

function extractLooseSpec(section, label) {
  const escaped = escapeRegExp(label);
  const match = section.match(new RegExp(`${escaped}\\s+([^\\n]+)`, "i"));
  if (!match) {
    return "";
  }
  const value = cleanText(match[1]);
  return value.length <= 100 ? value : "";
}

function extractSpecSection(text) {
  const start = text.search(/Thông\s*số\s*k[ĩi]\s*thuật/i);
  if (start < 0) {
    return "";
  }
  const after = text.slice(start);
  const end = findFirstIndex(after, [/Đặc điểm/i, /Đặc tính/i, /Lợi ích/i, /Bảo quản/i, /Xem thêm/i, /Đánh giá sản phẩm/i]);
  return end > 0 ? after.slice(0, end) : after;
}

function extractDescription(text) {
  const start = text.search(/Mô\s*tả\s*sản\s*phẩm/i);
  if (start < 0) {
    return "";
  }
  const after = text.slice(start).replace(/^Mô\s*tả\s*sản\s*phẩm/i, "").trim();
  const end = findFirstIndex(after, [/Đánh giá sản phẩm/i, /Đánh giá của bạn/i, /Sản phẩm đã xem/i]);
  const description = end > 0 ? after.slice(0, end) : after;
  return description.replace(/\n{3,}/g, "\n\n").trim();
}

function extractBreadcrumbs(doc) {
  const crumbs = [];
  doc.querySelectorAll("nav a, .breadcrumb a, .breadcrumb li, [class*='breadcrumb'] a, [class*='breadcrumb'] li").forEach((node) => {
    const text = cleanText(node.textContent);
    if (text && !/\/|trang chủ/i.test(text)) {
      crumbs.push(text);
    }
  });
  return compactUnique(crumbs).slice(0, 8);
}

function extractJsonLdProduct(doc) {
  const products = [];
  doc.querySelectorAll("script[type='application/ld+json']").forEach((script) => {
    try {
      const json = JSON.parse(script.textContent.trim());
      collectJsonLdProducts(json, products);
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  });
  return products[0] || null;
}

function collectJsonLdProducts(node, products) {
  if (!node) {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectJsonLdProducts(item, products));
    return;
  }
  if (typeof node !== "object") {
    return;
  }
  const type = node["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
    products.push(node);
  }
  Object.values(node).forEach((value) => collectJsonLdProducts(value, products));
}

function readBrandFromJsonLd(jsonLd) {
  if (!jsonLd?.brand) {
    return "";
  }
  if (typeof jsonLd.brand === "string") {
    return cleanText(jsonLd.brand);
  }
  return cleanText(jsonLd.brand.name || "");
}

function parseMoneyValues(text) {
  const matches = [];
  const regex = /(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:₫|đ|VND)/gi;
  let match;
  while ((match = regex.exec(text || ""))) {
    const value = parseInteger(match[1]);
    if (value !== null) {
      matches.push(value);
    }
  }
  return matches;
}

function parseDiscount(text) {
  const match = (text || "").match(/(?:-|Tiết\s*kiệm\s*)\s*(\d{1,3})\s*%/i);
  return match ? Number(match[1]) : null;
}

function parseSoldCount(text) {
  const match = (text || "").match(/Đã\s*bán\s*([\d.,]+)/i);
  return match ? parseInteger(match[1]) : null;
}

function extractLabel(text, label) {
  const escaped = escapeRegExp(label);
  const match = (text || "").match(new RegExp(`${escaped}\\s*:?\\s*([^\\n|]+)`, "i"));
  return match ? cleanText(match[1]) : "";
}

function sliceAfterLabel(text, label, stopLabels) {
  const start = text.search(new RegExp(escapeRegExp(label), "i"));
  if (start < 0) {
    return "";
  }
  const after = text.slice(start).replace(new RegExp(`^${escapeRegExp(label)}\\s*:?`, "i"), "");
  const stops = stopLabels.map((item) => new RegExp(escapeRegExp(item), "i"));
  const end = findFirstIndex(after, stops);
  return end > 0 ? after.slice(0, end) : after;
}

function detectLastPage(doc, pageUrl) {
  let maxPage = 1;
  doc.querySelectorAll("a[href*='page=']").forEach((anchor) => {
    try {
      const url = new URL(anchor.getAttribute("href"), pageUrl);
      const page = Number(url.searchParams.get("page"));
      if (Number.isFinite(page) && page > maxPage) {
        maxPage = page;
      }
    } catch {
      // Ignore malformed links.
    }
  });
  return maxPage > 1 ? maxPage : null;
}

function getCollectionName(doc, fallbackUrl) {
  const h1 = cleanText(doc.querySelector("h1")?.textContent || "");
  if (h1) {
    return h1;
  }
  const title = cleanText(doc.querySelector("title")?.textContent || "");
  if (title) {
    return title.split("–")[0].split("-")[0].trim();
  }
  try {
    return decodeHandle(new URL(fallbackUrl).pathname.split("/").pop());
  } catch {
    return "Không rõ danh mục";
  }
}

function makePageUrl(collectionUrl, page) {
  const url = new URL(collectionUrl);
  if (page <= 1) {
    url.searchParams.delete("page");
  } else {
    url.searchParams.set("page", String(page));
  }
  return url.href;
}

function normalizeProductUrl(href, baseUrl) {
  const url = normalizeAbsoluteUrl(href, baseUrl);
  if (!url || !isProductDetailUrl(url)) {
    return "";
  }
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
}

function normalizeAbsoluteUrl(href, baseUrl) {
  if (!href) {
    return "";
  }
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return "";
  }
}

function normalizeImageUrl(src, baseUrl) {
  if (!src || /^data:/i.test(src)) {
    return "";
  }
  const firstSrc = src.split(",")[0].trim().split(/\s+/)[0];
  return normalizeAbsoluteUrl(firstSrc, baseUrl);
}

function readImageSrc(img) {
  if (!img) {
    return "";
  }
  return (
    img.getAttribute("data-src") ||
    img.getAttribute("data-original") ||
    img.getAttribute("data-lazyload") ||
    img.getAttribute("data-lazy") ||
    img.getAttribute("srcset") ||
    img.getAttribute("src") ||
    ""
  );
}

function isCollectionUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === SOURCE && parsed.pathname.startsWith("/collections/");
  } catch {
    return false;
  }
}

function isProductDetailUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    return parsed.hostname === SOURCE && path.startsWith("/products/") && path !== "/products";
  } catch {
    return false;
  }
}

function samePath(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.origin === b.origin && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function stripHash(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

function shouldStop(settings) {
  return state.stopRequested || (settings.maxProducts > 0 && state.products.length >= settings.maxProducts);
}

function renderAll() {
  renderButtons();
  renderMetrics();
  renderTable();
  els.capturedAt.textContent = state.products.length > 0 ? `Cập nhật: ${new Date().toLocaleString("vi-VN")}` : "";
}

function renderButtons() {
  els.startBtn.disabled = state.running;
  els.stopBtn.disabled = !state.running;
  els.exportXlsxBtn.disabled = state.products.length === 0;
  els.exportCsvBtn.disabled = state.products.length === 0;
  els.clearBtn.disabled = state.running || state.products.length === 0;
}

function renderMetrics() {
  els.collectionCount.textContent = String(state.metrics.collections);
  els.productCount.textContent = String(state.products.length);
  els.detailCount.textContent = String(state.metrics.details);
  els.errorCount.textContent = String(state.metrics.errors);
}

function renderTable() {
  els.productRows.replaceChildren();

  if (state.products.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = 9;
    td.textContent = "Chưa có dữ liệu. Bấm bắt đầu quét để lấy sản phẩm công khai.";
    tr.appendChild(td);
    els.productRows.appendChild(tr);
    els.tableNote.textContent = "Chưa có dữ liệu";
    return;
  }

  const fragment = document.createDocumentFragment();
  state.products.slice(0, MAX_TABLE_PREVIEW).forEach((product) => {
    const tr = document.createElement("tr");
    appendCell(tr, product.name || "");
    appendCell(tr, product.category || "");
    appendCell(tr, formatMoney(product.price));
    appendCell(tr, formatMoney(product.original_price));
    appendCell(tr, formatNumber(product.public_sold_count));
    appendCell(tr, product.brand || "");
    appendCell(tr, product.sku || "");
    appendCell(tr, cleanAvailability(product.status || ""));
    const linkCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = product.product_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Mở";
    linkCell.appendChild(link);
    tr.appendChild(linkCell);
    fragment.appendChild(tr);
  });

  els.productRows.appendChild(fragment);
  const suffix = state.products.length > MAX_TABLE_PREVIEW ? `, đang xem ${MAX_TABLE_PREVIEW} dòng đầu` : "";
  els.tableNote.textContent = `${state.products.length} sản phẩm${suffix}`;
}

function appendCell(row, value) {
  const td = document.createElement("td");
  td.textContent = value == null ? "" : String(value);
  row.appendChild(td);
}

function setStatus(text, kind = "") {
  els.statusPill.textContent = text;
  els.statusPill.className = "status-pill";
  if (kind) {
    els.statusPill.classList.add(kind);
  }
}

function setTask(text) {
  els.currentTask.textContent = text;
}

function setProgress(percent) {
  els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function setSoftProgress(settings) {
  if (settings.maxProducts > 0) {
    setProgress(Math.min(95, Math.round((state.products.length / settings.maxProducts) * 95)));
  } else {
    const current = parseFloat(els.progressBar.style.width || "0");
    setProgress(Math.min(92, current + 2));
  }
}

function log(message) {
  const li = document.createElement("li");
  li.textContent = `[${new Date().toLocaleTimeString("vi-VN")}] ${message}`;
  els.logList.prepend(li);
  while (els.logList.children.length > 120) {
    els.logList.lastElementChild?.remove();
  }
}

function exportCsv() {
  const csvRows = [EXPORT_COLUMNS.map(([, header]) => header), ...state.products.map((row) => EXPORT_COLUMNS.map(([key]) => exportValue(row[key])))];
  const csv = `\ufeff${csvRows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), makeExportName("csv"));
}

function exportXlsx() {
  const rows = [EXPORT_COLUMNS.map(([, header]) => header), ...state.products.map((row) => EXPORT_COLUMNS.map(([key]) => exportValue(row[key])))];
  const blob = buildXlsxBlob(rows);
  downloadBlob(blob, makeExportName("xlsx"));
}

function buildXlsxBlob(rows) {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => buildCellXml(value, `${columnName(colIndex + 1)}${rowIndex + 1}`))
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>
    <col min="1" max="1" width="16" customWidth="1"/>
    <col min="2" max="4" width="28" customWidth="1"/>
    <col min="5" max="12" width="18" customWidth="1"/>
    <col min="13" max="18" width="42" customWidth="1"/>
    <col min="19" max="21" width="24" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;

  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="ThienLongProducts" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
    },
    { name: "xl/worksheets/sheet1.xml", data: worksheet }
  ];

  return createZipBlob(files);
}

function buildCellXml(value, ref) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  const text = truncateCell(String(value ?? ""));
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const records = [];
  let offset = 0;
  const { dosTime, dosDate } = getDosDateTime(new Date());

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, dataBytes);
    records.push({ nameBytes, crc, size: dataBytes.length, offset });
    offset += localHeader.length + dataBytes.length;
  });

  const centralStart = offset;
  records.forEach((record) => {
    const centralHeader = new Uint8Array(46 + record.nameBytes.length);
    const view = new DataView(centralHeader.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, dosTime, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, record.crc, true);
    view.setUint32(20, record.size, true);
    view.setUint32(24, record.size, true);
    view.setUint16(28, record.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, record.offset, true);
    centralHeader.set(record.nameBytes, 46);
    centralParts.push(centralHeader);
    offset += centralHeader.length;
  });

  const centralSize = offset - centralStart;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, records.length, true);
  endView.setUint16(10, records.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralStart, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, end], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function getDosDateTime(date) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function makeExportName(extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `thienlong-products-${stamp}.${extension}`;
}

function exportValue(value) {
  if (Array.isArray(value)) {
    return value.join("\n");
  }
  if (isPlainObject(value)) {
    return JSON.stringify(value, null, 2);
  }
  return value == null ? "" : value;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function truncateCell(value) {
  return value.length > 32760 ? `${value.slice(0, 32760)}...` : value;
}

function scheduleSaveRows() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveRowsNow, 700);
}

async function saveRowsNow() {
  if (!hasChromeStorage()) {
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: state.products });
}

function hasChromeStorage() {
  return typeof chrome !== "undefined" && chrome.storage?.local;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getReadableText(root) {
  if (!root) {
    return "";
  }

  const parts = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue || "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const tag = node.tagName.toLowerCase();
    if (["script", "style", "noscript", "svg"].includes(tag)) {
      return;
    }
    if (BLOCK_TAGS.has(tag)) {
      parts.push("\n");
    }
    node.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(tag)) {
      parts.push("\n");
    }
  };

  walk(root);
  return parts
    .join("")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chooseBestText(values) {
  return values.map(cleanText).filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
}

function isBetterTitle(candidate, current) {
  if (!candidate || /xem nhanh|xem chi tiết|mua ngay|thêm vào giỏ/i.test(candidate)) {
    return false;
  }
  return candidate.length > (current || "").length;
}

function parseInteger(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

function toNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function readPositiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function hasValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isPlainObject(value)) {
    return Object.keys(value).length > 0;
  }
  return value !== null && value !== undefined && value !== "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactUnique(values) {
  const seen = new Set();
  const result = [];
  values.flat().forEach((value) => {
    const clean = typeof value === "string" ? cleanText(value) : value;
    if (!clean || seen.has(clean)) {
      return;
    }
    seen.add(clean);
    result.push(clean);
  });
  return result;
}

function cleanOption(value) {
  return cleanText(value)
    .replace(/\s+-\s*[\d.,]+\s*(?:₫|đ|VND).*$/i, "")
    .replace(/^\[[^\]]+\]\s*/g, "")
    .trim();
}

function isUsefulOption(value) {
  if (!value || value.length > 70) {
    return false;
  }
  if (/^(on|default title|chọn|select|input|\d+|\+|-|số lượng)$/i.test(value)) {
    return false;
  }
  if (/thêm vào giỏ|mua ngay|sao chép|điều kiện|đánh giá|gửi ảnh|click vào/i.test(value)) {
    return false;
  }
  return true;
}

function isSpecKey(value) {
  if (!value || value.length > 60) {
    return false;
  }
  if (/^(mã|hạn sử dụng|sao chép mã|đóng|điều kiện|số lượng)$/i.test(value)) {
    return false;
  }
  return !/[.!?]$/.test(value);
}

function isSpecValue(value) {
  if (!value || value.length > 180) {
    return false;
  }
  if (/sao chép|đóng|thêm vào giỏ|mua ngay/i.test(value)) {
    return false;
  }
  return true;
}

function appendNote(current, note) {
  return [current, note].filter(Boolean).join("; ");
}

function formatMoney(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${new Intl.NumberFormat("vi-VN").format(value)}₫` : "";
}

function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("vi-VN").format(value) : "";
}

function cleanAvailability(value) {
  return cleanText(String(value || "").replace(/^https?:\/\/schema\.org\//i, ""));
}

function findFirstIndex(text, regexes) {
  return regexes
    .map((regex) => {
      const index = text.search(regex);
      return index >= 0 ? index : Number.POSITIVE_INFINITY;
    })
    .reduce((min, index) => Math.min(min, index), Number.POSITIVE_INFINITY);
}

function decodeHandle(handle) {
  return cleanText(
    decodeURIComponent(handle || "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function normalizeComparable(value) {
  return cleanText(value).toLowerCase();
}

function findLabelByFor(root, id) {
  return Array.from(root.querySelectorAll("label")).find((label) => label.getAttribute("for") === id) || null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
