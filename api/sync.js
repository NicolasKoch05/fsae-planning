// api/sync.js — Direct Google Calendar (iCal público) + Notion API
const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_MINUTES) || 60) * 60 * 1000;
const cache = {};

const GCAL_ICAL_URL =
  'https://calendar.google.com/calendar/ical/nkoch846%40gmail.com/public/basic.ics';

const NOTION_TOKEN = process.env.NOTION_TOKEN;

const NOTION_DATABASES = [
  { id: '2cfd1b4deb148077ab35f34f0c869289', area: 'electronica' },
  { id: '2dad1b4deb148002b73bd77d20d691a7', area: 'redes' },
  { id: '2d1d1b4deb1480479003c147f1dbf3b3', area: 'diseno' },
  { id: '2fed1b4deb14802a999ae1a506597ce7', area: 'simulacion' },
];

// ── iCal parser ───────────────────────────────────────────────────────────────
function parseICal(text) {
  // Unfold continuation lines (RFC 5545: CRLF + whitespace = continuation)
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const events = [];
  let ev = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') {
      if (ev) { const parsed = toEvent(ev); if (parsed) events.push(parsed); }
      ev = null; continue;
    }
    if (!ev) continue;

    const ci = line.indexOf(':');
    if (ci === -1) continue;
    const rawKey = line.slice(0, ci);
    const val = line.slice(ci + 1);
    // Store under base key (strips ;TZID=... params)
    const baseKey = rawKey.split(';')[0].toUpperCase();
    ev[baseKey] = val;
    if (rawKey.toUpperCase().includes('TZID')) {
      ev[baseKey + '_TZID'] = (rawKey.split('TZID=')[1] || '').split(';')[0];
    }
  }

  return events;
}

function toEvent(ev) {
  const title = (ev.SUMMARY || '').replace(/\\[,;]/g, '').replace(/\\n/g, ' ').trim();
  if (!title) return null;
  const { date, time: start } = parseDT(ev.DTSTART);
  const { time: end } = parseDT(ev.DTEND || '');
  if (!date || !date.startsWith('2026')) return null;
  return { date, start, end, title };
}

function parseDT(raw) {
  if (!raw) return { date: '', time: '' };
  // All-day: 8 digits (YYYYMMDD)
  if (/^\d{8}$/.test(raw)) {
    return { date: `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`, time: '' };
  }
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!m) return { date: '', time: '' };
  let [, yr, mo, dy, hh, mm] = m.map(Number);
  // UTC → Argentina (UTC-3)
  if (raw.endsWith('Z')) {
    const d = new Date(Date.UTC(yr, mo - 1, dy, hh, mm));
    d.setUTCHours(d.getUTCHours() - 3);
    yr = d.getUTCFullYear(); mo = d.getUTCMonth() + 1; dy = d.getUTCDate();
    hh = d.getUTCHours(); mm = d.getUTCMinutes();
  }
  const p = n => String(n).padStart(2, '0');
  return { date: `${yr}-${p(mo)}-${p(dy)}`, time: `${p(hh)}:${p(mm)}` };
}

// ── Notion ────────────────────────────────────────────────────────────────────
async function queryNotionDB(dbId, area) {
  const tasks = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) { console.error(`Notion ${dbId}:`, await r.text()); break; }
    const data = await r.json();

    for (const page of data.results) {
      const p = page.properties;

      // Título
      const titleProp = p.Name || p.Title || p.title ||
        Object.values(p).find(x => x.type === 'title');
      const title = titleProp?.title?.map(t => t.plain_text).join('') || '';
      if (!title) continue;

      // Fecha de vencimiento
      const dueProp = p['Due Date'] || p.Due || p['Fecha de vencimiento'] ||
        p.Vencimiento || p.Fecha;
      const due = dueProp?.date?.start?.slice(0, 10) || '';

      // Estado
      const statusRaw = (p.Status || p.Estado)?.status?.name ||
        (p.Status || p.Estado)?.select?.name || '';

      // Prioridad
      const prioRaw = (p.Priority || p.Prioridad)?.select?.name || '';

      // Categoría
      const catProp = p.Category || p.Categoría || p.Categoria || p.Type || p.Tipo;
      const category = catProp?.select?.name || catProp?.multi_select?.[0]?.name || '';

      tasks.push({
        id: page.url,
        area,
        title,
        category,
        due,
        priority: normPrio(prioRaw),
        status: normStatus(statusRaw),
      });
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return tasks;
}

function normStatus(s) {
  if (!s) return 'To do';
  const l = s.toLowerCase();
  if (l.includes('progress') || l.includes('proceso') || l.includes('progreso')) return 'In progress';
  if (l === 'done' || l.includes('terminad') || l.includes('completad') ||
      l.includes('listo') || l.includes('lista') || l.includes('hecho')) return 'Done';
  return 'To do';
}

function normPrio(s) {
  if (!s) return 'Low';
  const l = s.toLowerCase();
  if (l.includes('high') || l.includes('alta') || l === 'urgent') return 'High';
  if (l.includes('medium') || l.includes('media') || l.includes('normal') ||
      l.includes('medio')) return 'Medium';
  return 'Low';
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, force } = req.body || {};
  if (!['calendar', 'notion'].includes(type))
    return res.status(400).json({ error: 'Invalid type' });

  const now = Date.now();
  const cached = cache[type];
  if (!force && cached && now - cached.ts < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json({
      ...cached.data, _cached: true, _cached_at: cached.cachedAt,
      _age_minutes: Math.round((now - cached.ts) / 60000),
    });
  }

  try {
    let data;
    if (type === 'calendar') {
      const r = await fetch(GCAL_ICAL_URL);
      if (!r.ok) throw new Error(`Calendar fetch failed: ${r.status}`);
      data = { events: parseICal(await r.text()) };
    } else {
      const allTasks = [];
      for (const { id, area } of NOTION_DATABASES) {
        allTasks.push(...await queryNotionDB(id, area));
      }
      data = { tasks: allTasks };
    }

    const cachedAt = new Date().toLocaleString('es-AR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    cache[type] = { data, ts: now, cachedAt };
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ ...data, _cached: false, _cached_at: cachedAt });

  } catch (err) {
    console.error('Handler error:', err);
    if (cached) return res.status(200).json({
      ...cached.data, _cached: true, _stale: true, _cached_at: cached.cachedAt,
      _age_minutes: Math.round((now - cached.ts) / 60000),
    });
    return res.status(500).json({ error: err.message });
  }
};
