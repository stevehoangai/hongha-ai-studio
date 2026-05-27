module.exports = function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  res.status(200).json({
    ok: true,
    name: "Competitor Analysis Dashboard",
    runtime: "vercel"
  });
};
