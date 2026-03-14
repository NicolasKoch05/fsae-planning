// ─── Caché en memoria ────────────────────────────────────────────────────────
// Vercel reutiliza la misma instancia del servidor mientras esté caliente,
// así que el caché persiste entre requests y evita llamar a Claude en cada visita.
// TTL configurable con la variable de entorno CACHE_TTL_MINUTES (default: 120 = 2 horas).
const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_MINUTES) || 120) * 60 * 1000;
const cache = {}; // { calendar: { data, ts }, notion: { data, ts } }
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, force } = req.body;

  const prompts = {
    calendar: `Usá la herramienta de Google Calendar para listar todos los eventos del calendario primario (nikoch@frba.utn.edu.ar) entre 2026-03-01T00:00:00 y 2026-12-31T23:59:59, con maxResults=250.
Devolvé SOLO este JSON sin texto ni backticks:
{"events":[{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","title":"título"}]}`,

    notion: `Usá la herramienta de Notion para buscar todas las páginas que sean tareas dentro del workspace FSAE-UTNBA. Buscá en estas colecciones:
- Electrónica: collection://2cbd1b4d-eb14-818c-a5fb-000b24122cab
- Diseño: collection://2dad1b4d-eb14-811a-9c39-000bc9b5fbc2 y collection://2dad1b4d-eb14-815a-aafa-000b97fd5f29
- Simulación: collection://2fed1b4d-eb14-81b9-be99-000b0b690366
- Redes: collection://2dad1b4d-eb14-81e6-8dd2-000b778b4a75

Para cada tarea extraé: id (url de notion), title (Name), area (electronica/diseno/fabricacion/redes/simulacion/cnc), category (Category), due (date:Due Date:start o ""), priority (Priority), status (Status: To do/In progress/Done).
Devolvé SOLO este JSON sin texto ni backticks:
{"tasks":[{"id":"url","area":"electronica","title":"nombre","category":"cat","due":"YYYY-MM-DD","priority":"High","status":"To do"}]}`
  };

  if (!prompts[type]) return res.status(400).json({ error: 'Invalid type' });

  // ── Revisar caché ──────────────────────────────────────────────────────────
  const now = Date.now();
  const cached = cache[type];
  if (!force && cached && (now - cached.ts) < CACHE_TTL_MS) {
    const ageMin = Math.round((now - cached.ts) / 60000);
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json({
      ...cached.data,
      _cached: true,
      _cached_at: cached.cachedAt,
      _age_minutes: ageMin
    });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: 'Devolvé ÚNICAMENTE JSON válido sin texto adicional, sin markdown, sin backticks. Solo el JSON.',
        messages: [{ role: 'user', content: prompts[type] }],
        mcp_servers: [
          { type: 'url', url: 'https://gcal.mcp.claude.com/mcp', name: 'google-calendar',
            authorization_token: process.env.GCAL_MCP_TOKEN },
          { type: 'url', url: 'https://mcp.notion.com/mcp', name: 'notion',
            authorization_token: process.env.NOTION_MCP_TOKEN }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic error:', errText);
      if (cached) {
        const ageMin = Math.round((now - cached.ts) / 60000);
        return res.status(200).json({ ...cached.data, _cached: true, _stale: true, _cached_at: cached.cachedAt, _age_minutes: ageMin });
      }
      return res.status(502).json({ error: 'Anthropic API error', detail: errText });
    }

    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    // Guardar en caché
    const cachedAt = new Date().toLocaleString('es-AR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    cache[type] = { data: parsed, ts: now, cachedAt };

    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ ...parsed, _cached: false, _cached_at: cachedAt });

  } catch (err) {
    console.error('Handler error:', err);
    if (cached) {
      const ageMin = Math.round((now - cached.ts) / 60000);
      return res.status(200).json({ ...cached.data, _cached: true, _stale: true, _cached_at: cached.cachedAt, _age_minutes: ageMin });
    }
    return res.status(500).json({ error: err.message });
  }
}
