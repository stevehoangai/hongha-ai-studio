# Shopee Shop Scraper — Chrome Extension

Chrome Extension (Manifest V3) cho phép quét toàn bộ sản phẩm công khai của một cửa hàng Shopee từ link shop, hiển thị trong bảng dữ liệu và xuất ra **CSV** hoặc **XLSX**.

> Popup chỉ là 1 nút "Mở ứng dụng". Toàn bộ thao tác diễn ra trên 1 trang riêng (`app/app.html`) mở trong tab mới — đủ không gian cho input, log, bảng dữ liệu, các nút xuất file.

---

## 1. Cài đặt extension

1. Mở Chrome → vào `chrome://extensions`.
2. Bật **Developer mode** (góc phải trên).
3. Bấm **Load unpacked** → chọn thư mục dự án (`D:\CHROME APP\shopee-scapre-claude-code`).
4. Extension **Shopee Shop Scraper** sẽ xuất hiện trên thanh công cụ. Ghim lại để dùng nhanh.

---

## 2. Cách sử dụng

1. Bấm icon extension → popup hiện ra → bấm **Mở ứng dụng**.
2. Một tab mới chứa app sẽ mở. Dán link cửa hàng Shopee vào ô input:
   - `https://shopee.vn/vppklong`
   - `https://shopee.vn/vppklong#product_list`
   - `https://shopee.vn/shop/123456789`
3. Tuỳ chọn:
   - **Số sản phẩm/trang** — `30 / 60 / 100` (mặc định 100, càng cao càng nhanh).
   - **Giới hạn tối đa** — `0` = không giới hạn (lấy tất cả).
   - **Delay (ms)** — giãn cách giữa các request, mặc định 500ms để tránh bị Shopee chặn.
4. Bấm **Bắt đầu quét**.
5. Extension sẽ:
   - Mở 1 tab ngầm tới trang shop (để dùng cookies hợp lệ của shopee.vn).
   - Inject script gọi API nội bộ `api/v4/shop/get_shop_detail` để lấy `shopid`.
   - Gọi API `api/v4/search/search_items` (fallback sang `api/v4/shop/search_items`) lặp theo phân trang cho đến khi hết.
   - Log tiến độ trong khung "log" — bạn thấy từng trang đang quét.
   - Sau khi xong, tab ngầm tự đóng và bảng dữ liệu xuất hiện đầy đủ.
6. Có thể bấm **Dừng** bất cứ lúc nào — dữ liệu đã quét sẽ được giữ.
7. Bấm **Xuất CSV** hoặc **Xuất XLSX** để tải file. File tên dạng:
   ```
   shopee-{shop-username}-YYYY-MM-DD-HH-mm-ss.csv
   shopee-{shop-username}-YYYY-MM-DD-HH-mm-ss.xlsx
   ```

---

## 3. Các trường dữ liệu được xuất

| Cột | Mô tả |
|---|---|
| STT | Số thứ tự |
| itemid | ID sản phẩm Shopee |
| shopid | ID shop |
| Tên sản phẩm | Tên hiển thị |
| Shop | Tên cửa hàng |
| Danh mục | Danh mục sidebar nơi sản phẩm được tìm thấy |
| Brand | Thương hiệu (nếu có) |
| Giá min / max (đ) | Giá hiện tại theo đơn vị đồng; dấu `.` là phân tách hàng nghìn, ví dụ `98.000` |
| Khoảng giá (đ) | Khoảng giá đầy đủ nếu sản phẩm có biến thể; ví dụ `85.000 - 120.000` |
| Giá gốc min / max (đ) | Giá trước giảm theo đơn vị đồng |
| Khoảng giá gốc (đ) | Khoảng giá gốc đầy đủ nếu có |
| % giảm | Tính theo `(gốc - hiện tại) / gốc` |
| Kho | `stock` |
| Đã bán (public) | `historical_sold` — **số bán công khai** Shopee hiển thị (không phải doanh số nội bộ thật của shop) |
| Rating | Sao trung bình |
| Số đánh giá | Số review |
| Lượt thích | `liked_count` |
| Ảnh chính | URL ảnh CDN Shopee |
| Link sản phẩm | URL trang chi tiết |
| Capture lúc | Thời điểm xuất file (ISO 8601) |

---

## 4. Kiến trúc

```
shopee-scapre-claude-code/
├── manifest.json              ← Manifest V3, host permission shopee.vn
├── popup/
│   ├── popup.html             ← Nút "Mở ứng dụng"
│   ├── popup.css
│   └── popup.js               ← Mở app/app.html ở tab mới (focus tab cũ nếu có)
├── app/
│   ├── app.html               ← Trang chính: input + log + bảng + export
│   ├── app.css
│   └── app.js                 ← UI logic + nhận message từ service worker + export CSV/XLSX
├── background/
│   └── service-worker.js      ← Mở tab ngầm tới shopee.vn, inject scraper, forward progress
└── lib/
    └── xlsx-writer.js         ← Viết file .xlsx (ZIP STORE + SpreadsheetML), không phụ thuộc thư viện ngoài
```

**Luồng quét:**

```
[App page]  ──START_SCAN──▶  [Service Worker]
                                   │
                                   ├─ chrome.tabs.create(shop URL, active:false)
                                   ├─ chờ tab load xong
                                   ├─ chrome.scripting.executeScript(scrapeShopInPage)
                                   │     ├─ fetch /api/v4/shop/get_shop_detail
                                   │     └─ loop fetch /api/v4/search/search_items
                                   │            └─ sendMessage(PROGRESS / PAGE_DONE / SHOP_INFO)
                                   ├─ nhận kết quả cuối (items[])
                                   └─ chrome.tabs.remove(tab)
                                   │
[App page]  ◀──SCAN_DONE──   [Service Worker]
       │
       └─ render bảng + bật nút Xuất CSV/XLSX
```

---

## 5. Lưu ý kỹ thuật & rủi ro

- **Chỉ lấy dữ liệu công khai** mà Shopee hiển thị cho khách. Không đăng nhập tài khoản thay shop, không truy cập trang quản trị.
- Trường `Đã bán (public)` là `historical_sold` — Shopee tự hiển thị, không phải doanh số bán nội bộ thật. Đừng đem báo cáo như là "doanh thu".
- Shopee có thể đổi cấu trúc API hoặc thêm anti-bot. Nếu gặp lỗi HTTP 4xx liên tiếp:
  - Tăng **Delay** lên (1000–2000ms).
  - Thử lại sau vài phút.
  - Vào shopee.vn bằng tay 1 lần để đảm bảo có cookie hợp lệ.
- Shop quá lớn (> 5.000 sản phẩm) có thể mất vài phút. Theo dõi tiến độ trong khung log.
- Service worker MV3 có thể bị idle. Quá trình quét chạy trong tab ngầm nên không bị ảnh hưởng nhiều, nhưng nếu bạn đóng tab app trong lúc quét thì kết quả cuối có thể mất.

---

## 6. Mở rộng có thể làm sau

- Lưu lịch sử giá vào IndexedDB (so sánh nhiều lần quét).
- Cảnh báo khi giá thay đổi.
- Quét song song nhiều shop (queue).
- Gửi dữ liệu qua webhook n8n / backend nội bộ.
- Tích hợp AI chuẩn hoá tên sản phẩm + so sánh với catalog nội bộ.
