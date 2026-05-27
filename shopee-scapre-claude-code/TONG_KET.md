# Tổng kết hội thoại: Xây dựng Chrome Extension quét sản phẩm Shopee

> Tài liệu này tóm tắt toàn bộ quá trình thiết kế và iterate Chrome Extension "Shopee Shop Scraper" — từ ý tưởng ban đầu đến phiên bản DOM-only ổn định.

---

## 1. Bối cảnh & yêu cầu

Người dùng có 1 tài liệu kiến thức nền về Chrome Extension + AI Product Research (`kien_thuc_hoi_thoai_chrome_extension.md`), trong đó nhắc đến ý tưởng quét sản phẩm đối thủ trên các sàn TMĐT.

**Yêu cầu gốc:**
- Chrome Extension dạng popup mở app trên 1 trang riêng.
- Input link cửa hàng Shopee (vd `https://shopee.vn/vppklong#product_list`).
- Quét toàn bộ sản phẩm của shop trên tất cả các trang.
- Hiển thị bảng dữ liệu.
- Xuất CSV / XLSX.

---

## 2. Kiến trúc tổng thể

```
shopee-scapre-claude-code/
├── manifest.json              ← Manifest V3, host_permissions: shopee.vn
├── popup/
│   ├── popup.html             ← Chỉ 1 nút "Mở ứng dụng"
│   ├── popup.css
│   └── popup.js               ← chrome.tabs.create(app/app.html)
├── app/
│   ├── app.html               ← Trang chính (mở trong tab mới)
│   ├── app.css
│   └── app.js                 ← UI logic + message handler + export
├── background/
│   └── service-worker.js      ← Orchestrator: mở tab Shopee + inject scraper
├── lib/
│   └── xlsx-writer.js         ← Tự build .xlsx (ZIP STORE + SpreadsheetML)
├── README.md
└── TONG_KET.md                ← File này
```

### Vai trò từng phần

| Component | Vai trò |
|---|---|
| **Popup** | Cực gọn — chỉ có 1 nút mở app trong tab mới. Tránh giới hạn UI của popup. |
| **App page** | Trang đầy đủ: input URL, log, progress bar, bảng dữ liệu, nút xuất CSV/XLSX, ô lọc. |
| **Service Worker** | Orchestrator: nhận `START_SCAN`, mở tab ngầm tới shopee.vn, inject script vào tab đó, gom kết quả, gửi về app. |
| **xlsx-writer.js** | Viết file `.xlsx` thật (ZIP uncompressed + SpreadsheetML XML), không phụ thuộc thư viện ngoài. |

### Luồng quét tổng quát

```
[App page]  ──START_SCAN──▶  [Service Worker]
                                   │
                                   ├─ chrome.tabs.create(shop URL, active:false)
                                   ├─ chờ tab load xong (chrome.tabs.onUpdated status=complete)
                                   ├─ chrome.scripting.executeScript(scraper, args)
                                   │     └─ scraper chạy trong context shopee.vn
                                   │        (có sẵn cookie, parse DOM, fetch API ...)
                                   ├─ nhận kết quả Promise<{items[], shop}>
                                   └─ chrome.tabs.remove(tab)
                                   │
[App page]  ◀──SCAN_DONE──   [Service Worker]
       │
       └─ render bảng + bật nút Xuất CSV/XLSX
```

---

## 3. Hành trình iterate (5 lần lớn)

### Lần 1 — Version đầu: API mode

**Cách làm:**
- Mở tab ngầm tới shopee.vn để có cookie hợp lệ.
- Inject script gọi API nội bộ Shopee:
  - `/api/v4/shop/get_shop_detail?username=X` → shopid + tên shop + item_count.
  - `/api/v4/search/search_items?match_id={shopid}&newest={offset}&limit={N}` → list sản phẩm theo trang.

**Lý do:** API trả JSON cấu trúc rõ, có đầy đủ fields (name, price, sold, rating, stock...).

### Lần 2 — Bug: HTTP 403 ở search_items

User báo: shop detail OK (lấy được shopid + 357 sản phẩm + 278.643 followers), nhưng search_items trả về 403.

