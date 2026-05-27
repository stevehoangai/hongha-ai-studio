// App page logic: gửi yêu cầu quét tới service worker, nhận progress,
// render bảng, lọc, xuất CSV / XLSX. Chỉ dùng DOM mode.

const els = {
  url: document.getElementById('shopUrl'),
  btnScan: document.getElementById('btnScan'),
  btnStop: document.getElementById('btnStop'),
  maxItems: document.getElementById('maxItems'),
  delayMs: document.getElementById('delayMs'),
  scrollSteps: document.getElementById('scrollSteps'),
  status: document.getElementById('status'),
  shopInfo: document.getElementById('shopInfo'),
  statCount: document.getElementById('statCount'),
  statPage: document.getElementById('statPage'),
  statTotal: document.getElementById('statTotal'),
  bar: document.getElementById('bar'),
  log: document.getElementById('log'),
  filter: document.getElementById('filterInput'),
  btnCsv: document.getElementById('btnCsv'),
  btnXlsx: document.getElementById('btnXlsx'),
  btnClear: document.getElementById('btnClear'),
  tbody: document.getElementById('tbody'),
  empty: document.getElementById('empty'),
};

const STATE = {
  items: [],
  shop: null,
  scanning: false,
  total: null,
};

// ---------- Helpers ----------
function setStatus(text, cls) {
  els.status.textContent = text;
  els.status.className = 'status' + (cls ? ' ' + cls : '');
}

function log(msg, cls) {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  const t = new Date().toLocaleTimeString();
  div.textContent = '[' + t + '] ' + msg;
  els.log.appendChild(div);
  els.log.scrollTop = els.log.scrollHeight;
}

function fmtDongNumber(n) {
  if (n == null || isNaN(n)) return '';
  return Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
}

function fmtDong(n) {
  const text = fmtDongNumber(n);
  return text ? text + 'đ' : '';
}

function fmtInt(n) {
  if (n == null || isNaN(n)) return '';
  return Number(n).toLocaleString('vi-VN');
}

// Format khoảng giá theo đơn vị đồng: "85.000đ" hoặc "85.000 - 120.000đ"
function fmtPriceRange(min, max) {
  if (min == null && max == null) return '';
  if (min == null) return fmtDong(max);
  if (max == null || max === min) return fmtDong(min);
  return fmtDongNumber(min) + ' - ' + fmtDong(max);
}

