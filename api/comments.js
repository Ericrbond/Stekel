/* Vercel serverless — GET /api/comments?slug=xxx  →  [{ id, author, body, created_at }]
                       POST /api/comments          ← { slug, author?, body }  →  comment */
const SUPABASE_URL = 'https://zinyklmxvptuvbhfnklf.supabase.co';

function headers() {
  const key = process.env.SUPABASE_SECRET;
  if (!key) throw new Error('SUPABASE_SECRET not configured');
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

  let h;
  try { h = headers(); } catch {
    if (req.method === 'GET') return res.json([]);
    return res.status(503).json({ error: 'Comments unavailable' });
  }

  try {
    if (req.method === 'GET') {
      const { slug } = req.query;
      if (!slug) return res.status(400).json({ error: 'slug required' });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/comments?slug=eq.${encodeURIComponent(slug)}&order=created_at.asc&select=id,author,body,created_at`,
        { headers: h }
      );
      if (!r.ok) return res.json([]);
      return res.json(await r.json());
    }

    if (req.method === 'POST') {
      const { slug, author, body } = req.body || {};
      if (!slug || !body || typeof body !== 'string' || body.trim().length < 2)
        return res.status(400).json({ error: 'invalid input' });
      if (body.length > 2000)
        return res.status(400).json({ error: 'comment too long' });

      const r = await fetch(`${SUPABASE_URL}/rest/v1/comments`, {
        method: 'POST',
        headers: { ...h, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          slug,
          author: (author && author.trim()) ? author.trim().slice(0, 50) : 'Anonymous',
          body: body.trim(),
        }),
      });
      if (!r.ok) return res.status(500).json({ error: 'failed to save' });
      const [comment] = await r.json();
      return res.status(201).json(comment);
    }
  } catch (err) {
    return res.status(500).json({ error: 'server error' });
  }

  return res.status(405).json({ error: 'method not allowed' });
};
