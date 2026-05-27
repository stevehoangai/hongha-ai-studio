// Service worker: điều phối quá trình quét sản phẩm Shopee bằng DOM-only.
// 1. App page gửi message { type: 'START_SCAN', payload: { url, maxItems, delayMs, scrollSteps } }.
// 2. Service worker mở 1 tab ẩn tới trang shop để lấy cookie + shopid.
// 3. Inject getShopInfoInPage để lấy thông tin shop (đọc từ DOM, không gọi API).
// 4. Lấy danh mục sidebar, lặp từng danh mục + từng trang -> inject extractDomPageInPage -> dedupe -> gom kết quả.

const STATE = {
  scanning: false,
  tabId: null,
  appTabId: null,
  stopRequested: false,
  runId: null,
};

function parseShopUsername(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    if (!/shopee\.vn$/i.test(u.hostname)) {
      throw new Error('Link phải thuộc miền shopee.vn');
    }
    const seg = u.pathname.replace(/^\/+/, '').split('/')[0];
    if (!seg) throw new Error('Không tìm thấy username trong link.');
    if (seg === 'shop') {
      const shopId = u.pathname.split('/')[2];
      if (!shopId) throw new Error('Thiếu shopId trong /shop/...');
      return { username: null, shopId: Number(shopId), shopUrl: 'https://shopee.vn/shop/' + shopId };
    }
    const m = seg.match(/i\.(\d+)\.(\d+)$/);
    if (m) {
      return { username: null, shopId: Number(m[1]), shopUrl: 'https://shopee.vn/shop/' + m[1] };
    }
    return { username: seg, shopId: null, shopUrl: 'https://shopee.vn/' + seg };
  } catch (e) {
    throw new Error('Link không hợp lệ: ' + e.message);
  }
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openTab(url, waitExtraMs = 1500) {
  const tab = await chrome.tabs.create({ url, active: false });
  await waitTabComplete(tab.id, 30000);
  await new Promise(r => setTimeout(r, waitExtraMs));
  return tab.id;
}

async function navigateTab(tabId, url, extraWaitMs = 2000) {
  await chrome.tabs.update(tabId, { url });
  await waitTabComplete(tabId, 30000);
  await new Promise(r => setTimeout(r, extraWaitMs));
}

function sendToApp(msg) {
  if (STATE.appTabId == null) return;
  chrome.tabs.sendMessage(STATE.appTabId, msg).catch(() => {});
}

function buildPageUrl(startUrl, pageParam) {
  const u = new URL(startUrl);
  if (pageParam > 0) {
    u.searchParams.set('page', String(pageParam));
    if (!u.searchParams.has('sortBy')) u.searchParams.set('sortBy', 'ctime');
    if (!u.searchParams.has('order')) u.searchParams.set('order', 'desc');
  } else {
    u.searchParams.delete('page');
  }
  return u.toString();
}

