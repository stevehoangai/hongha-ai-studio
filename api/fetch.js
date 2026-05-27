const browserHeaders = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
};

module.exports = async function handler(req, res) {
  const target = req.query.url || "";
  let url;
  try {
    url = new URL(target);
  } catch {
    res.status(400).json({ ok: false, error: "URL khong hop le." });
    return;
  }

  if (!isAllowedThienLongHost(url)) {
    res.status(403).json({ ok: false, error: "Proxy chi cho phep thienlong.vn." });
    return;
  }

  try {
    const upstream = await fetch(url.href, {
      headers: {
        ...browserHeaders,
        referer: "https://thienlong.vn/"
      },
      redirect: "follow"
    });
    const text = await upstream.text();
    res.setHeader("content-type", upstream.headers.get("content-type") || "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-upstream-status", String(upstream.status));
    res.status(upstream.ok ? 200 : upstream.status).send(text);
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message || String(error) });
  }
};

function isAllowedThienLongHost(url) {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && (host === "thienlong.vn" || host.endsWith(".thienlong.vn"));
}