function shopeeImageUrl(imageId) {
  if (!imageId) return '';
  if (/^https?:\/\//.test(imageId)) return imageId;
  return 'https://down-vn.img.susercontent.com/file/' + imageId;
}

const DIACRITICS_RE = new RegExp('[\\u0300-\\u036F]', 'g');
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(DIACRITICS_RE, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function productUrl(item) {
  if (!item || !item.itemid || !item.shopid) return '';
  return 'https://shopee.vn/' + slugify(item.name) + '-i.' + item.shopid + '.' + item.itemid;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ---------- Render ----------
function renderTable() {
  const filter = els.filter.value.trim().toLowerCase();
  const items = STATE.items.filter((it) => {
    if (!filter) return true;
    const hay = ((it.name || '') + ' ' + (it.category || '') + ' ' + (it.shop_name || '')).toLowerCase();
    return hay.includes(filter);
  });

  els.empty.style.display = items.length ? 'none' : 'block';
  els.tbody.innerHTML = '';

  const frag = document.createDocumentFragment();
  items.forEach((it, idx) => {
    const tr = document.createElement('tr');
    const img = shopeeImageUrl(it.image);
    const priceText = fmtPriceRange(it.price_min, it.price_max);
    const originalText = fmtPriceRange(it.original_price_min, it.original_price_max);
    const discount = it.discount_percent;
    const rating = it.rating_star;
    const reviewCount = it.review_count;
    const sold = it.historical_sold;
    const pUrl = productUrl(it);

    tr.innerHTML = ''
      + '<td>' + (idx + 1) + '</td>'
      + '<td>' + (img ? '<img class="thumb" loading="lazy" src="' + img + '" alt="">' : '') + '</td>'
      + '<td><span class="pname">' + escapeHtml(it.name || '') + '</span>'
      +     '<span class="pid">id: ' + it.itemid + '</span></td>'
      + '<td><span class="category">' + escapeHtml(it.category || '') + '</span></td>'
      + '<td class="num">' + priceText + '</td>'
      + '<td class="num">' + (originalText ? '<span class="price-old">' + originalText + '</span>' : '') + '</td>'
      + '<td class="num">' + (discount ? '<span class="discount">-' + discount + '%</span>' : '') + '</td>'
      + '<td class="num">' + fmtInt(it.stock) + '</td>'
      + '<td class="num">' + fmtInt(sold) + '</td>'
      + '<td class="num">' + (rating != null ? Number(rating).toFixed(1) : '') + (reviewCount != null ? ' <span class="muted">(' + fmtInt(reviewCount) + ')</span>' : '') + '</td>'
      + '<td class="num">' + fmtInt(it.liked_count) + '</td>'
      + '<td>' + escapeHtml(it.shop_name || (STATE.shop && STATE.shop.name) || '') + '</td>'
      + '<td>' + (pUrl ? '<a href="' + pUrl + '" target="_blank" rel="noopener">Mở</a>' : '') + '</td>';
    frag.appendChild(tr);
  });
  els.tbody.appendChild(frag);

  els.statCount.textContent = STATE.items.length.toLocaleString('vi-VN');
  els.btnCsv.disabled = STATE.items.length === 0;
  els.btnXlsx.disabled = STATE.items.length === 0;
  els.btnClear.disabled = STATE.items.length === 0 || STATE.scanning;
}

// ---------- Scan ----------
function setScanning(on) {
  STATE.scanning = on;
  els.btnScan.disabled = on;
  els.btnStop.disabled = !on;
  els.url.disabled = on;
  els.maxItems.disabled = on;
  els.delayMs.disabled = on;
  els.scrollSteps.disabled = on;
  els.btnClear.disabled = on || STATE.items.length === 0;
}

function startScan() {
  const url = els.url.value.trim();
  if (!url) { alert('Vui lòng nhập link cửa hàng Shopee.'); return; }

  STATE.items = [];
  STATE.shop = null;
  STATE.total = null;
  els.log.innerHTML = '';
  els.bar.style.width = '0%';
  els.statCount.textContent = '0';
  els.statPage.textContent = '0';
  els.statTotal.textContent = '—';
  els.shopInfo.textContent = '';
  renderTable();

  setScanning(true);
  setStatus('Đang khởi tạo DOM scan...', 'running');
  log('Bắt đầu quét: ' + url);

  chrome.runtime.sendMessage({
    type: 'START_SCAN',
    payload: {
      url,
      maxItems: parseInt(els.maxItems.value, 10) || 0,
      delayMs: parseInt(els.delayMs.value, 10) || 0,
      scrollSteps: parseInt(els.scrollSteps.value, 10) || 10,
    }
  }, (resp) => {
    if (chrome.runtime.lastError) {
      setStatus('Lỗi: ' + chrome.runtime.lastError.message, 'error');
      setScanning(false);
      return;
    }
    if (!resp || !resp.ok) {
      setStatus('Lỗi: ' + (resp && resp.error || 'Không xác định'), 'error');
      setScanning(false);
    }
  });
}

function stopScan() {
  if (!STATE.scanning) return;
  log('Yêu cầu dừng quét...', 'err');
  chrome.runtime.sendMessage({ type: 'STOP_SCAN' });
}

// ---------- Message handler từ service worker ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'SCAN_STARTED') {
    setStatus('Đang mở trang Shopee...', 'running');
    log('Đã mở tab background: ' + msg.shopUrl);
    return;
  }

  if (msg.type === 'SHOP_INFO') {
    STATE.shop = msg.shop;
    const parts = [];
    if (msg.shop.name || msg.shop.account) parts.push('Shop: ' + (msg.shop.name || msg.shop.account));
    if (msg.shop.shopid) parts.push('ID: ' + msg.shop.shopid);
    if (msg.shop.item_count != null) parts.push(fmtInt(msg.shop.item_count) + ' sản phẩm');
    if (msg.shop.follower_count != null) parts.push(fmtInt(msg.shop.follower_count) + ' followers');
    els.shopInfo.textContent = parts.join('  •  ');
    if (msg.shop.item_count) {
      STATE.total = msg.shop.item_count;
      els.statTotal.textContent = fmtInt(msg.shop.item_count);
    }
    log('✓ Đã xác định shop: ' + (msg.shop.name || '') + ' (shopid=' + msg.shop.shopid + ')', 'ok');
    return;
  }

  if (msg.type === 'TOTAL' && msg.total != null) {
    STATE.total = msg.total;
    els.statTotal.textContent = fmtInt(msg.total);
    return;
  }

  if (msg.type === 'PROGRESS') {
    setStatus(msg.message || 'Đang quét...', 'running');
    if (msg.message) log(msg.message);
    return;
  }

  if (msg.type === 'PAGE_DONE') {
    els.statPage.textContent = msg.pageIndex;
    els.statCount.textContent = fmtInt(msg.count || 0);
    if (msg.total) {
      const pct = Math.min(100, Math.round(msg.count / msg.total * 100));
      els.bar.style.width = pct + '%';
    } else {
      els.bar.style.width = Math.min(95, msg.pageIndex * 6) + '%';
    }
    const pageLabel = msg.category
      ? '"' + msg.category + '" / trang ' + (msg.categoryPage || msg.pageIndex)
      : 'Trang ' + msg.pageIndex;
    log('  ' + pageLabel + ': đã có ' + msg.count + ' sản phẩm' + (msg.added != null ? ' (+' + msg.added + ' mới)' : ''));
    return;
  }

  if (msg.type === 'SCAN_DONE') {
    STATE.items = msg.items || [];
    if (msg.shop) STATE.shop = msg.shop;
    els.bar.style.width = '100%';
    setStatus(msg.stopped
      ? 'Đã dừng. Lấy được ' + STATE.items.length + ' sản phẩm.'
      : 'Hoàn tất! Lấy được ' + STATE.items.length + ' sản phẩm.',
      msg.stopped ? 'stopped' : 'done');
    log((msg.stopped ? '⏹ Đã dừng. ' : '✓ Xong. ') + 'Tổng: ' + STATE.items.length + ' sản phẩm.', 'ok');
    setScanning(false);
    renderTable();
    return;
  }

  if (msg.type === 'SCAN_ERROR') {
    if (msg.items && msg.items.length) {
      STATE.items = msg.items;
      renderTable();
    }
    setStatus('Lỗi: ' + msg.error, 'error');
    log('✗ ' + msg.error, 'err');
    setScanning(false);
    return;
  }
});

