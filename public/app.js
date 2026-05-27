const $ = (id) => document.getElementById(id);

const TL_STORAGE_KEY = "competitor_dashboard_thienlong_rows_v1";
const SP_STORAGE_KEY = "competitor_dashboard_shopee_rows_v1";
const LOG_STORAGE_KEY = "competitor_dashboard_global_log_v1";
const DEFAULT_TL_URL = "https://thienlong.vn/products/";
const TL_HOST = "thienlong.vn";
const MAX_TABLE_PREVIEW = 800;

const tlColumns = [
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

const spColumns = [
  ["source", "Nguồn"],
  ["itemid", "itemid"],
  ["shopid", "shopid"],
  ["name", "Tên sản phẩm"],
  ["shop_name", "Shop"],
  ["category", "Danh mục"],
  ["brand", "Brand"],
  ["price_min", "Giá min"],
  ["price_max", "Giá max"],
  ["price_range", "Khoảng giá"],
  ["original_price_min", "Giá gốc min"],
  ["original_price_max", "Giá gốc max"],
  ["original_price_range", "Khoảng giá gốc"],
  ["discount_percent", "% giảm"],
  ["historical_sold", "Đã bán public"],
  ["rating_star", "Rating"],
  ["review_count", "Số đánh giá"],
  ["stock", "Kho"],
  ["liked_count", "Lượt thích"],
  ["image_url", "Ảnh chính"],
  ["product_url", "Link sản phẩm"],
  ["capture_at", "Capture lúc"]
];

const combinedColumns = [
  ["source", "Nguồn"],
  ["name", "Tên sản phẩm"],
  ["category", "Danh mục"],
  ["price", "Giá"],
  ["original_price", "Giá gốc"],
  ["discount_percent", "% giảm"],
  ["sold", "Đã bán public"],
  ["brand_or_shop", "Shop / Brand"],
  ["sku_or_id", "SKU / ID"],
  ["image_url", "Ảnh"],
  ["product_url", "Link"],
  ["captured_at", "Capture lúc"]
];

const els = {
  serverStatus: $("serverStatus"),
  globalLog: $("globalLog"),
  lastUpdated: $("lastUpdated"),
  clearLogBtn: $("clearLogBtn"),
  overviewTotalProducts: $("overviewTotalProducts"),
  overviewSources: $("overviewSources"),
  overviewThienLong: $("overviewThienLong"),
  overviewShopee: $("overviewShopee"),
  overviewMedianPrice: $("overviewMedianPrice"),
  tileTlCount: $("tileTlCount"),
  tileSpCount: $("tileSpCount"),
  tileDataCount: $("tileDataCount"),

  tlStartUrl: $("tlStartUrl"),
  tlMaxPages: $("tlMaxPages"),
  tlMaxProducts: $("tlMaxProducts"),
  tlDelayMs: $("tlDelayMs"),
  tlScanDetails: $("tlScanDetails"),
  tlStartBtn: $("tlStartBtn"),
  tlStopBtn: $("tlStopBtn"),
  tlExportCsvBtn: $("tlExportCsvBtn"),
  tlExportXlsxBtn: $("tlExportXlsxBtn"),
  tlClearBtn: $("tlClearBtn"),
  tlStatus: $("tlStatus"),
  tlCollectionCount: $("tlCollectionCount"),
  tlProductCount: $("tlProductCount"),
  tlDetailCount: $("tlDetailCount"),
  tlErrorCount: $("tlErrorCount"),
  tlCurrentTask: $("tlCurrentTask"),
  tlCapturedAt: $("tlCapturedAt"),
  tlProgressBar: $("tlProgressBar"),
  tlLogList: $("tlLogList"),
  tlRows: $("tlRows"),
  tlTableNote: $("tlTableNote"),
  tlFilter: $("tlFilter"),

  spShopUrl: $("spShopUrl"),
  spLimit: $("spLimit"),
  spMaxItems: $("spMaxItems"),
  spDelayMs: $("spDelayMs"),
  spStartBtn: $("spStartBtn"),
  spSessionBtn: $("spSessionBtn"),
  spStopBtn: $("spStopBtn"),
  spExportCsvBtn: $("spExportCsvBtn"),
  spExportXlsxBtn: $("spExportXlsxBtn"),
  spClearBtn: $("spClearBtn"),
  spStatus: $("spStatus"),
  spProductCount: $("spProductCount"),
  spPageCount: $("spPageCount"),
  spTotalCount: $("spTotalCount"),
  spShopName: $("spShopName"),
  spCurrentTask: $("spCurrentTask"),
  spCapturedAt: $("spCapturedAt"),
  spProgressBar: $("spProgressBar"),
  spLogList: $("spLogList"),
  spRows: $("spRows"),
  spTableNote: $("spTableNote"),
  spFilter: $("spFilter"),

  combinedSource: $("combinedSource"),
  combinedFilter: $("combinedFilter"),
  combinedExportCsvBtn: $("combinedExportCsvBtn"),
  combinedExportXlsxBtn: $("combinedExportXlsxBtn"),
  combinedRows: $("combinedRows"),
  combinedNote: $("combinedNote")
};

const state = {
  logs: [],
  tl: {
    running: false,
    stopRequested: false,
    products: [],
    metrics: { collections: 0, details: 0, errors: 0 }
  },
  sp: {
    running: false,
    abortController: null,
    items: [],
    shop: null,
    pageCount: 0,
    total: null
  }
};

init();

function init() {
  restoreState();
  bindNavigation();
  bindActions();
  renderAll();
  checkServer();
}

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.querySelectorAll("[data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewJump));
  });
}

function bindActions() {
  els.clearLogBtn.addEventListener("click", () => {
    state.logs = [];
    saveLogs();
    renderGlobalLog();
  });

  els.tlStartBtn.addEventListener("click", () => startThienLongScan().catch(handleTlFatalError));
  els.tlStopBtn.addEventListener("click", () => {
    state.tl.stopRequested = true;
    setTlTask("Đang dừng sau request hiện tại...");
  });
  els.tlExportCsvBtn.addEventListener("click", () => exportRowsCsv(buildTlExportRows(), makeExportName("thienlong-products", "csv")));
  els.tlExportXlsxBtn.addEventListener("click", () => exportRowsXlsx(buildTlExportRows(), "ThienLong", makeExportName("thienlong-products", "xlsx")));
  els.tlClearBtn.addEventListener("click", clearThienLongRows);
  els.tlFilter.addEventListener("input", renderTlTable);

  els.spStartBtn.addEventListener("click", () => startShopeeScan().catch(handleSpFatalError));
  els.spSessionBtn.addEventListener("click", () => openShopeeSession().catch(handleSpFatalError));
  els.spStopBtn.addEventListener("click", stopShopeeScan);
  els.spExportCsvBtn.addEventListener("click", () => exportRowsCsv(buildShopeeExportRows(), makeExportName("shopee-products", "csv")));
  els.spExportXlsxBtn.addEventListener("click", () => exportRowsXlsx(buildShopeeExportRows(), "Shopee", makeExportName("shopee-products", "xlsx")));
  els.spClearBtn.addEventListener("click", clearShopeeRows);
  els.spFilter.addEventListener("input", renderShopeeTable);

  els.combinedSource.addEventListener("change", renderCombinedTable);
  els.combinedFilter.addEventListener("input", renderCombinedTable);
  els.combinedExportCsvBtn.addEventListener("click", () => exportRowsCsv(buildCombinedExportRows(), makeExportName("competitor-analysis", "csv")));
  els.combinedExportXlsxBtn.addEventListener("click", () => exportRowsXlsx(buildCombinedExportRows(), "CompetitorData", makeExportName("competitor-analysis", "xlsx")));
}