// ============================================================
// INJECT: lấy thông tin shop từ DOM (không gọi API)
// ============================================================
function getShopInfoInPage() {
  return new Promise(async (resolve) => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // Parser cho số có hậu tố k / m (1,2k -> 1200; 1.234 -> 1234)
    function parseAbbrev(str) {
      if (!str) return null;
      const m = String(str).match(/([\d][\d.,]*)\s*([kKmM])?/);
      if (!m) return null;
      const raw = m[1]; const suf = m[2];
      let n;
      if (suf && raw.indexOf(',') !== -1) {
        n = parseFloat(raw.replace(/\./g, '').replace(/,/g, '.'));
      } else if (suf && /^\d+\.\d{1,2}$/.test(raw)) {
        n = parseFloat(raw);
      } else {
        n = parseInt(raw.replace(/[.,]/g, ''), 10);
      }
      if (isNaN(n)) return null;
      if (suf === 'k' || suf === 'K') n *= 1000;
      else if (suf === 'm' || suf === 'M') n *= 1000000;
      return Math.round(n);
    }

    // Đợi trang render
    const start = Date.now();
    while (Date.now() - start < 12000) {
      if (document.querySelector('a[href*="-i."], a[href*=".i."]')) break;
      await sleep(400);
    }

    // Shop name từ <title> hoặc h1
    let name = null;
    const t = (document.querySelector('title')?.textContent || '').trim();
    if (t) {
      const m = t.match(/^(.+?)\s*[|\-–]\s*Shopee/i);
      name = m ? m[1].trim() : t.replace(/\s*\|\s*Shopee.*$/i, '').trim();
    }
    if (!name) {
      const h1 = document.querySelector('h1');
      if (h1) name = (h1.textContent || '').trim();
    }

    // shopid từ product link đầu tiên trên trang
    let shopId = null;
    const link = document.querySelector('a[href*="-i."], a[href*=".i."]');
    if (link) {
      const m = (link.getAttribute('href') || '').match(/(?:-i\.|\.i\.)(\d+)\.(\d+)/);
      if (m) shopId = parseInt(m[1], 10);
    }

    // item_count: tìm pattern "X sản phẩm" / "X Sản phẩm"
    let itemCount = null;
    const bodyText = (document.body && document.body.textContent || '').replace(/\s+/g, ' ');
    const im = bodyText.match(/([\d][\d.,]*\s*[kKmM]?)\s*Sản\s*[Pp]hẩm/);
    if (im) itemCount = parseAbbrev(im[1]);

    // followers: "X người theo dõi" / "X Người theo dõi" / "X followers"
    let followers = null;
    const fm = bodyText.match(/([\d][\d.,]*\s*[kKmM]?)\s*(?:Người\s*Theo\s*Dõi|người\s*theo\s*dõi|followers?)/i);
    if (fm) followers = parseAbbrev(fm[1]);

    resolve({
      ok: !!shopId,
      shop: shopId ? {
        shopid: shopId,
        name: name || '',
        item_count: itemCount,
        follower_count: followers,
      } : null,
      shopId: shopId,
    });
  });
}

// ============================================================
// INJECT: lấy danh mục shop từ sidebar "Danh Mục"
// ============================================================
function getShopCategoriesInPage(config) {
  return new Promise(async (resolve) => {
    const { baseUrl = location.href, maxWaitMs = 10000 } = config || {};
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function normText(s) {
      return String(s || '').replace(/\s+/g, ' ').trim();
    }

    function firstPathPart(pathname) {
      return String(pathname || '').replace(/^\/+/, '').split('/')[0] || '';
    }

    function sameShopPath(u) {
      const cur = new URL(baseUrl, location.href);
      const curPath = cur.pathname.replace(/\/+$/, '');
      const targetPath = u.pathname.replace(/\/+$/, '');
      if (curPath.startsWith('/shop/')) return targetPath.startsWith(curPath);
      const first = firstPathPart(curPath);
      return !!first && firstPathPart(targetPath) === first;
    }

    function isProductHref(href) {
      return /(?:-i\.|\.i\.)\d+\.\d+/.test(href || '');
    }

    function isAllProductsText(text) {
      return /^(sản\s*phẩm|tất\s*cả(?:\s*sản\s*phẩm)?)$/i.test(text);
    }

    function isCategoryAnchor(a) {
      const text = normText(a.innerText || a.textContent);
      if (!text || text.length > 80) return false;
      if (/danh\s*mục/i.test(text)) return false;
      if (/₫|%|đã\s*bán/i.test(text)) return false;
      if (/^(phổ\s*biến|mới\s*nhất|bán\s*chạy|giá|theo\s*dõi|chat|trò\s*chuyện)$/i.test(text)) return false;
      const href = a.getAttribute('href') || '';
      if (!href || isProductHref(href)) return false;
      let u;
      try {
        u = new URL(href, location.href);
      } catch (e) {
        return false;
      }
      if (!/shopee\.vn$/i.test(u.hostname)) return false;
      if (!sameShopPath(u)) return false;
      return true;
    }

    function collectFromRoot(root) {
      const out = [];
      const seen = new Set();
      const anchors = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
      for (const a of anchors) {
        if (!isCategoryAnchor(a)) continue;
        const name = normText(a.innerText || a.textContent);
        if (isAllProductsText(name)) continue;
        const url = new URL(a.getAttribute('href'), location.href).toString();
        const key = url.replace(/([?&])page=\d+/g, '$1').replace(/[?&]$/, '') + '|' + name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name, url });
      }
      return out;
    }

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (document.querySelector('a[href]') && /danh\s*mục/i.test(document.body?.innerText || '')) break;
      await sleep(400);
    }

    const roots = [];
    const nodes = document.querySelectorAll('div, span, h1, h2, h3, h4, p');
    for (const node of nodes) {
      const text = normText(node.innerText || node.textContent);
      if (!/^.{0,8}danh\s*mục.{0,8}$/i.test(text)) continue;
      let cur = node;
      for (let d = 0; cur && d < 8; d++) {
        const cats = collectFromRoot(cur);
        if (cats.length >= 2) {
          roots.push(cur);
          break;
        }
        cur = cur.parentElement;
      }
    }
    roots.push(document);

    let categories = [];
    for (const root of roots) {
      categories = collectFromRoot(root);
      if (categories.length >= 2) break;
    }

    resolve({ categories });
  });
}

