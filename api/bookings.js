/**
 * Vercel Serverless Function — Bookings API
 * Proxies GitHub API for booking read/write operations.
 */

const GITHUB_USERNAME = 'jijie-cc';
const GITHUB_REPO = 'piano-booking';

function githubApi(path, method, body) {
  const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${path}`;
  const headers = {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'piano-booking-vercel',
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

function decodeContent(content) {
  const binary = atob(content);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeContent(str) {
  const bytes = new TextEncoder().encode(str);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (!process.env.GITHUB_TOKEN) {
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  const path = req.url.replace('/api/bookings', '');

  try {
    // GET /api/bookings?date=YYYY-MM-DD
    if (req.method === 'GET' && req.query.date && !path) {
      const filePath = `data/${req.query.date}.json`;
      const ghRes = await githubApi(filePath, 'GET');
      if (ghRes.status === 404) return res.json([]);
      if (!ghRes.ok) throw new Error(`GitHub API error: ${ghRes.status}`);
      const data = await ghRes.json();
      const bookings = JSON.parse(decodeContent(data.content));
      return res.json(bookings);
    }

    // GET /api/bookings/all
    if (req.method === 'GET' && path === '/all') {
      const listRes = await githubApi('data/', 'GET');
      if (listRes.status === 404) return res.json([]);
      if (!listRes.ok) throw new Error(`GitHub API error: ${listRes.status}`);
      const files = await listRes.json();
      if (!Array.isArray(files) || files.length === 0) return res.json([]);

      const fetches = files.map(async (f) => {
        const r = await githubApi(f.path, 'GET');
        if (!r.ok) return null;
        const d = await r.json();
        const bookings = JSON.parse(decodeContent(d.content));
        const dateStr = f.name.replace('.json', '');
        return bookings.map(b => ({ ...b, date: dateStr }));
      });

      const results = await Promise.all(fetches);
      const allBookings = results.flat().filter(Boolean);
      allBookings.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        if (a.r !== b.r) return a.r - b.r;
        return a.t - b.t;
      });
      return res.json(allBookings);
    }

    // POST /api/bookings
    if (req.method === 'POST' && !path) {
      const { roomNumber, slot, name, className, phone, signature, date } = req.body;
      if (!roomNumber || slot == null || !name || !className || !signature || !date) {
        return res.status(400).json({ error: '缺少必填字段' });
      }

      const filePath = `data/${date}.json`;
      const maxRetries = 3;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const getRes = await githubApi(filePath, 'GET');
        let bookings = [];
        let sha = null;

        if (getRes.status === 404) {
          bookings = [];
        } else if (getRes.ok) {
          const d = await getRes.json();
          sha = d.sha;
          bookings = JSON.parse(decodeContent(d.content));
        } else {
          return res.status(502).json({ error: `读取数据失败: HTTP ${getRes.status}` });
        }

        const conflict = bookings.find(b => b.r === roomNumber && b.t === slot);
        if (conflict) {
          return res.status(409).json({ error: '该时段已被他人抢先预约' });
        }

        bookings.push({
          r: roomNumber, t: slot, n: name,
          c: className, p: phone || '', s: signature,
        });

        const putBody = {
          content: encodeContent(JSON.stringify(bookings)),
          message: `预约: 琴房${roomNumber} ${slot}:00 ${name}`,
        };
        if (sha) putBody.sha = sha;

        const putRes = await githubApi(filePath, 'PUT', putBody);

        if (putRes.ok) {
          return res.json({ success: true, message: '预约成功' });
        }

        if (putRes.status === 422 && attempt < maxRetries - 1) continue;
        if (putRes.status === 422) return res.status(409).json({ error: '预约冲突，请重试' });
        return res.status(502).json({ error: `保存失败: HTTP ${putRes.status}` });
      }
      return res.status(500).json({ error: '预约失败，请重试' });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