async function checkServer() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    els.serverStatus.textContent = "Server local sẵn sàng";
    els.serverStatus.className = "server-pill ok";
  } catch (error) {
    els.serverStatus.textContent = "Server local lỗi";
    els.serverStatus.className = "server-pill error";
    addGlobalLog(`Server local lỗi: ${error.message}`, "error");
  }
}

function switchView(viewName) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
}

function restoreState() {
  state.tl.products = readStoredArray(TL_STORAGE_KEY);
  state.sp.items = readStoredArray(SP_STORAGE_KEY);
  state.logs = readStoredArray(LOG_STORAGE_KEY).slice(0, 120);
}

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveTlRows() {
  localStorage.setItem(TL_STORAGE_KEY, JSON.stringify(state.tl.products));
}

function saveSpRows() {
  localStorage.setItem(SP_STORAGE_KEY, JSON.stringify(state.sp.items));
}

function saveLogs() {
  localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(state.logs.slice(0, 120)));
}

async function startThienLongScan() {
  if (state.tl.running) {
    return;
  }

  const settings = readTlSettings();
  state.tl.running = true;
  state.tl.stopRequested = false;
  state.tl.products = [];
  state.tl.metrics = { collections: 0, details: 0, errors: 0 };
  els.tlLogList.replaceChildren();
  setTlStatus("Đang quét", "running");
  setTlTask("Đang tải trang bắt đầu...");
  setTlProgress(0);
  renderAll();
  addGlobalLog(`Thiên Long bắt đầu: ${settings.startUrl}`);

  try {
    const firstDoc = await fetchTlDocument(settings.startUrl);
    const startUrl = normalizeAbsoluteUrl(settings.startUrl, DEFAULT_TL_URL);

    if (isTlProductUrl(startUrl)) {
      await scanSingleTlProduct(firstDoc, startUrl);
    } else {
      const collections = buildTlCollectionQueue(firstDoc, startUrl);
      state.tl.metrics.collections = collections.length || 1;
      tlLog(`Tìm thấy ${state.tl.metrics.collections} danh mục cần quét.`);

      if (collections.length === 0) {
        await crawlTlCollection({ name: getTlCollectionName(firstDoc, startUrl), url: startUrl, firstDoc }, settings);
      } else {
        collections[0].firstDoc = samePath(collections[0].url, startUrl) ? firstDoc : null;
        for (const collection of collections) {
          if (shouldStopTl(settings)) {
            break;
          }
          await crawlTlCollection(collection, settings);
        }
      }

      if (settings.scanDetails && !state.tl.stopRequested && state.tl.products.length > 0) {
        await scanTlDetails(settings);
      }
    }

    const finalStatus = state.tl.stopRequested ? "Đã dừng" : "Hoàn tất";
    setTlStatus(finalStatus, state.tl.metrics.errors > 0 ? "error" : "done");
    setTlTask(`${finalStatus}: ${state.tl.products.length} sản phẩm.`);
    setTlProgress(100);
    addGlobalLog(`Thiên Long ${finalStatus.toLowerCase()}: ${state.tl.products.length} sản phẩm.`, state.tl.metrics.errors ? "error" : "ok");
  } finally {
    state.tl.running = false;
    state.tl.stopRequested = false;
    saveTlRows();
    renderAll();
  }
}

function readTlSettings() {
  return {
    startUrl: normalizeAbsoluteUrl(els.tlStartUrl.value.trim() || DEFAULT_TL_URL, DEFAULT_TL_URL),
    maxPages: readPositiveInt(els.tlMaxPages.value),
    maxProducts: readPositiveInt(els.tlMaxProducts.value),
    delayMs: Math.max(500, readPositiveInt(els.tlDelayMs.value) || 1500),
    scanDetails: els.tlScanDetails.checked
  };
}

async function scanSingleTlProduct(doc, productUrl) {
  const detail = parseTlProductDetail(doc, productUrl);
  addOrMergeTlProduct({
    source: "Thien Long",
    product_url: productUrl,
    captured_at: new Date().toISOString(),
    ...detail
  });
  state.tl.metrics.details = 1;
  tlLog("Đã quét 1 trang sản phẩm.");
}

function buildTlCollectionQueue(doc, startUrl) {
  if (isTlCollectionUrl(startUrl)) {
    return [{ name: getTlCollectionName(doc, startUrl), url: stripHash(startUrl), firstDoc: doc }];
  }

  const links = extractTlCollectionLinks(doc, startUrl);
  return links.length > 0 ? links : [];
}

async function crawlTlCollection(collection, settings) {
  const collectionUrl = stripHash(collection.url);
  const maxPages = settings.maxPages > 0 ? settings.maxPages : Number.POSITIVE_INFINITY;
  let page = 1;
  let detectedLastPage = null;
  let emptyStreak = 0;

  tlLog(`Quét danh mục: ${collection.name}`);

  while (page <= maxPages && !shouldStopTl(settings)) {
    const pageUrl = makeTlPageUrl(collectionUrl, page);
    setTlTask(`Danh mục "${collection.name}", trang ${page}`);
    setTlSoftProgress(settings);

    let doc;
    try {
      doc = page === 1 && collection.firstDoc ? collection.firstDoc : await fetchTlDocument(pageUrl);
    } catch (error) {
      state.tl.metrics.errors += 1;
      tlLog(`Không tải được ${pageUrl}: ${error.message}`, "error");
      break;
    }

    if (detectedLastPage === null) {
      detectedLastPage = detectTlLastPage(doc);
    }

    const rows = parseTlCollectionProducts(doc, pageUrl, collection.name, collectionUrl);
    let added = 0;
    rows.forEach((row) => {
      if (!shouldStopTl(settings) && addOrMergeTlProduct(row)) {
        added += 1;
      }
    });

    if (rows.length === 0) {
      emptyStreak += 1;
      tlLog(`Trang ${page} không đọc được sản phẩm.`);
    } else {
      emptyStreak = 0;
      tlLog(`Trang ${page}: đọc ${rows.length}, thêm ${added}.`);
    }

    renderAll();
    saveTlRows();

    if (emptyStreak >= 3) {
      break;
    }
    if (settings.maxProducts > 0 && state.tl.products.length >= settings.maxProducts) {
      break;
    }
    if (settings.maxPages === 0) {
      if (detectedLastPage && page >= detectedLastPage) {
        break;
      }
      if (page > 1 && added === 0) {
        break;
      }
    }

    page += 1;
    if (!shouldStopTl(settings)) {
      await sleep(settings.delayMs);
    }
  }
}

