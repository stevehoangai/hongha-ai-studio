# Thien Long Product Scanner

Chrome Extension tĩnh để quét thông tin sản phẩm công khai từ `https://thienlong.vn/products/` hoặc một URL collection/product của Thiên Long, sau đó xuất bảng `.xlsx` hoặc `.csv`.

Metadata: thực hiện bởi `khasnhng - CSI`.

## Chức năng

- Quét danh mục/collection từ menu công khai của `thienlong.vn`.
- Tự chạy phân trang collection và loại trùng theo URL sản phẩm.
- Quét trang chi tiết để lấy thêm thương hiệu, mã sản phẩm, tình trạng, màu sắc/phân loại, ảnh, mô tả và thông số kỹ thuật.
- Lưu tạm kết quả vào `chrome.storage.local`.
- Xuất Excel `.xlsx` nội bộ, không dùng CDN hay thư viện ngoài.
- Có delay giữa các request, mặc định `2000 ms`.
- Giao diện dùng đỏ/trắng làm chủ đạo theo tinh thần nhận diện VPP Hồng Hà.

## Cài vào Chrome

1. Mở `chrome://extensions`.
2. Bật `Developer mode`.
3. Chọn `Load unpacked`.
4. Chọn thư mục dự án:

   ```text
   D:\CHROME APP\scrape-product-infomation-thienlong
   ```

5. Bấm icon extension `Thien Long Scanner`, rồi chọn `Mở app quét`.

## Cách chạy

1. Giữ URL bắt đầu mặc định:

   ```text
   https://thienlong.vn/products/
   ```

2. Chạy thử nhỏ trước:
   - `Số trang / danh mục`: `1`
   - `Giới hạn sản phẩm`: `20`
   - Bật `Quét trang chi tiết`

3. Khi kết quả ổn, đặt:
   - `Số trang / danh mục`: `0`
   - `Giới hạn sản phẩm`: `0`

4. Bấm `Bắt đầu quét`.
5. Sau khi có dữ liệu, bấm `Xuất XLSX`.

## Cột dữ liệu xuất ra

- Nguồn
- Danh mục
- Breadcrumbs
- Tên sản phẩm
- Thương hiệu
- Mã sản phẩm
- Tình trạng
- Giá bán
- Giá gốc
- % giảm
- Số đã bán công khai
- Màu sắc / phân loại
- Link sản phẩm
- Link danh mục
- Trang list
- Hình ảnh
- Thông số kỹ thuật
- Mô tả
- Thời điểm quét
- Thời điểm quét chi tiết
- Ghi chú

## Lưu ý

App chỉ đọc dữ liệu công khai đang hiển thị trên website. Trường `Số đã bán công khai` không phải số bán hàng nội bộ thật của Thiên Long; đó chỉ là số website công khai tại thời điểm quét.

Không nên giảm delay quá thấp hoặc chạy nhiều lần liên tục. Website có thể thay đổi HTML, khi đó parser cần cập nhật selector.
