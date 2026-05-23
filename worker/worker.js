/**
 * Piano Room Booking — Cloudflare Worker API Proxy
 *
 * Secures the GitHub token and admin password server-side.
 * All booking read/write operations go through this worker.
 *
 * Deploy:  npx wrangler deploy
 * Secrets: wrangler secret put GITHUB_TOKEN
 *           wrangler secret put ADMIN_PASSWORD
 */

const GITHUB_USERNAME = 'jijie-cc';
const GITHUB_REPO = 'piano-booking';
const CORS_ORIGIN = '*';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function githubApi(path, method, body, token) {
  const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'piano-booking-worker',
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

// Decode base64 GitHub content to string
function decodeContent(content) {
  const binary = atob(content);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Encode string to base64 for GitHub API
function encodeContent(str) {
  const bytes = new TextEncoder().encode(str);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary);
}

// ============================================================
// GET /bookings?date=YYYY-MM-DD
// ============================================================
async function getBookings(token, dateStr) {
  const filePath = `data/${dateStr}.json`;
  const res = await githubApi(filePath, 'GET', null, token);

  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  const data = await res.json();
  return JSON.parse(decodeContent(data.content));
}

// ============================================================
// POST /bookings — create with optimistic locking
// ============================================================
async function createBooking(token, body) {
  const { roomNumber, slot, name, className, phone, signature, date } = body;

  if (!roomNumber || slot == null || !name || !className || !signature || !date) {
    return json({ error: '缺少必填字段' }, 400);
  }

  const filePath = `data/${date}.json`;
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const getRes = await githubApi(filePath, 'GET', null, token);
    let bookings = [];
    let sha = null;

    if (getRes.status === 404) {
      bookings = [];
    } else if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
      bookings = JSON.parse(decodeContent(data.content));
    } else {
      return json({ error: `读取数据失败: HTTP ${getRes.status}` }, 502);
    }

    // Check for conflict
    const conflict = bookings.find(b => b.r === roomNumber && b.t === slot);
    if (conflict) {
      return json({ error: '该时段已被他人抢先预约' }, 409);
    }

    // Add booking
    bookings.push({
      r: roomNumber,
      t: slot,
      n: name,
      c: className,
      p: phone || '',
      s: signature,
    });

    // Write back
    const putBody = {
      content: encodeContent(JSON.stringify(bookings)),
      message: `预约: 琴房${roomNumber} ${slot}:00 ${name}`,
    };
    if (sha) putBody.sha = sha;

    const putRes = await githubApi(filePath, 'PUT', putBody, token);

    if (putRes.ok) {
      return json({ success: true, message: '预约成功' });
    }

    if (putRes.status === 422 && attempt < maxRetries - 1) {
      continue; // SHA conflict, retry
    }

    if (putRes.status === 422) {
      return json({ error: '预约冲突，请重试' }, 409);
    }

    return json({ error: `保存失败: HTTP ${putRes.status}` }, 502);
  }

  return json({ error: '预约失败，请重试' }, 500);
}

// ============================================================
// POST /verify-password
// ============================================================
async function verifyPassword(request, env) {
  const { password } = await request.json();
  const adminPassword = env.ADMIN_PASSWORD || '1111';
  if (password === adminPassword) {
    return json({ success: true });
  }
  return json({ success: false, error: '密码错误' }, 401);
}

// ============================================================
// GET /bookings/all — export all history
// ============================================================
async function getAllBookings(token) {
  const listRes = await githubApi('data/', 'GET', null, token);
  if (listRes.status === 404) return [];

  if (!listRes.ok) throw new Error(`GitHub API error: ${listRes.status}`);

  const files = await listRes.json();
  if (!Array.isArray(files) || files.length === 0) return [];

  const fetches = files.map(async (f) => {
    const res = await githubApi(f.path, 'GET', null, token);
    if (!res.ok) return null;
    const data = await res.json();
    const bookings = JSON.parse(decodeContent(data.content));
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

  return allBookings;
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const token = env.GITHUB_TOKEN;
    if (!token) {
      return json({ error: 'Server not configured' }, 500);
    }

    try {
      if (method === 'GET' && path === '/bookings' && url.searchParams.has('date')) {
        const bookings = await getBookings(token, url.searchParams.get('date'));
        return json(bookings);
      }

      if (method === 'GET' && path === '/bookings/all') {
        const bookings = await getAllBookings(token);
        return json(bookings);
      }

      if (method === 'POST' && path === '/bookings') {
        const body = await request.json();
        return await createBooking(token, body);
      }

      if (method === 'POST' && path === '/verify-password') {
        return await verifyPassword(request, env);
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message || 'Internal error' }, 500);
    }
  },
};
