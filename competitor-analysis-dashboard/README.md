# Competitor Analysis Dashboard

Web app thống nhất cho 2 luồng quét dữ liệu công khai:

- Thiên Long catalog/product scanner.
- Shopee shop scanner.

## Chạy local

```powershell
.\start-dashboard.ps1
```

Sau đó mở:

```text
http://localhost:5177
```

App không cần cài package ngoài. Backend local dùng Node.js built-in để phục vụ dashboard, proxy HTML Thiên Long và gọi Shopee API public.

Với Shopee, nếu API public bị chặn hoặc website yêu cầu đăng nhập, bấm **Phiên Shopee** trong dashboard để mở Chrome profile riêng, đăng nhập Shopee trong cửa sổ đó, rồi chạy lại scanner.

## Cấu trúc

```text
competitor-analysis-dashboard/
├── server.js
├── start-dashboard.ps1
├── package.json
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js
    └── xlsx-writer.js
```