// ---------- Export ----------
function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }).join(',')).join('\r\n');
}

function rangeTextDong(min, max) {
  if (min == null && max == null) return '';
  if (min == null) return fmtDongNumber(max);
  if (max == null || max === min) return fmtDongNumber(min);
  return fmtDongNumber(min) + ' - ' + fmtDongNumber(max);
}

function buildExportRows() {
  const headers = [
    'STT', 'itemid', 'shopid', 'Tên sản phẩm', 'Shop', 'Danh mục',
    'Giá min (đ)', 'Giá max (đ)', 'Khoảng giá (đ)',
    'Giá gốc min (đ)', 'Giá gốc max (đ)', 'Khoảng giá gốc (đ)',
    '% giảm',
    'Đã bán', 'Số sao', 'Số đánh giá',
    'Kho', 'Lượt thích',
    'Ảnh chính', 'Link sản phẩm', 'Capture lúc'
  ];
  const now = new Date().toISOString();
  const rows = [headers];
  STATE.items.forEach((it, i) => {
    const pMin = it.price_min != null ? it.price_min : it.price;
    const pMax = it.price_max != null ? it.price_max : pMin;
    const oMin = it.original_price_min != null ? it.original_price_min : it.price_before_discount;
    const oMax = it.original_price_max != null ? it.original_price_max : oMin;
    rows.push([
      i + 1,
      it.itemid || '',
      it.shopid || '',
      it.name || '',
      it.shop_name || (STATE.shop && STATE.shop.name) || '',
      it.category || '',
      pMin != null ? fmtDongNumber(pMin) : '',
      pMax != null ? fmtDongNumber(pMax) : '',
      rangeTextDong(pMin, pMax),
      oMin != null ? fmtDongNumber(oMin) : '',
      oMax != null ? fmtDongNumber(oMax) : '',
      rangeTextDong(oMin, oMax),
      it.discount_percent != null ? it.discount_percent : '',
      it.historical_sold != null ? it.historical_sold : '',
      it.rating_star != null ? it.rating_star : '',
      it.review_count != null ? it.review_count : '',
      it.stock != null ? it.stock : '',
      it.liked_count != null ? it.liked_count : '',
      shopeeImageUrl(it.image),
      productUrl(it),
      now,
    ]);
  });
  return rows;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

function exportCsv() {
  const rows = buildExportRows();
  const csv = '﻿' + toCsv(rows); // BOM để Excel hiểu UTF-8
  const name = exportFilename('csv');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
}

function exportXlsx() {
  const rows = buildExportRows();
  const sheetName = (STATE.shop && STATE.shop.name) ? STATE.shop.name : 'Products';
  const bytes = XlsxWriter.buildXlsx(rows, sheetName);
  const name = exportFilename('xlsx');
  downloadBlob(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    name
  );
}

function exportFilename(ext) {
  const shopName = STATE.shop && (STATE.shop.account || STATE.shop.name) || 'shopee-shop';
  const slug = slugify(shopName) || 'shop';
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return 'shopee-' + slug + '-' + ts + '.' + ext;
}

// ---------- Wire up ----------
els.btnScan.addEventListener('click', startScan);
els.btnStop.addEventListener('click', stopScan);
els.btnCsv.addEventListener('click', exportCsv);
els.btnXlsx.addEventListener('click', exportXlsx);
els.btnClear.addEventListener('click', () => {
  if (STATE.scanning) return;
  if (!confirm('Xóa toàn bộ dữ liệu đang hiển thị?')) return;
  STATE.items = [];
  STATE.shop = null;
  els.log.innerHTML = '';
  els.shopInfo.textContent = '';
  els.bar.style.width = '0%';
  els.statCount.textContent = '0';
  els.statPage.textContent = '0';
  els.statTotal.textContent = '—';
  setStatus('Sẵn sàng');
  renderTable();
});
els.filter.addEventListener('input', renderTable);

renderTable();