async function scanTlDetails(settings) {
  const total = state.tl.products.length;
  tlLog(`Bắt đầu quét chi tiết ${total} sản phẩm.`);

  for (let index = 0; index < state.tl.products.length; index += 1) {
    if (shouldStopTl(settings)) {
      break;
    }

    const product = state.tl.products[index];
    if (!product.product_url || product.detail_scanned_at) {
      continue;
    }

    setTlTask(`Chi tiết ${index + 1}/${total}: ${product.name || product.product_url}`);
    setTlProgress(Math.round(((index + 1) / total) * 100));

    try {
      const doc = await fetchTlDocument(product.product_url);
      const detail = parseTlProductDetail(doc, product.product_url);
      mergeObject(product, detail);
      product.detail_scanned_at = new Date().toISOString();
      state.tl.metrics.details += 1;
    } catch (error) {
      product.notes = appendNote(product.notes, `detail_error: ${error.message}`);
      state.tl.metrics.errors += 1;
      tlLog(`Lỗi chi tiết ${product.product_url}: ${error.message}`, "error");
    }

    renderAll();
    saveTlRows();
    if (index < state.tl.products.length - 1 && !shouldStopTl(settings)) {
      await sleep(settings.delayMs);
    }
  }
}

async function fetchTlDocument(url) {
  const response = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();
  return new DOMParser().parseFromString(html, "text/html");
}

function extractTlCollectionLinks(doc, baseUrl) {
  const seen = new Set();
  const links = [];
  doc.querySelectorAll("a[href]").forEach((anchor) => {
    const url = normalizeAbsoluteUrl(anchor.getAttribute("href"), baseUrl);
    if (!isTlCollectionUrl(url)) {
      return;
    }
    const parsed = new URL(url);
    const key = parsed.pathname.replace(/\/$/, "");
    if (seen.has(key)) {
      return;
    }
    const name = cleanText(anchor.textContent) || decodeHandle(key.split("/").pop());
    if (!name || /trang chủ|home|danh mục/i.test(name)) {
      return;
    }
    seen.add(key);
    links.push({ name, url: `${parsed.origin}${key}` });
  });
  return links;
}

function parseTlCollectionProducts(doc, pageUrl, category, collectionUrl) {
  const anchorMap = new Map();

  doc.querySelectorAll("a[href]").forEach((anchor) => {
    const productUrl = normalizeTlProductUrl(anchor.getAttribute("href"), pageUrl);
    if (!productUrl) {
      return;
    }
    const text = chooseBestText([
      anchor.textContent,
      anchor.getAttribute("title") || "",
      anchor.querySelector("img")?.getAttribute("alt") || ""
    ]);
    if (!anchorMap.has(productUrl)) {
      anchorMap.set(productUrl, { anchors: [], bestText: "", bestAnchor: anchor });
    }
    const entry = anchorMap.get(productUrl);
    entry.anchors.push(anchor);
    if (isBetterProductName(text, entry.bestText)) {
      entry.bestText = text;
      entry.bestAnchor = anchor;
    }
  });

  const capturedAt = new Date().toISOString();
  const rows = [];
  anchorMap.forEach((entry, productUrl) => {
    const card = findTlProductCard(entry.bestAnchor, entry.anchors);
    const cardText = getReadableText(card || entry.bestAnchor);
    const heading = cleanText(card?.querySelector("h2, h3, h4, .product-title, .pro-name")?.textContent || "");
    const imageAlt = cleanText(card?.querySelector("img")?.getAttribute("alt") || "");
    const name = chooseBestText([heading, entry.bestText, imageAlt]);
    if (!name || /xem nhanh|xem chi tiết|thêm vào giỏ/i.test(name)) {
      return;
    }
    const prices = parseMoneyValues(cardText);
    rows.push(normalizeTlRow({
      source: "Thien Long",
      category,
      collection_url: collectionUrl || pageUrl,
      list_page_url: pageUrl,
      product_url: productUrl,
      name,
      price: prices[0] || null,
      original_price: prices[1] || null,
      discount_percent: parseTextDiscount(cardText),
      public_sold_count: parseSoldCount(cardText),
      image_urls: compactUnique([extractImageUrl(card, pageUrl)]),
      captured_at: capturedAt,
      notes: ""
    }));
  });
  return rows;
}

function parseTlProductDetail(doc, productUrl) {
  const jsonLd = extractJsonLdProduct(doc);
  const title = cleanText(doc.querySelector("h1")?.textContent || jsonLd?.name || "");
  const detailRoot = findDetailRoot(doc.querySelector("h1"), doc);
  const rootText = getReadableText(detailRoot);
  const bodyText = getReadableText(doc.body || doc);
  const prices = parseMoneyValues(rootText || bodyText);
  const offer = Array.isArray(jsonLd?.offers) ? jsonLd.offers[0] : jsonLd?.offers;
  const jsonPrice = toNumber(offer?.price || jsonLd?.price);

  return {
    source: "Thien Long",
    product_url: productUrl,
    name: title,
    brand: extractLabel(rootText, "Thương hiệu") || cleanText(jsonLd?.brand?.name || jsonLd?.brand || ""),
    sku: extractLabel(rootText, "Mã sản phẩm") || cleanText(jsonLd?.sku || ""),
    status: extractLabel(rootText, "Tình trạng") || cleanText(offer?.availability || ""),
    price: jsonPrice || prices[0] || null,
    original_price: prices[1] || null,
    discount_percent: parseTextDiscount(rootText),
    colors: extractVariantOptions(doc),
    image_urls: extractDetailImages(doc, productUrl, title),
    specifications: extractSpecifications(doc),
    description_text: extractDescription(doc, bodyText),
    breadcrumbs: extractBreadcrumbs(doc)
  };
}