**Fix:**
- Đọc `csrftoken` từ cookie, thêm header `x-csrftoken`.
- Probe 3 endpoint theo thứ tự ưu tiên:
  1. `/api/v4/shop/search_items` (riêng cho shop, ít bị chặn).
  2. `/api/v4/recommend/recommend?bundle=shop_page_product_tab_main` (endpoint trang shop thật).
  3. `/api/v4/search/search_items` (fallback cuối).
- Retry 403/429 với backoff 2s → 4s.
- Auto switch endpoint giữa chừng nếu endpoint chính chết.

### Lần 3 — Vẫn 403 ở cả 3 endpoint → cần DOM mode

User báo "Cả 3 endpoint đều bị Shopee chặn (HTTP 403)" → đề nghị có thể dùng DOM load không.

**Fix: Hybrid mode**
- Thêm dropdown "Phương pháp": Auto / DOM only / API only.
- **DOM mode (mới):** Service worker tự lái navigation qua `/{shop}?page=N` cho từng trang, inject `extractDomPageInPage` để parse DOM trên trang đó.
- **Auto mode:** Thử API trước. Nếu API probe trả về `{blocked: true}` → tự chuyển DOM mode.

### Lần 4 — User yêu cầu bỏ API triệt để + sửa nhiều bug

**Yêu cầu:**
- Bỏ hoàn toàn API mode.
- Dedup nghiêm ngặt theo `shopid_itemid`.
- Giá VND chính xác, không làm tròn, dấu `.` = phân tách hàng nghìn.
- Tách rõ giá hiện tại / giá gốc / % giảm / số sao / số đánh giá / "10k đã bán" → 10000.

**Fix:**
- Service worker chỉ còn DOM mode, không gọi `/api/v4/*` nào nữa.
- Shop info đọc từ DOM: `<title>` → tên shop; regex `X sản phẩm` / `Người theo dõi` trong body text.
- DOM extractor được viết lại với:
  - Strict dedup bằng `Map<shopid_itemid>` trong page + `Set` cross-page.
  - `parsePricesFromText()` regex `/[\d][\d.,]*/g` rồi `replace(/[.,]/g, '')` → VND nguyên.
  - Tách strikethrough (giá gốc) khỏi non-strikethrough (giá hiện tại) qua `collectLineThroughInside()`.
  - Discount % từ badge `-NN%` hoặc tự tính `(gốc - hiện tại) / gốc`.
  - Rating từ `width:N%` của `.shopee-rating-stars__lit`.
  - Sold dùng `parseSold()` xử lý 3 case: VN decimal `1,2k`, EN decimal `1.5k`, thousands separator `1.234`.

### Lần 5 — User: nếu có khoảng giá thì lấy cả khoảng giá

**Yêu cầu:** Sản phẩm có biến thể thì giá là khoảng (vd `85.000 - 120.000`). Lấy cả khoảng giá là OK.

**Fix:**
- Extractor trả về `price_min` + `price_max` (không chỉ 1 giá trị) cho cả giá hiện tại lẫn giá gốc.
- Helper `fmtPriceRange(min, max)` → `"85.000₫"` hoặc `"85.000₫ - 120.000₫"`.
- Export có **6 cột giá**: `Giá min` / `Giá max` / `Khoảng giá` (text) / `Giá gốc min` / `Giá gốc max` / `Khoảng giá gốc`.

### Lần 6 — Bug nghiêm trọng: kết quả trống

User gửi screenshot: bảng có cột "TÊN SẢN PHẨM" là 1 cục text dài lẫn name + giá + sold (`Sổ Caro... MS: 9349.350₫-15%4.99k+ đã bán`), các cột GIÁ / GIÁ GỐC / KHO / ĐÃ BÁN / ⭐ / LƯỢT THÍCH đều **trống**.

**Nguyên nhân:**
- Shopee đã **bỏ hết `data-sqe`** trên layout mới → selector `[data-sqe="name"]`, `[data-sqe="price"]`, `[data-sqe="performance"]` đều không tìm thấy.
- Fallback `name = anchor.textContent` lấy text của TOÀN BỘ card (anchor wrap cả card).
- Regex giá cũ chỉ bắt `₫9.350` (₫ ở trước), Shopee mới render `9.350₫` (₫ ở SAU số).

