# UTN FRBA Motorsport — Planificación 2026

Página web de planificación del equipo FSAE UTN FRBA. Se actualiza automáticamente al cargar, leyendo datos en vivo de Google Calendar y Notion.

---

## Estructura del proyecto

```
fsae-project/
├── api/
│   └── sync.js          ← Backend serverless (se sube a Vercel)
├── public/
│   └── index.html       ← Página web (se sube a GitHub Pages)
├── vercel.json
├── package.json
└── README.md
```

---

## Instrucciones de deploy (una sola vez)

### Paso 1 — Crear repositorio en GitHub

1. Andá a https://github.com/new
2. Nombre del repo: `fsae-planning` (o el que quieras)
3. Marcá **Public**
4. Clic en **Create repository**
5. Subí todos los archivos de este proyecto

### Paso 2 — Deploy del backend en Vercel (GRATIS)

1. Andá a https://vercel.com y creá una cuenta gratis (podés entrar con GitHub)
2. Clic en **Add New Project**
3. Importá tu repositorio de GitHub `fsae-planning`
4. En **Root Directory** dejá vacío (o ponés `/`)
5. Antes de hacer deploy, agregá las variables de entorno haciendo clic en **Environment Variables**:

   | Variable | Valor | Cómo conseguirlo |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` | https://console.anthropic.com → API Keys |
   | `GCAL_MCP_TOKEN` | token de Google Calendar | En claude.ai → Settings → Integrations → Google Calendar → copiás el token |
   | `NOTION_MCP_TOKEN` | token de Notion | En claude.ai → Settings → Integrations → Notion → copiás el token |

6. Clic en **Deploy**
7. Vercel te da una URL tipo: `https://fsae-planning-abc123.vercel.app`

### Paso 3 — Conectar la página con el backend

1. Abrí el archivo `public/index.html`
2. Buscá esta línea cerca del inicio del `<script>`:
   ```js
   const BACKEND_URL = 'https://TU-PROYECTO.vercel.app/api/sync';
   ```
3. Reemplazá `TU-PROYECTO.vercel.app` con la URL real de Vercel del paso anterior
4. Guardá y subí el cambio a GitHub

### Paso 4 — Activar GitHub Pages

1. En tu repositorio de GitHub, andá a **Settings → Pages**
2. En **Source** elegí **Deploy from a branch**
3. Branch: `main`, Folder: `/public`
4. Guardá
5. GitHub te da una URL tipo: `https://tuusuario.github.io/fsae-planning`

¡Listo! Esa URL es la que compartís con el equipo.

---

## Cómo funciona

```
Miembro del equipo abre la página
        ↓
  GitHub Pages sirve index.html
        ↓
  El browser llama a Vercel /api/sync
        ↓
  Vercel llama a Claude con MCP tools
        ↓
  Claude lee Google Calendar + Notion
        ↓
  Datos frescos aparecen en la página
```

- La **API key** queda guardada en Vercel, nunca en el HTML
- Los **estados de tareas** (por hacer / en proceso / terminada) se guardan en el navegador de cada usuario
- Si Google Calendar o Notion no responden, la página muestra un error y sigue funcionando

---

## Actualizar los datos

No hace falta hacer nada. Cada vez que alguien abre la página, se traen los datos frescos automáticamente.

Si querés forzar una actualización manual: recargá la página con `Ctrl+R` / `Cmd+R`.