function addOrMergeTlProduct(row) {
  const productUrl = normalizeTlProductUrl(row.product_url, DEFAULT_TL_URL);
  if (!productUrl) {
    return false;
  }
  row.product_url = productUrl;
  const existing = state.tl.products.find((item) => item.product_url === productUrl);
  if (existing) {
    mergeObject(existing, row);
    return false;
  }
  state.tl.products.push(normalizeTlRow(row));
  return true;
}

function normalizeTlRow(row) {
  return {
    source: "Thien Long",
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

function clearThienLongRows() {
  if (state.tl.running) {
    return;
  }
  state.tl.products = [];
  state.tl.metrics = { collections: 0, details: 0, errors: 0 };
  localStorage.removeItem(TL_STORAGE_KEY);
  setTlStatus("Sẵn sàng", "");
  setTlTask("Chưa chạy");
  setTlProgress(0);
  els.tlLogList.replaceChildren();
  renderAll();
}

function handleTlFatalError(error) {
  state.tl.running = false;
  state.tl.stopRequested = false;
  state.tl.metrics.errors += 1;
  setTlStatus("Có lỗi", "error");
  setTlTask(error.message || String(error));
  tlLog(error.message || String(error), "error");
  addGlobalLog(`Thiên Long lỗi: ${error.message || error}`, "error");
  renderAll();
}

async function startShopeeScan() {
  if (state.sp.running) {
    return;
  }

  const params = new URLSearchParams({
    url: els.spShopUrl.value.trim(),
    maxItems: String(readPositiveInt(els.spMaxItems.value)),
    limit: String(readPositiveInt(els.spLimit.value) || 60),
    delayMs: String(readPositiveInt(els.spDelayMs.value) || 700)
  });

  state.sp.running = true;
  state.sp.abortController = new AbortController();
  state.sp.items = [];
  state.sp.shop = null;
  state.sp.pageCount = 0;
  state.sp.total = null;
  els.spLogList.replaceChildren();
  setSpStatus("Đang quét", "running");
  setSpTask("Đang kết nối backend Shopee...");
  setSpProgress(0);
  renderAll();
  addGlobalLog(`Shopee bắt đầu: ${els.spShopUrl.value.trim()}`);

  try {
    const response = await fetch(`/api/shopee/scan?${params.toString()}`, {
      cache: "no-store",
      signal: state.sp.abortController.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    await readNdjsonStream(response.body, handleShopeeEvent);
  } catch (error) {
    if (error.name !== "AbortError") {
      throw error;
    }
    setSpStatus("Đã dừng", "stopped");
    setSpTask(`Đã dừng: ${state.sp.items.length} sản phẩm.`);
    addGlobalLog(`Shopee đã dừng: ${state.sp.items.length} sản phẩm.`, "ok");
  } finally {
    state.sp.running = false;
    state.sp.abortController = null;
    saveSpRows();
    renderAll();
  }
}

async function openShopeeSession() {
  els.spSessionBtn.disabled = true;
  setSpTask("Đang mở Chrome profile Shopee...");
  spLog("Đang mở phiên Shopee trong Chrome profile riêng...");
  try {
    const response = await fetch("/api/shopee/session/open", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    setSpTask("Đã mở phiên Shopee");
    spLog("Đã mở cửa sổ Shopee. Đăng nhập trong cửa sổ đó nếu Shopee yêu cầu.", "ok");
    addGlobalLog("Đã mở phiên Shopee browser.", "ok");
  } finally {
    els.spSessionBtn.disabled = state.sp.running;
  }
}

async function readNdjsonStream(body, onMessage) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      onMessage(JSON.parse(line));
    }
  }

  if (buffer.trim()) {
    onMessage(JSON.parse(buffer));
  }
}

function handleShopeeEvent(message) {
  switch (message.type) {
    case "STARTED":
      setSpTask("Đã mở phiên Shopee local");
      spLog(`Phiên quét: ${message.shopUrl}`);
      break;
    case "LOG":
      setSpTask(message.message || "Đang quét...");
      spLog(message.message || "Đang quét...");
      break;
    case "SHOP_INFO":
      state.sp.shop = message.shop || null;
      state.sp.total = message.shop?.item_count || state.sp.total;
      spLog(`Shop: ${message.shop?.name || message.shop?.shopid || "-"}`, "ok");
      break;
    case "TOTAL":
      state.sp.total = message.total || null;
      break;
    case "PAGE_DONE":
      state.sp.pageCount = message.page || state.sp.pageCount;
      if (message.total) {
        state.sp.total = message.total;
      }
      setSpTask(`Trang ${message.page}: thêm ${message.added}, tổng ${message.count}`);
      setSpProgress(state.sp.total ? Math.min(98, Math.round((message.count / state.sp.total) * 100)) : Math.min(95, message.page * 8));
      spLog(`Trang ${message.page}: thêm ${message.added}, tổng ${message.count} (${message.source || "api"})`);
      break;
    case "DONE":
      state.sp.items = (message.items || []).map(normalizeShopeeClientItem);
      if (message.shop) {
        state.sp.shop = message.shop;
      }
      setSpProgress(100);
      setSpStatus(message.stopped ? "Đã dừng" : "Hoàn tất", message.stopped ? "stopped" : "done");
      setSpTask(`${message.stopped ? "Đã dừng" : "Hoàn tất"}: ${state.sp.items.length} sản phẩm.`);
      addGlobalLog(`Shopee ${message.stopped ? "đã dừng" : "hoàn tất"}: ${state.sp.items.length} sản phẩm.`, "ok");
      break;
    case "ERROR":
      throw new Error(message.error || "Shopee scan error");
    default:
      break;
  }
  saveSpRows();
  renderAll();
}

function normalizeShopeeClientItem(item) {
  const normalized = { ...item };
  normalized.source = "Shopee";
  normalized.image_url = shopeeImageUrl(item.image);
  normalized.product_url = shopeeProductUrl(item);
  normalized.price_range = priceRangeText(item.price_min, item.price_max);
  normalized.original_price_range = priceRangeText(item.original_price_min, item.original_price_max);
  normalized.capture_at = item.capture_at || new Date().toISOString();
  return normalized;
}

function stopShopeeScan() {
  if (!state.sp.running) {
    return;
  }
  spLog("Yêu cầu dừng quét...");
  state.sp.abortController?.abort();
}

function clearShopeeRows() {
  if (state.sp.running) {
    return;
  }
  state.sp.items = [];
  state.sp.shop = null;
  state.sp.pageCount = 0;
  state.sp.total = null;
  localStorage.removeItem(SP_STORAGE_KEY);
  setSpStatus("Sẵn sàng", "");
  setSpTask("Chưa chạy");
  setSpProgress(0);
  els.spLogList.replaceChildren();
  renderAll();
}

function handleSpFatalError(error) {
  state.sp.running = false;
  state.sp.abortController = null;
  setSpStatus("Có lỗi", "error");
  setSpTask(error.message || String(error));
  spLog(error.message || String(error), "error");
  addGlobalLog(`Shopee lỗi: ${error.message || error}`, "error");
  renderAll();
}

function renderAll() {
  renderTlControls();
  renderTlMetrics();
  renderTlTable();
  renderShopeeControls();
  renderShopeeMetrics();
  renderShopeeTable();
  renderCombinedTable();
  renderOverview();
  renderGlobalLog();
}

function renderOverview() {
  const tlCount = state.tl.products.length;
  const spCount = state.sp.items.length;
  const total = tlCount + spCount;
  const sourceCount = Number(tlCount > 0) + Number(spCount > 0);
  els.overviewTotalProducts.textContent = formatNumber(total);
  els.overviewSources.textContent = `${sourceCount} nguồn có dữ liệu`;
  els.overviewThienLong.textContent = formatNumber(tlCount);
  els.overviewShopee.textContent = formatNumber(spCount);
  els.overviewMedianPrice.textContent = formatMoney(median(getCombinedData().map((row) => row.price).filter(isFiniteNumber)));
  els.tileTlCount.textContent = `${formatNumber(tlCount)} sản phẩm`;
  els.tileSpCount.textContent = `${formatNumber(spCount)} sản phẩm`;
  els.tileDataCount.textContent = `${formatNumber(total)} dòng`;
  els.lastUpdated.textContent = state.logs.length ? state.logs[0].time : "Chưa có phiên quét";
}

function renderTlControls() {
  els.tlStartBtn.disabled = state.tl.running;
  els.tlStopBtn.disabled = !state.tl.running;
  els.tlExportCsvBtn.disabled = state.tl.products.length === 0;
  els.tlExportXlsxBtn.disabled = state.tl.products.length === 0;
  els.tlClearBtn.disabled = state.tl.running || state.tl.products.length === 0;
  [els.tlStartUrl, els.tlMaxPages, els.tlMaxProducts, els.tlDelayMs, els.tlScanDetails].forEach((el) => {
    el.disabled = state.tl.running;
  });
}

function renderTlMetrics() {
  els.tlCollectionCount.textContent = formatNumber(state.tl.metrics.collections);
  els.tlProductCount.textContent = formatNumber(state.tl.products.length);
  els.tlDetailCount.textContent = formatNumber(state.tl.metrics.details);
  els.tlErrorCount.textContent = formatNumber(state.tl.metrics.errors);
  els.tlCapturedAt.textContent = state.tl.products.length ? `Cập nhật ${new Date().toLocaleString("vi-VN")}` : "";
}

function renderTlTable() {
  const filter = normalizeComparable(els.tlFilter.value);
  const rows = state.tl.products.filter((row) => {
    if (!filter) {
      return true;
    }
    return normalizeComparable(`${row.name} ${row.category} ${row.sku} ${row.brand}`).includes(filter);
  });
  els.tlRows.replaceChildren();
  if (rows.length === 0) {
    appendEmptyRow(els.tlRows, 9, "Chưa có dữ liệu Thiên Long");
  } else {
    const fragment = document.createDocumentFragment();
    rows.slice(0, MAX_TABLE_PREVIEW).forEach((product) => {
      const tr = document.createElement("tr");
      appendProductNameCell(tr, product.name, product.product_url);
      appendCell(tr, product.category);
      appendCell(tr, formatMoney(product.price), "num");
      appendCell(tr, formatMoney(product.original_price), "num price-old");
      appendCell(tr, formatOptionalNumber(product.public_sold_count), "num");
      appendCell(tr, product.brand);
      appendCell(tr, product.sku);
      appendCell(tr, cleanAvailability(product.status));
      appendLinkCell(tr, product.product_url);
      fragment.appendChild(tr);
    });
    els.tlRows.appendChild(fragment);
  }
  const suffix = rows.length > MAX_TABLE_PREVIEW ? `, đang xem ${MAX_TABLE_PREVIEW}` : "";
  els.tlTableNote.textContent = `${formatNumber(rows.length)} sản phẩm${suffix}`;
}

function renderShopeeControls() {
  els.spStartBtn.disabled = state.sp.running;
  els.spSessionBtn.disabled = state.sp.running;
  els.spStopBtn.disabled = !state.sp.running;
  els.spExportCsvBtn.disabled = state.sp.items.length === 0;
  els.spExportXlsxBtn.disabled = state.sp.items.length === 0;
  els.spClearBtn.disabled = state.sp.running || state.sp.items.length === 0;
  [els.spShopUrl, els.spLimit, els.spMaxItems, els.spDelayMs].forEach((el) => {
    el.disabled = state.sp.running;
  });
}

function renderShopeeMetrics() {
  els.spProductCount.textContent = formatNumber(state.sp.items.length);
  els.spPageCount.textContent = formatNumber(state.sp.pageCount);
  els.spTotalCount.textContent = state.sp.total ? formatNumber(state.sp.total) : "-";
  els.spShopName.textContent = truncateMiddle(state.sp.shop?.name || state.sp.shop?.account || "-", 18);
  els.spCapturedAt.textContent = state.sp.items.length ? `Cập nhật ${new Date().toLocaleString("vi-VN")}` : "";
}

function renderShopeeTable() {
  const filter = normalizeComparable(els.spFilter.value);
  const rows = state.sp.items.filter((row) => {
    if (!filter) {
      return true;
    }
    return normalizeComparable(`${row.name} ${row.category} ${row.shop_name}`).includes(filter);
  });
  els.spRows.replaceChildren();
  if (rows.length === 0) {
    appendEmptyRow(els.spRows, 10, "Chưa có dữ liệu Shopee");
  } else {
    const fragment = document.createDocumentFragment();
    rows.slice(0, MAX_TABLE_PREVIEW).forEach((product) => {
      const tr = document.createElement("tr");
      appendImageCell(tr, product.image_url || shopeeImageUrl(product.image));
      appendProductNameCell(tr, product.name, product.product_url || shopeeProductUrl(product), `id: ${product.itemid || ""}`);
      appendCell(tr, product.category);
      appendCell(tr, priceRangeText(product.price_min, product.price_max), "num");
      appendCell(tr, priceRangeText(product.original_price_min, product.original_price_max), "num price-old");
      appendCell(tr, product.discount_percent ? `-${product.discount_percent}%` : "", "num discount");
      appendCell(tr, formatOptionalNumber(product.historical_sold), "num");
      appendCell(tr, ratingText(product), "num");
      appendCell(tr, product.shop_name || state.sp.shop?.name || "");
      appendLinkCell(tr, product.product_url || shopeeProductUrl(product));
      fragment.appendChild(tr);
    });
    els.spRows.appendChild(fragment);
  }
  const suffix = rows.length > MAX_TABLE_PREVIEW ? `, đang xem ${MAX_TABLE_PREVIEW}` : "";
  els.spTableNote.textContent = `${formatNumber(rows.length)} sản phẩm${suffix}`;
}

function renderCombinedTable() {
  const rows = filterCombinedData();
  els.combinedRows.replaceChildren();
  if (rows.length === 0) {
    appendEmptyRow(els.combinedRows, 10, "Chưa có dữ liệu hợp nhất");
  } else {
    const fragment = document.createDocumentFragment();
    rows.slice(0, MAX_TABLE_PREVIEW).forEach((row) => {
      const tr = document.createElement("tr");
      appendSourceCell(tr, row.source);
      appendImageCell(tr, row.image_url);
      appendProductNameCell(tr, row.name, row.product_url, row.sku_or_id);
      appendCell(tr, row.category);
      appendCell(tr, formatMoney(row.price), "num");
      appendCell(tr, formatMoney(row.original_price), "num price-old");
      appendCell(tr, row.discount_percent ? `-${row.discount_percent}%` : "", "num discount");
      appendCell(tr, formatOptionalNumber(row.sold), "num");
      appendCell(tr, row.brand_or_shop);
      appendLinkCell(tr, row.product_url);
      fragment.appendChild(tr);
    });
    els.combinedRows.appendChild(fragment);
  }
  const total = getCombinedData().length;
  const suffix = rows.length > MAX_TABLE_PREVIEW ? `, đang xem ${MAX_TABLE_PREVIEW}` : "";
  els.combinedNote.textContent = `${formatNumber(rows.length)} / ${formatNumber(total)} dòng${suffix}`;
  els.combinedExportCsvBtn.disabled = total === 0;
  els.combinedExportXlsxBtn.disabled = total === 0;
}

function filterCombinedData() {
  const source = els.combinedSource.value;
  const filter = normalizeComparable(els.combinedFilter.value);
  return getCombinedData().filter((row) => {
    if (source !== "all" && row.source !== source) {
      return false;
    }
    if (!filter) {
      return true;
    }
    return normalizeComparable(`${row.source} ${row.name} ${row.category} ${row.brand_or_shop}`).includes(filter);
  });
}

function getCombinedData() {
  const tlRows = state.tl.products.map((row) => ({
    source: "Thien Long",
    name: row.name || "",
    category: row.category || "",
    price: row.price,
    original_price: row.original_price,
    discount_percent: row.discount_percent,
    sold: row.public_sold_count,
    brand_or_shop: row.brand || "",
    sku_or_id: row.sku || "",
    image_url: Array.isArray(row.image_urls) ? row.image_urls[0] || "" : "",
    product_url: row.product_url || "",
    captured_at: row.captured_at || ""
  }));
  const spRows = state.sp.items.map((row) => ({
    source: "Shopee",
    name: row.name || "",
    category: row.category || "",
    price: row.price_min,
    original_price: row.original_price_min,
    discount_percent: row.discount_percent,
    sold: row.historical_sold,
    brand_or_shop: row.shop_name || state.sp.shop?.name || row.brand || "",
    sku_or_id: row.itemid ? `itemid: ${row.itemid}` : "",
    image_url: row.image_url || shopeeImageUrl(row.image),
    product_url: row.product_url || shopeeProductUrl(row),
    captured_at: row.capture_at || ""
  }));
  return [...tlRows, ...spRows];
}

function renderGlobalLog() {
  els.globalLog.replaceChildren();
  state.logs.slice(0, 80).forEach((entry) => {
    const li = document.createElement("li");
    li.className = entry.kind || "";
    li.textContent = `[${entry.time}] ${entry.message}`;
    els.globalLog.appendChild(li);
  });
}

function setTlStatus(text, kind = "") {
  els.tlStatus.textContent = text;
  els.tlStatus.className = `status-pill${kind ? ` ${kind}` : ""}`;
}

function setTlTask(text) {
  els.tlCurrentTask.textContent = text;
}

function setTlProgress(percent) {
  els.tlProgressBar.style.width = `${clamp(percent, 0, 100)}%`;
}

function setTlSoftProgress(settings) {
  if (settings.maxProducts > 0) {
    setTlProgress(Math.min(95, Math.round((state.tl.products.length / settings.maxProducts) * 95)));
  } else {
    const current = Number.parseFloat(els.tlProgressBar.style.width || "0");
    setTlProgress(Math.min(92, current + 2));
  }
}

function setSpStatus(text, kind = "") {
  els.spStatus.textContent = text;
  els.spStatus.className = `status-pill${kind ? ` ${kind}` : ""}`;
}

function setSpTask(text) {
  els.spCurrentTask.textContent = text;
}

function setSpProgress(percent) {
  els.spProgressBar.style.width = `${clamp(percent, 0, 100)}%`;
}

function tlLog(message, kind = "") {
  appendLog(els.tlLogList, message, kind);
}

function spLog(message, kind = "") {
  appendLog(els.spLogList, message, kind);
}

function appendLog(container, message, kind = "") {
  const li = document.createElement("li");
  li.className = kind;
  li.textContent = `[${new Date().toLocaleTimeString("vi-VN")}] ${message}`;
  container.prepend(li);
  while (container.children.length > 140) {
    container.lastElementChild?.remove();
  }
}

function addGlobalLog(message, kind = "") {
  state.logs.unshift({
    message,
    kind,
    time: new Date().toLocaleString("vi-VN")
  });
  state.logs = state.logs.slice(0, 120);
  saveLogs();
  renderGlobalLog();
  renderOverview();
}

function buildTlExportRows() {
  return [
    tlColumns.map(([, label]) => label),
    ...state.tl.products.map((row) => tlColumns.map(([key]) => exportValue(row[key])))
  ];
}

function buildShopeeExportRows() {
  return [
    spColumns.map(([, label]) => label),
    ...state.sp.items.map((row) => {
      const normalized = normalizeShopeeClientItem(row);
      return spColumns.map(([key]) => exportValue(normalized[key]));
    })
  ];
}

function buildCombinedExportRows() {
  const rows = filterCombinedData();
  return [
    combinedColumns.map(([, label]) => label),
    ...rows.map((row) => combinedColumns.map(([key]) => exportValue(row[key])))
  ];
}

function exportRowsCsv(rows, filename) {
  const csv = `\ufeff${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

function exportRowsXlsx(rows, sheetName, filename) {
  const bytes = XlsxWriter.buildXlsx(rows, sheetName);
  downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeExportName(prefix, ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${prefix}-${stamp}.${ext}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportValue(value) {
  if (Array.isArray(value)) {
    return value.join("\n");
  }
  if (isPlainObject(value)) {
    return JSON.stringify(value);
  }
  return value == null ? "" : value;
}

function appendCell(row, value, className = "") {
  const td = document.createElement("td");
  if (className) {
    td.className = className;
  }
  td.textContent = value == null ? "" : String(value);
  row.appendChild(td);
}

function appendProductNameCell(row, name, url, subtext = "") {
  const td = document.createElement("td");
  const nameEl = document.createElement(url ? "a" : "span");
  nameEl.className = "product-name";
  nameEl.textContent = name || "";
  if (url) {
    nameEl.href = url;
    nameEl.target = "_blank";
    nameEl.rel = "noopener noreferrer";
  }
  td.appendChild(nameEl);
  if (subtext) {
    const small = document.createElement("span");
    small.className = "subtext";
    small.textContent = subtext;
    td.appendChild(small);
  }
  row.appendChild(td);
}

function appendLinkCell(row, url) {
  const td = document.createElement("td");
  if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Mở";
    td.appendChild(link);
  }
  row.appendChild(td);
}

function appendImageCell(row, imageUrl) {
  const td = document.createElement("td");
  if (imageUrl) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.loading = "lazy";
    img.alt = "";
    img.src = imageUrl;
    td.appendChild(img);
  }
  row.appendChild(td);
}

function appendSourceCell(row, source) {
  const td = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = source === "Shopee" ? "source-badge sp" : "source-badge tl";
  badge.textContent = source === "Shopee" ? "Shopee" : "Thiên Long";
  td.appendChild(badge);
  row.appendChild(td);
}

function appendEmptyRow(tbody, colSpan, text) {
  const tr = document.createElement("tr");
  tr.className = "empty-row";
  const td = document.createElement("td");
  td.colSpan = colSpan;
  td.textContent = text;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

function findTlProductCard(bestAnchor, anchors) {
  const candidates = [bestAnchor, ...anchors].filter(Boolean).map((anchor) => {
    return anchor.closest(".product-loop, .pro-loop, .product-item, .product-card, .item_product_main, .item-product, article, li");
  }).filter(Boolean);

  if (candidates.length) {
    return candidates.sort((a, b) => getReadableText(a).length - getReadableText(b).length)[0];
  }

  let current = bestAnchor;
  for (let depth = 0; depth < 7 && current?.parentElement; depth += 1) {
    current = current.parentElement;
    const productLinkCount = current.querySelectorAll("a[href*='/products/']").length;
    const text = getReadableText(current);
    if (productLinkCount <= 5 && /₫|đ|VND|giá|sản phẩm/i.test(text)) {
      return current;
    }
    if (productLinkCount > 10) {
      break;
    }
  }
  return bestAnchor?.parentElement || bestAnchor;
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
    if (/Mã sản phẩm|Thương hiệu|Tình trạng|Số lượng|Thêm vào giỏ/i.test(text)) {
      best = current;
      if (text.length > 400 && text.length < 9000) {
        return current;
      }
    }
    if (text.length > 14000) {
      break;
    }
  }
  return best;
}

function extractJsonLdProduct(doc) {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]'));
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent.trim());
      const found = findJsonProduct(data);
      if (found) {
        return found;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function findJsonProduct(value) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonProduct(item);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const type = value["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
    return value;
  }
  return findJsonProduct(value["@graph"]) || null;
}

function extractLabel(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*[:：-]?\\s*([^\\n|]+)`, "i");
  const match = String(text || "").match(regex);
  return match ? cleanText(match[1]).replace(/\s{2,}.*/, "") : "";
}

function extractVariantOptions(doc) {
  const values = [];
  doc.querySelectorAll("select option, input[type='radio'], input[type='checkbox']").forEach((el) => {
    const value = cleanText(el.textContent || el.getAttribute("value") || el.getAttribute("data-value") || "");
    if (value && !/default|chọn|select|on/i.test(value) && value.length < 80) {
      values.push(value);
    }
  });
  doc.querySelectorAll(".swatch-element, .variant, .product-variants label").forEach((el) => {
    const value = cleanText(el.textContent || el.getAttribute("title") || "");
    if (value && value.length < 80) {
      values.push(value);
    }
  });
  return compactUnique(values);
}

function extractDetailImages(doc, baseUrl, productName) {
  const urls = [];
  doc.querySelectorAll("img").forEach((img) => {
    const src = normalizeImageUrl(readImageSrc(img), baseUrl);
    const alt = cleanText(img.getAttribute("alt") || "");
    if (!src) {
      return;
    }
    const isProductHost = /product\.hstatic\.net/i.test(src);
    const matchesName = productName && alt && normalizeComparable(alt).includes(normalizeComparable(productName).slice(0, 18));
    if (isProductHost || matchesName) {
      urls.push(src);
    }
  });
  return compactUnique(urls).slice(0, 40);
}

function extractSpecifications(doc) {
  const specs = {};
  doc.querySelectorAll("table tr").forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll("th, td")).map((cell) => cleanText(cell.textContent));
    if (cells.length >= 2 && cells[0] && cells[1]) {
      specs[cells[0]] = cells.slice(1).join(" | ");
    }
  });
  doc.querySelectorAll("dl").forEach((dl) => {
    const children = Array.from(dl.children);
    for (let i = 0; i < children.length - 1; i += 1) {
      if (children[i].tagName?.toLowerCase() === "dt") {
        const key = cleanText(children[i].textContent);
        const value = cleanText(children[i + 1].textContent);
        if (key && value) {
          specs[key] = value;
        }
      }
    }
  });
  return specs;
}

