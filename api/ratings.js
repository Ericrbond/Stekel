/* Vercel serverless — GET /api/ratings?slug=xxx  →  { avg, count }
                       POST /api/ratings           ← { slug, rating }  →  { avg, count } */
const SUPABASE_URL = 'https://zinyklmxvptuvbhfnklf.supabase.co';

function headers() {
  const key = process.env.SUPABASE_SECRET;
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const h = headers();

  if (req.method === 'GET') {
    const { slug } = req.query;
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/ratings?slug=eq.${encodeURIComponent(slug)}&select=rating`,
      { headers: h }
    );
    const rows = await r.json();
    const count = Array.isArray(rows) ? rows.length : 0;
    const avg = count > 0 ? rows.reduce((s, r) => s + r.rating, 0) / count : null;
    return res.json({ avg: avg !== null ? Math.round(avg * 10) / 10 : null, count });
  }

  if (req.method === 'POST') {
    const { slug, rating } = req.body || {};
    if (!slug || !Number.isInteger(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ error: 'invalid input' });

    await fetch(`${SUPABASE_URL}/rest/v1/ratings`, {
      method: 'POST',
      headers: { ...h, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ slug, rating }),
    });

    const r2 = await fetch(
      `${SUPABASE_URL}/rest/v1/ratings?slug=eq.${encodeURIComponent(slug)}&select=rating`,
      { headers: h }
    );
    const rows = await r2.json();
    const count = Array.isArray(rows) ? rows.length : 0;
    const avg = count > 0 ? rows.reduce((s, r) => s + r.rating, 0) / count : null;
    return res.json({ avg: avg !== null ? Math.round(avg * 10) / 10 : null, count });
  }

  return res.status(405).json({ error: 'method not allowed' });
};
