const { scanShopee, toPositiveInt, clamp, SHOPEE_LIMIT_MAX } = require("../../lib/shopee");

module.exports = async function handler(req, res) {
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("x-accel-buffering", "no");

  const abortController = new AbortController();
  req.on("close", () => abortController.abort());

  const emit = (type, payload = {}) => {
    if (!res.writableEnded) {
      res.write(`${JSON.stringify({ type, ...payload })}\n`);
    }
  };

  try {
    const params = {
      url: req.query.url || "",
      maxItems: toPositiveInt(req.query.maxItems),
      limit: clamp(toPositiveInt(req.query.limit) || 60, 10, SHOPEE_LIMIT_MAX),
      delayMs: clamp(toPositiveInt(req.query.delayMs) || 700, 250, 10000)
    };
    await scanShopee(params, { signal: abortController.signal, emit });
  } catch (error) {
    if (!abortController.signal.aborted) {
      emit("ERROR", {
        error: `${error.message || error} Tren Vercel khong ho tro Chrome profile/dang nhap tuong tac; hay dung ban local neu Shopee chan API public.`
      });
    }
  } finally {
    res.end();
  }
};