function extractDescription(doc, bodyText) {
  const meta = cleanText(doc.querySelector('meta[name="description"]')?.getAttribute("content") || "");
  if (meta) {
    return meta;
  }
  const candidates = Array.from(doc.querySelectorAll(".description, .product-description, #tab-description, .product-detail-content"));
  const best = candidates.map((node) => getReadableText(node)).sort((a, b) => b.length - a.length)[0];
  return best || String(bodyText || "").slice(0, 1500);
}

function extractBreadcrumbs(doc) {
  const selectors = ".breadcrumb a, .breadcrumbs a, nav[aria-label*='breadcrumb'] a";
  return compactUnique(Array.from(doc.querySelectorAll(selectors)).map((anchor) => cleanText(anchor.textContent)));
}

function getTlCollectionName(doc, url) {
  return cleanText(doc.querySelector("h1")?.textContent || doc.querySelector("title")?.textContent || decodeHandle(new URL(url).pathname.split("/").pop()));
}

function detectTlLastPage(doc) {
  const pages = Array.from(doc.querySelectorAll(".pagination a[href], .paginate a[href], .page-node a[href], nav[aria-label*='pagination'] a[href], option")).map((el) => {
    const text = cleanText(el.textContent || el.getAttribute("value") || "");
    const number = Number.parseInt(text.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(number) ? number : 0;
  });
  return pages.length ? Math.max(...pages, 0) || null : null;
}

function makeTlPageUrl(url, page) {
  const parsed = new URL(url);
  if (page > 1) {
    parsed.searchParams.set("page", String(page));
  } else {
    parsed.searchParams.delete("page");
  }
  return parsed.href;
}

function normalizeTlProductUrl(href, baseUrl) {
  const url = normalizeAbsoluteUrl(href, baseUrl);
  if (!url || !isTlProductUrl(url)) {
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
  const first = String(src).split(",")[0].trim().split(/\s+/)[0];
  return normalizeAbsoluteUrl(first, baseUrl);
}

function readImageSrc(img) {
  return img?.getAttribute("data-src") ||
    img?.getAttribute("data-original") ||
    img?.getAttribute("data-lazyload") ||
    img?.getAttribute("data-lazy") ||
    img?.getAttribute("srcset") ||
    img?.getAttribute("src") ||
    "";
}

function extractImageUrl(root, baseUrl) {
  const img = root?.querySelector("img");
  return img ? normalizeImageUrl(readImageSrc(img), baseUrl) : "";
}

function isTlCollectionUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === TL_HOST && parsed.pathname.startsWith("/collections/");
  } catch {
    return false;
  }
}

function isTlProductUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    return parsed.hostname === TL_HOST && path.startsWith("/products/") && path !== "/products";
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

function shouldStopTl(settings) {
  return state.tl.stopRequested || (settings.maxProducts > 0 && state.tl.products.length >= settings.maxProducts);
}

function getReadableText(root) {
  if (!root) {
    return "";
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts = [];
  let node = walker.nextNode();
  while (node) {
    const parentTag = node.parentElement?.tagName?.toLowerCase();
    if (!["script", "style", "noscript", "svg"].includes(parentTag)) {
      parts.push(node.nodeValue || "");
    }
    node = walker.nextNode();
  }
  return cleanText(parts.join(" ").replace(/\s*\n+\s*/g, "\n"));
}

function parseMoneyValues(text) {
  const values = [];
  const source = String(text || "").replace(/\s+/g, " ");
  const patterns = [
    /(?:₫|đ|VND)\s*([\d][\d.,\s]*)/gi,
    /([\d][\d.,\s]*)\s*(?:₫|đ|VND)/gi
  ];
  patterns.forEach((regex) => {
    let match;
    while ((match = regex.exec(source))) {
      const value = parseVnd(match[1]);
      if (value && !values.includes(value)) {
        values.push(value);
      }
    }
  });
  return values.sort((a, b) => a - b);
}

function parseVnd(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  const number = Number(digits);
  return Number.isFinite(number) ? number : null;
}

function parseTextDiscount(text) {
  const match = String(text || "").match(/-?\s*(\d{1,2})\s*%/);
  return match ? Number(match[1]) : null;
}

function parseSoldCount(text) {
  const match = String(text || "").match(/(?:đã\s*bán|sold)\s*([\d.,]+\s*[kKmM]?)/i) ||
    String(text || "").match(/([\d.,]+\s*[kKmM]?)\s*(?:đã\s*bán|sold)/i);
  return match ? parseAbbrevNumber(match[1]) : null;
}

function parseAbbrevNumber(value) {
  const match = String(value || "").match(/([\d][\d.,]*)\s*([kKmM])?/);
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

function shopeeImageUrl(imageId) {
  if (!imageId) {
    return "";
  }
  if (/^https?:\/\//i.test(imageId)) {
    return imageId;
  }
  return `https://down-vn.img.susercontent.com/file/${imageId}`;
}

function shopeeProductUrl(item) {
  if (!item?.itemid || !item?.shopid) {
    return "";
  }
  return `https://shopee.vn/${slugify(item.name)}-i.${item.shopid}.${item.itemid}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function priceRangeText(min, max) {
  if (min == null && max == null) {
    return "";
  }
  if (max == null || max === min) {
    return formatMoney(min);
  }
  return `${formatMoney(min)} - ${formatMoney(max)}`;
}

function ratingText(product) {
  if (product.rating_star == null) {
    return "";
  }
  const rating = Number(product.rating_star).toFixed(1);
  return product.review_count != null ? `${rating} (${formatNumber(product.review_count)})` : rating;
}

function cleanAvailability(value) {
  return cleanText(String(value || "").replace(/^https?:\/\/schema\.org\//i, ""));
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparable(value) {
  return cleanText(value).toLowerCase();
}

function chooseBestText(values) {
  return values.map(cleanText).filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
}

function isBetterProductName(candidate, current) {
  if (!candidate || /xem nhanh|xem chi tiết|mua ngay|thêm vào giỏ/i.test(candidate)) {
    return false;
  }
  return candidate.length > (current || "").length;
}

function decodeHandle(handle) {
  try {
    return cleanText(decodeURIComponent(handle || "").replace(/[-_]+/g, " "));
  } catch {
    return cleanText(String(handle || "").replace(/[-_]+/g, " "));
  }
}

function readPositiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function toNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function formatMoney(value) {
  return isFiniteNumber(value) ? `${new Intl.NumberFormat("vi-VN").format(value)}đ` : "";
}

function formatNumber(value) {
  return isFiniteNumber(value) ? new Intl.NumberFormat("vi-VN").format(value) : "0";
}

function formatOptionalNumber(value) {
  return isFiniteNumber(value) ? new Intl.NumberFormat("vi-VN").format(value) : "";
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
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

function mergeObject(target, source) {
  Object.entries(source || {}).forEach(([key, value]) => {
    if (!hasValue(value)) {
      return;
    }
    if (Array.isArray(value)) {
      target[key] = compactUnique([...(Array.isArray(target[key]) ? target[key] : []), ...value]);
      return;
    }
    if (isPlainObject(value)) {
      target[key] = { ...(isPlainObject(target[key]) ? target[key] : {}), ...value };
      return;
    }
    if (!hasValue(target[key]) || ["name", "brand", "sku", "status", "price", "original_price", "discount_percent"].includes(key)) {
      target[key] = value;
    }
  });
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

function appendNote(current, note) {
  return [current, note].filter(Boolean).join("; ");
}

function truncateMiddle(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  const left = Math.ceil((maxLength - 1) / 2);
  const right = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