// ============================================================
// INJECT: extract toàn bộ sản phẩm trên trang hiện tại (DOM mode)
// ============================================================
function extractDomPageInPage(config) {
  return new Promise(async (resolve) => {
    const { scrollSteps = 10, scrollDelay = 500, maxWaitMs = 15000 } = config || {};
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ============= Parsers =============

    // VN price format: "1.234" / "12.345" / "1.234.567" — '.' là phân tách nghìn (giá VND >= 1000)
    function parseVnPrice(s) {
      if (s == null) return null;
      const clean = String(s).replace(/[^\d]/g, '');
      if (!clean) return null;
      const n = parseInt(clean, 10);
      return isNaN(n) ? null : n;
    }

    function addUniqueNumber(arr, n) {
      if (n == null || isNaN(n) || n < 1000) return;
      if (!arr.includes(n)) arr.push(n);
    }

    function extractPriceNumbers(text) {
      const s = String(text || '').replace(/\s+/g, ' ').trim();
      if (!s || s.indexOf('₫') === -1) return [];
      const nums = [];
      const patterns = [
        /₫\s*([\d][\d.,]*)\s*(?:[-–—~]\s*(?:₫\s*)?([\d][\d.,]*))?/g,
        /([\d][\d.,]*)\s*₫\s*(?:[-–—~]\s*([\d][\d.,]*)\s*₫?)?/g,
        /([\d][\d.,]*)\s*[-–—~]\s*([\d][\d.,]*)\s*₫/g,
      ];
      for (const re of patterns) {
        let m;
        while ((m = re.exec(s))) {
          addUniqueNumber(nums, parseVnPrice(m[1]));
          addUniqueNumber(nums, parseVnPrice(m[2]));
        }
      }
      return nums;
    }

    // "1,2k" -> 1200; "1.234" -> 1234; "10k" -> 10000; "999+" -> 999
    function parseAbbrevNum(str) {
      if (!str) return null;
      const m = String(str).match(/([\d][\d.,]*)\s*\+?\s*([kKmM])?/);
      if (!m) return null;
      const raw = m[1]; const suf = m[2];
      let n;
      if (suf && raw.indexOf(',') !== -1) {
        n = parseFloat(raw.replace(/\./g, '').replace(/,/g, '.'));
      } else if (suf && /^\d+\.\d{1,2}$/.test(raw)) {
        n = parseFloat(raw);
      } else {
        n = parseInt(raw.replace(/[.,]/g, ''), 10);
      }
      if (isNaN(n)) return null;
      if (suf === 'k' || suf === 'K') n *= 1000;
      else if (suf === 'm' || suf === 'M') n *= 1000000;
      return Math.round(n);
    }

    function isLineThroughEl(el) {
      if (!el || el.nodeType !== 1) return false;
      const tag = el.tagName;
      if (tag === 'S' || tag === 'DEL') return true;
      const style = el.getAttribute('style') || '';
      if (/line-through/i.test(style)) return true;
      const cls = el.getAttribute('class') || '';
      if (/line[-_]?through|strikethrough/i.test(cls)) return true;
      try {
        const cs = window.getComputedStyle(el);
        if (cs && (cs.textDecorationLine === 'line-through' || /line-through/.test(cs.textDecoration || ''))) return true;
      } catch (e) {}
      return false;
    }

    function hasLineThroughAncestor(el, root) {
      let cur = el;
      while (cur && cur !== root) {
        if (isLineThroughEl(cur)) return true;
        cur = cur.parentElement;
      }
      return false;
    }

    function hasLineThroughDescendant(el) {
      if (!el || !el.querySelectorAll) return false;
      const nodes = el.querySelectorAll('*');
      for (const node of nodes) {
        if (isLineThroughEl(node)) return true;
      }
      return false;
    }

    // ============= Đợi + Cuộn =============
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (document.querySelector('a[href*="-i."], a[href*=".i."]')) break;
      await sleep(400);
    }
    await sleep(400);

    let lastH = 0;
    for (let i = 1; i <= scrollSteps; i++) {
      const h = document.documentElement.scrollHeight;
      window.scrollTo({ top: h * (i / scrollSteps), behavior: 'instant' });
      await sleep(scrollDelay);
      if (h === lastH && i > 3) break;
      lastH = h;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(scrollDelay);
    window.scrollTo(0, 0);
    await sleep(400);

    // ============= Tập hợp anchor sản phẩm =============
    const productMap = new Map();
    const allLinks = document.querySelectorAll('a[href]');
    for (const a of allLinks) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/(?:-i\.|\.i\.)(\d+)\.(\d+)(?:[\/?#]|$)/);
      if (!m) continue;
      const shopid = parseInt(m[1], 10);
      const itemid = parseInt(m[2], 10);
      if (!shopid || !itemid) continue;
      const key = shopid + '_' + itemid;
      if (productMap.has(key)) continue;
      productMap.set(key, { anchor: a, shopid, itemid });
    }

    // ============= Trích xuất chi tiết =============
    const items = [];

    for (const { anchor, shopid, itemid } of productMap.values()) {
      // Tìm card: đi lên parent cho đến khi parent chứa >1 anchor sản phẩm (nghĩa là card đã đủ)
      let card = anchor;
      for (let d = 0; d < 15; d++) {
        const p = card.parentElement;
        if (!p) break;
        // Stop nếu parent chứa >= 2 product anchor (card hiện tại đã là 1 card đầy đủ)
        const anchorsInParent = p.querySelectorAll('a[href*="-i."], a[href*=".i."]');
        const productAnchorsInParent = Array.from(anchorsInParent).filter(x =>
          /(?:-i\.|\.i\.)\d+\.\d+/.test(x.getAttribute('href') || '')
        );
        if (productAnchorsInParent.length >= 2 && card !== anchor) break;
        card = p;
        if (p.tagName === 'LI') break;
        if (p.getAttribute('data-sqe') === 'item') break;
      }

      // ============= Tên =============
      // Ưu tiên img.alt (Shopee dùng alt = tên sản phẩm đầy đủ, sạch sẽ)
      let name = '';
      const img = card.querySelector('img');
      if (img) {
        const alt = (img.getAttribute('alt') || '').trim();
        if (alt && alt.length > 5 && !/^https?:/i.test(alt)) name = alt;
      }
      // Fallback selectors
      if (!name) {
        const nameEl = card.querySelector('[data-sqe="name"]');
        if (nameEl) name = (nameEl.textContent || '').trim();
      }
      if (!name) name = (anchor.getAttribute('title') || anchor.getAttribute('aria-label') || '').trim();
      // Fallback cuối: text node dài nhất KHÔNG chứa ₫/%/"đã bán"
      if (!name) {
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null);
        let best = '';
        let tn;
        while ((tn = walker.nextNode())) {
          const t = (tn.textContent || '').trim();
          if (!t || t.length < 6) continue;
          if (/₫|%|đã\s*bán/i.test(t)) continue;
          if (!/[A-Za-zÀ-ỹà-ỹ]/.test(t)) continue;
          if (t.length > best.length) best = t;
        }
        name = best;
      }
      name = name.replace(/\s+/g, ' ').trim();
      if (!name) continue;

      // ============= Walk text nodes để classify =============
      let currentPrices = []; // giá hiện tại (không gạch ngang)
      const originalPrices = []; // giá gốc (gạch ngang)
      let discountPercent = null;
      let soldRaw = null;
      const seenPriceSources = new Set();

      function scopedPriceSource(el, text, isOld) {
        if (/₫/.test(text)) return { el: el, text: text };
        let cur = el;
        for (let depth = 0; cur && cur !== card && depth < 4; depth++) {
          const t = (cur.textContent || '').replace(/\s+/g, ' ').trim();
          if (/₫/.test(t) && t.length <= 120 && extractPriceNumbers(t).length) {
            if (!isOld && hasLineThroughDescendant(cur)) return null;
            return { el: cur, text: t };
          }
          cur = cur.parentElement;
        }
        return null;
      }

      function collectPrices(source, isOld) {
        if (!source || !source.text) return;
        const key = source.el || source.text;
        if (seenPriceSources.has(key)) return;
        seenPriceSources.add(key);
        const nums = extractPriceNumbers(source.text);
        for (const n of nums) {
          if (isOld) addUniqueNumber(originalPrices, n);
          else addUniqueNumber(currentPrices, n);
        }
      }

      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null);
      let tn;
      while ((tn = walker.nextNode())) {
        const text = (tn.textContent || '').trim();
        if (!text) continue;
        const parent = tn.parentElement;
        if (!parent) continue;

        // 1) "đã bán" / "Đã bán"
        if (/đã\s*bán/i.test(text)) {
          let sm = text.match(/Đã\s*bán\s*([\d][\d.,]*\s*[kKmM]?\s*\+?)/i)
                || text.match(/([\d][\d.,]*\s*[kKmM]?\s*\+?)\s*đã\s*bán/i);
          if (sm) soldRaw = sm[1];
        }

        // 2) Discount badge: "-15%", "-29%", "29%" hoặc dính với giá/sold trong cùng text.
        const dm = text.match(/-\s*(\d{1,2})\s*%/) || text.match(/^\s*(\d{1,2})\s*%\s*$/);
        if (dm) {
          const dv = parseInt(dm[1], 10);
          if (dv > 0 && dv < 100) discountPercent = dv;
        }

        // 3) Giá: hỗ trợ "₫9.350", "9.350₫", "₫9.350 - 12.000" và text bị chia nhiều span.
        const isOldPrice = hasLineThroughAncestor(parent, card);
        const source = scopedPriceSource(parent, text, isOldPrice);
        if (source) collectPrices(source, isOldPrice);
      }

      const cardTextForPrices = (card.textContent || '').replace(/\s+/g, ' ');
      const originalSet = new Set(originalPrices);
      const cardPrices = extractPriceNumbers(cardTextForPrices).filter(n => !originalSet.has(n));
      if (cardPrices.length > currentPrices.length) {
        for (const n of cardPrices) addUniqueNumber(currentPrices, n);
      }

      // ============= Resolve giá =============
      let priceMin = null, priceMax = null;
      let originalMin = null, originalMax = null;

      if (currentPrices.length) {
        priceMin = Math.min.apply(null, currentPrices);
        priceMax = Math.max.apply(null, currentPrices);
      }
      if (originalPrices.length) {
        originalMin = Math.min.apply(null, originalPrices);
        originalMax = Math.max.apply(null, originalPrices);
      }

      // Nếu chưa thấy % nhưng có cả 2 giá -> tính
      if (discountPercent == null && priceMin && originalMin && originalMin > priceMin) {
        discountPercent = Math.round((originalMin - priceMin) / originalMin * 100);
      }
      // Nếu có % nhưng không có giá gốc -> suy ngược
      if (originalMin == null && discountPercent && priceMin && discountPercent > 0 && discountPercent < 100) {
        originalMin = Math.round(priceMin / (1 - discountPercent / 100));
        originalMax = (priceMax != null && priceMax !== priceMin)
          ? Math.round(priceMax / (1 - discountPercent / 100))
          : originalMin;
      }

      // ============= Sold =============
      let sold = null;
      if (soldRaw) {
        sold = parseAbbrevNum(soldRaw.replace(/\s*\+\s*$/, ''));
      }

      // ============= Rating + review count =============
      let ratingStar = null;
      const ratingFill = card.querySelector('.shopee-rating-stars__lit, [class*="rating-stars__lit"], [class*="rating-lit"]');
      if (ratingFill) {
        const st = ratingFill.getAttribute('style') || '';
        const wm = st.match(/width:\s*([\d.]+)%/);
        if (wm) ratingStar = Math.round(parseFloat(wm[1]) / 20 * 10) / 10;
      }
      // Fallback: text "4.8" cạnh ★
      const cardTextNorm = (card.textContent || '').replace(/\s+/g, ' ');
      if (ratingStar == null) {
        const rm = cardTextNorm.match(/\b([0-5](?:[.,]\d)?)\s*\/\s*5\b/)
              || cardTextNorm.match(/★\s*([0-5](?:[.,]\d)?)/)
              || cardTextNorm.match(/\b([0-5](?:[.,]\d)?)\s*★/);
        if (rm) ratingStar = parseFloat(String(rm[1]).replace(',', '.'));
      }

      let reviewCount = null;
      const perfEl = card.querySelector('[data-sqe="performance"]');
      const perfText = perfEl ? (perfEl.textContent || '').replace(/\s+/g, ' ') : cardTextNorm;
      let rm2 = perfText.match(/([\d][\d.,]*)\s*(?:đánh\s*giá|review|reviews|nhận\s*xét)/i);
      if (rm2) reviewCount = parseInt(rm2[1].replace(/[.,]/g, ''), 10);
      if (reviewCount == null) {
        const rm3 = perfText.match(/\(\s*([\d][\d.,]*)\s*\)/);
        if (rm3) reviewCount = parseInt(rm3[1].replace(/[.,]/g, ''), 10);
      }
      if (isNaN(reviewCount)) reviewCount = null;

      // ============= Ảnh =============
      let imageId = '';
      if (img) {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const im = src.match(/\/file\/([a-zA-Z0-9_-]+)/);
        if (im) imageId = im[1];
        else if (src && !/^data:/.test(src)) imageId = src;
      }

      items.push({
        itemid: itemid,
        shopid: shopid,
        name: name,
        price_min: priceMin,
        price_max: priceMax,
        original_price_min: originalMin,
        original_price_max: originalMax,
        discount_percent: discountPercent,
        price: priceMin,
        price_before_discount: originalMin,
        historical_sold: sold,
        rating_star: ratingStar,
        review_count: reviewCount,
        stock: null,
        liked_count: null,
        image: imageId,
        _source: 'dom',
      });
    }

    resolve({ items: items });
  });
}

