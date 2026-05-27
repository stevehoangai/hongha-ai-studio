module.exports = function handler(req, res) {
  res.status(501).json({
    ok: false,
    error: "Phiên Shopee chỉ khả dụng ở bản local. Vercel không hỗ trợ mở Chrome profile tương tác."
  });
};