**Fix cuối (DOM-bền-vững):**
- **Tên:** Lấy từ `<img alt="...">` (Shopee gán alt = tên SP đầy đủ, sạch sẽ). Fallback: `[data-sqe="name"]` → anchor `title`/`aria-label` → text-node dài nhất KHÔNG chứa `₫`/`%`/"đã bán".
- **Tìm card đúng kích thước:** Đi lên parent cho tới khi parent chứa ≥ 2 product anchor (đã thoát khỏi 1 card).
- **Walk text node + classify:** Duyệt tất cả `TextNode` trong card; mỗi node:
  - Chứa `₫` → trích các số VN (`\d{1,3}(?:\.\d{3})+`), check `hasLineThroughAncestor` → vào `currentPrices[]` hoặc `originalPrices[]`.
  - Chỉ chứa `-NN%` → discount.
  - Chứa "đã bán" → sold.
- **Rating + review count:** Selector `.shopee-rating-stars__lit` (width) + regex `(N)` / `N đánh giá`.

---

## 4. Các quyết định kỹ thuật quan trọng

### 4.1. Tại sao không dùng JSZip/SheetJS từ CDN?

Manifest V3 CSP cấm load script từ CDN. Không muốn bundle thư viện ~500KB.

**Giải pháp:** Tự viết XLSX writer ~180 dòng với:
- CRC32 table tự gen.
- ZIP STORE (method=0, uncompressed) — chỉ cần header + raw data, không cần thuật toán Deflate.
- SpreadsheetML XML tối thiểu: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml`.

### 4.2. Tại sao không inject content script tĩnh, mà dùng `chrome.scripting.executeScript`?

Content script tĩnh chạy mỗi khi user vào shopee.vn → user không muốn extension can thiệp khi họ duyệt thường.

**Giải pháp:** Inject động khi cần (1 lần / 1 trang quét). Service worker mở tab ngầm `active:false`, inject script, đóng tab. User không hề thấy.

### 4.3. Service worker đóng vai trò orchestrator (không phải scraper)

Service worker MV3 có thể idle bất cứ lúc nào → không thể tự fetch dài hạn. Nhưng nó CÓ THỂ điều khiển tab (mở/đóng/navigate) và inject script.

**Giải pháp:**
- Service worker: open tab → loop `navigateTab + executeScript` → close tab.
- Scraper: chạy trong context tab shopee.vn (sống cùng tab) → có cookie + DOM thật.

### 4.4. Phân trang qua `?page=N` thay vì click button

Shopee shop page là SPA. Click pagination button cần wait cho re-render, dễ flaky.

**Giải pháp:** `chrome.tabs.update(tabId, {url: baseUrl + '?page=' + N})` — full navigation, tab.onUpdated.status=complete fire chuẩn.

### 4.5. Dedup chéo trang bằng `Set<shopid_itemid>`

Pagination có thể trùng (ví dụ Shopee đôi khi trả page 1 cho `?page=999`). Dedup nghiêm ngặt giúp:
- Không double-count.
- Là **stop condition**: 2 trang liên tiếp `added === 0` → dừng.

### 4.6. Parse giá VND: dấu `.` là phân tách hàng nghìn

User nhấn mạnh điểm này. VND ≥ 1000, không có decimal.

**Quy ước:**
- `85.000₫` → 85000 (parseInt sau khi `.replace(/[.,]/g, '')`).
- `1.234.567₫` → 1234567.
- Sold count "1,2k" → 1200 (chỉ ở đây dấu `,` mới là decimal).

### 4.7. Tên SP lấy từ `<img alt>` thay vì textContent

`anchor.textContent` (anchor wrap cả card) = TẤT CẢ text trong card jammed together → ăn cả price/sold vào name.

`<img alt>` chỉ chứa tên SP đầy đủ, sạch sẽ → đây là source of truth của Shopee cho tên.

---

## 5. API của extractor cuối (DOM mode)

Output cho mỗi sản phẩm:

```js
{
  itemid: 22224858054,
  shopid: 29741058,
  name: "Sổ Caro lò xo kép ngang KLONG B7 120 trang 100/76",

  // Khoảng giá (min == max khi 1 mức giá)
  price_min: 9350,         // VND nguyên
  price_max: 9350,
  original_price_min: 11000,
  original_price_max: 11000,
  discount_percent: 15,

  // Alias cho code cũ
  price: 9350,
  price_before_discount: 11000,

  // Đếm
  historical_sold: 4990,   // "4.99k+" → 4990
  rating_star: 4.8,        // 0..5, 1 chữ số thập phân
  review_count: 123,       // null nếu không hiển thị
  stock: null,             // listing card không có
  liked_count: null,

  // Ảnh
  image: "vn-11134207-7r98o-lm...",  // image_id Shopee CDN

  _source: 'dom',
}
```

---

## 6. Export columns

### CSV / XLSX 20 cột:

| # | Cột | Kiểu |
|---|---|---|
| 1 | STT | int |
| 2 | itemid | int |
| 3 | shopid | int |
| 4 | Tên sản phẩm | text |
| 5 | Shop | text |
| 6 | Giá min (VND) | int |
| 7 | Giá max (VND) | int |
| 8 | Khoảng giá | text (`X - Y`) |
| 9 | Giá gốc min (VND) | int |
| 10 | Giá gốc max (VND) | int |
| 11 | Khoảng giá gốc | text |
| 12 | % giảm | int |
| 13 | Đã bán | int |
| 14 | Số sao | float |
| 15 | Số đánh giá | int |
| 16 | Kho | int (thường null) |
| 17 | Lượt thích | int (thường null) |
| 18 | Ảnh chính | URL |
| 19 | Link sản phẩm | URL |
| 20 | Capture lúc | ISO 8601 |

---

## 7. Cách cài & dùng

```
1. chrome://extensions → Developer mode ON → Load unpacked
   → chọn thư mục D:\CHROME APP\shopee-scapre-claude-code