// ============================================================
// Orchestrator
// ============================================================
async function runScan(payload, appTabId) {
  STATE.scanning = true;
  STATE.stopRequested = false;
  STATE.appTabId = appTabId;

  let parsed;
  try {
    parsed = parseShopUsername(payload.url);
  } catch (e) {
    sendToApp({ type: 'SCAN_ERROR', error: e.message });
    STATE.scanning = false;
    return;
  }

  sendToApp({ type: 'SCAN_STARTED', shopUrl: parsed.shopUrl });

  let tabId;
  try {
    tabId = await openTab(parsed.shopUrl, 1800);
    STATE.tabId = tabId;
  } catch (e) {
    sendToApp({ type: 'SCAN_ERROR', error: 'Không mở được tab Shopee: ' + e.message });
    STATE.scanning = false;
    return;
  }

  const runId = 'run_' + Date.now();
  STATE.runId = runId;

  let finalItems = [];
  let finalShop = null;

  try {
    // Bước 1: lấy shop info từ DOM
    sendToApp({ type: 'PROGRESS', message: 'Đọc thông tin shop từ trang...' });
    const infoRes = await chrome.scripting.executeScript({
      target: { tabId },
      func: getShopInfoInPage,
      args: [],
    });
    const info = infoRes && infoRes[0] && infoRes[0].result;
    if (info && info.ok && info.shop) {
      finalShop = {
        shopid: info.shop.shopid,
        name: info.shop.name,
        account: parsed.username || '',
        item_count: info.shop.item_count,
        follower_count: info.shop.follower_count,
      };
      parsed.shopId = info.shopId || parsed.shopId;
      sendToApp({ type: 'SHOP_INFO', shop: finalShop });
    } else {
      sendToApp({ type: 'PROGRESS', message: '⚠ Không đọc được shop info, vẫn tiếp tục quét...' });
    }

    // Bước 2: DOM pagination
    const baseUrl = parsed.username
      ? 'https://shopee.vn/' + parsed.username
      : 'https://shopee.vn/shop/' + (parsed.shopId || '');

    let categories = [];
    try {
      sendToApp({ type: 'PROGRESS', message: 'Đọc danh mục sản phẩm từ sidebar...' });
      const catRes = await chrome.scripting.executeScript({
        target: { tabId },
        func: getShopCategoriesInPage,
        args: [{ baseUrl }],
      });
      const catData = catRes && catRes[0] && catRes[0].result;
      categories = (catData && Array.isArray(catData.categories)) ? catData.categories : [];
    } catch (e) {
      categories = [];
    }

    const scanTargets = [];
    const seenTargets = new Set();
    function addScanTarget(name, url, isFallback) {
      if (!url) return;
      const cleanName = String(name || '').replace(/\s+/g, ' ').trim() || 'Tất cả sản phẩm';
      const cleanUrl = buildPageUrl(url, 0);
      const key = cleanUrl + '|' + cleanName.toLowerCase();
      if (seenTargets.has(key)) return;
      seenTargets.add(key);
      scanTargets.push({ name: cleanName, url: cleanUrl, isFallback: !!isFallback });
    }

    for (const cat of categories) addScanTarget(cat.name, cat.url, false);
    addScanTarget('Tất cả sản phẩm', baseUrl, true);

    if (categories.length) {
      sendToApp({ type: 'PROGRESS', message: 'Tìm thấy ' + categories.length + ' danh mục. Bắt đầu quét theo danh mục để giảm sót sản phẩm.' });
    } else {
      sendToApp({ type: 'PROGRESS', message: 'Không đọc được danh mục, dùng phân trang tổng của shop.' });
    }

    const seen = new Map();         // dedupe xuyên danh mục/trang theo shopid_itemid
    const items = [];
    const maxItems = payload.maxItems || 0;
    const delayMs = Math.max(payload.delayMs || 0, 400);
    const scrollSteps = Math.max(payload.scrollSteps || 10, 2);
    const MAX_PAGES_PER_TARGET = 200;
    let scannedPageCount = 0;
    let shouldStop = false;

    for (let targetIndex = 0; targetIndex < scanTargets.length; targetIndex++) {
      if (STATE.stopRequested || shouldStop) break;

      const target = scanTargets[targetIndex];
      let emptyStreak = 0;
      sendToApp({
        type: 'PROGRESS',
        message: 'Quét danh mục "' + target.name + '" (' + (targetIndex + 1) + '/' + scanTargets.length + ')...',
      });

      for (let pageNum = 1; pageNum <= MAX_PAGES_PER_TARGET; pageNum++) {
        if (STATE.stopRequested) break;

        const pageParam = pageNum - 1;
        const url = buildPageUrl(target.url, pageParam);

        sendToApp({ type: 'PROGRESS', message: 'Mở "' + target.name + '" - trang ' + pageNum + '...' });
        await navigateTab(tabId, url, 2000);

        const out = await chrome.scripting.executeScript({
          target: { tabId },
          func: extractDomPageInPage,
          args: [{ scrollSteps: scrollSteps, scrollDelay: 500 }],
        });
        const data = (out && out[0] && out[0].result) || { items: [] };

        let added = 0;
        for (const it of data.items) {
          const k = it.shopid + '_' + it.itemid;
          const existing = seen.get(k);
          if (existing) {
            if (existing.category === 'Tất cả sản phẩm' && !target.isFallback) {
              existing.category = target.name;
              existing.category_url = target.url;
            }
            continue;
          }
          it.category = target.name;
          it.category_url = target.url;
          seen.set(k, it);
          items.push(it);
          added++;
          if (maxItems > 0 && items.length >= maxItems) {
            shouldStop = true;
            break;
          }
        }

        scannedPageCount++;
        sendToApp({
          type: 'PAGE_DONE',
          pageIndex: scannedPageCount,
          category: target.name,
          categoryIndex: targetIndex + 1,
          categoryCount: scanTargets.length,
          categoryPage: pageNum,
          count: items.length,
          added: added,
          total: (finalShop && finalShop.item_count) || null,
        });

        if (added === 0) {
          emptyStreak++;
          if (emptyStreak >= 2) {
            sendToApp({ type: 'PROGRESS', message: '"' + target.name + '": 2 trang liên tiếp không có sản phẩm mới -> chuyển danh mục.' });
            break;
          }
        } else {
          emptyStreak = 0;
        }

        if (shouldStop) break;
        if (finalShop && finalShop.item_count && items.length >= finalShop.item_count) {
          sendToApp({ type: 'PROGRESS', message: 'Đã đạt item_count của shop (' + finalShop.item_count + ') -> dừng.' });
          shouldStop = true;
          break;
        }
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      }
    }

    finalItems = items;

    sendToApp({
      type: 'SCAN_DONE',
      items: finalItems,
      shop: finalShop,
      stopped: STATE.stopRequested,
    });
  } catch (e) {
    sendToApp({ type: 'SCAN_ERROR', error: 'Lỗi: ' + (e.message || e), items: finalItems });
  } finally {
    if (tabId) { try { await chrome.tabs.remove(tabId); } catch (_) {} }
    STATE.scanning = false;
    STATE.tabId = null;
  }
}

// ============================================================
// Message router
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'START_SCAN') {
    if (STATE.scanning) {
      sendResponse({ ok: false, error: 'Đang quét, vui lòng đợi hoặc bấm Dừng.' });
      return true;
    }
    const appTabId = sender.tab ? sender.tab.id : null;
    runScan(msg.payload, appTabId);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'STOP_SCAN') {
    STATE.stopRequested = true;
    sendResponse({ ok: true });
    return true;
  }
});