2. Bấm icon extension → "Mở ứng dụng" (popup chỉ làm việc này).

3. Trong app:
   - Dán link shop: https://shopee.vn/vppklong (hoặc /shop/123456)
   - Tuỳ chọn:
     - Giới hạn tối đa (0 = không giới hạn)
     - Delay (ms) giữa các trang — mặc định 600ms
     - Số lần cuộn / trang — mặc định 10 (giúp lazy-load)
   - Bấm "Bắt đầu quét"

4. Theo dõi log + progress bar. Có thể bấm "Dừng" bất cứ lúc nào.

5. Khi xong → Xuất CSV / Xuất XLSX.
```

---

## 8. Lưu ý quan trọng

- **Chỉ lấy dữ liệu công khai** mà Shopee hiển thị cho khách.
- Trường **`historical_sold` là "đã bán công khai"** Shopee tự hiển thị (gọi đúng là `public_sold_count`), KHÔNG phải doanh số bán nội bộ thật. Không dùng để báo cáo doanh thu.
- Shopee có thể đổi layout/HTML → extractor cần được cập nhật. Code đã có nhiều fallback (img.alt → data-sqe → walk text node) để chịu được layout thay đổi.
- Service worker MV3 có thể idle. Nếu đóng tab app trong lúc quét → kết quả cuối có thể mất.
- Nếu shop quá lớn (> 5000 sản phẩm), tăng `Delay` lên 1000–2000ms để tránh bị Shopee chặn.

---

## 9. Có thể mở rộng tiếp

- Lưu lịch sử giá vào IndexedDB → so sánh nhiều lần quét.
- Cảnh báo khi giá thay đổi giữa các lần quét.
- Queue quét song song nhiều shop.
- Gửi dữ liệu qua webhook n8n / backend nội bộ.
- AI chuẩn hoá tên sản phẩm + so sánh với catalog nội bộ (đúng theo ý tưởng "AI Product Research Extension" trong tài liệu nền).

---

## 10. Tóm tắt 1 câu

> Chrome Extension MV3 quét toàn bộ sản phẩm 1 cửa hàng Shopee bằng DOM scraping (không gọi API), tự lái navigation qua tất cả các trang `?page=N`, classify text node để tách name / price range / discount / sold / rating, dedup nghiêm ngặt, xuất CSV/XLSX 20 cột — toàn bộ không phụ thuộc thư viện ngoài.
