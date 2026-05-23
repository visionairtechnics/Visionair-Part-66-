const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');
const { jsonrepair } = require('jsonrepair');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

// Check if MarkItDown is available at startup
let markitdownAvailable = false;
try {
  const check = spawnSync('python3', ['-c', 'from markitdown import MarkItDown; print("ok")'], { timeout: 10000 });
  markitdownAvailable = check.stdout?.toString().trim() === 'ok';
  console.log('MarkItDown available:', markitdownAvailable);
} catch(e) {
  console.log('MarkItDown not available, will use direct mode');
}

// ── MarkItDown helper ─────────────────────────────────────────
const MARKITDOWN_PY = `
import sys, json, tempfile, os, base64
from markitdown import MarkItDown

data = json.loads(sys.stdin.read())
file_type = data.get('type', 'pdf')
content_b64 = data.get('content', '')

ext = {'pdf':'.pdf','docx':'.docx','doc':'.doc','xlsx':'.xlsx','xls':'.xls','csv':'.csv'}.get(file_type, '.bin')
tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
tmp.write(base64.b64decode(content_b64))
tmp.close()

try:
    md = MarkItDown()
    result = md.convert(tmp.name)
    text = result.text_content or ''
    print(json.dumps({"text": text, "length": len(text)}))
except Exception as e:
    print(json.dumps({"error": str(e), "text": ""}))
finally:
    try: os.unlink(tmp.name)
    except: pass
`;

function convertWithMarkItDown(fileType, contentB64) {
  return new Promise((resolve) => {
    if (!markitdownAvailable) { resolve(null); return; }
    
    const py = execFile('python3', ['-c', MARKITDOWN_PY], {
      timeout: 45000,
      maxBuffer: 10 * 1024 * 1024
    }, (err, stdout, stderr) => {
      if (err) { console.error('MarkItDown error:', err.message); resolve(null); return; }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error || !result.text) { resolve(null); return; }
        console.log(`MarkItDown OK: ${result.length} chars`);
        resolve(result.text);
      } catch(e) { resolve(null); }
    });
    py.stdin.write(JSON.stringify({ type: fileType, content: contentB64 }));
    py.stdin.end();
  });
}

// ── JSON repair ───────────────────────────────────────────────
function extractAndRepairJSON(text) {
  let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  clean = clean.substring(start, end + 1);
  try { return jsonrepair(clean); }
  catch(e) { console.error('jsonrepair failed:', e.message); return clean; }
}

// ── HTTP Server ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }

  // ── /estado — health check ─────────────────────────────────
  if (req.method === 'GET' && req.url === '/estado') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ 
      ok: true, 
      markitdown: markitdownAvailable,
      apiKey: !!API_KEY 
    }));
    return;
  }

  // ── /convertir — MarkItDown ────────────────────────────────
  if (req.method === 'POST' && req.url === '/convertir') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { type, content } = JSON.parse(body);
        const text = await convertWithMarkItDown(type, content);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ text: text || null, available: markitdownAvailable }));
      } catch(e) {
        console.error('Convert error:', e.message);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ text: null, error: e.message }));
      }
    });
    return;
  }

  // ── /analizar — Claude API proxy ───────────────────────────
  if (req.method === 'POST' && req.url === '/analizar') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        if (!API_KEY) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error:{message:'ANTHROPIC_API_KEY no configurada en Render'}}));
          return;
        }

        const parsed = JSON.parse(body);
        if (parsed.max_tokens > 8000) parsed.max_tokens = 8000;

        console.log(`Llamando Anthropic (max_tokens=${parsed.max_tokens})...`);
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(parsed)
        });

        const data = await response.json();

        if (!response.ok) {
          const errMsg = data.error?.message || JSON.stringify(data);
          console.error('Anthropic API error:', response.status, errMsg);
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error:{message:`Error API (${response.status}): ${errMsg}`}}));
          return;
        }

        const rawText = data.content?.map(i => i.text || '').join('') || '';
        console.log('Respuesta OK, longitud:', rawText.length);

        const repairedText = extractAndRepairJSON(rawText);
        if (!repairedText) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error:{message:'No se encontró JSON en la respuesta de Claude'}}));
          return;
        }

        const result = JSON.parse(repairedText);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify(result));

      } catch(e) {
        console.error('Error en /analizar:', e.message);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error:{message: e.message}}));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.timeout = 300000;
server.listen(PORT, () => {
  console.log(`VisionAir Part-66 server running on port ${PORT}`);
  console.log(`MarkItDown: ${markitdownAvailable ? 'disponible' : 'no disponible (modo directo)'}`);
  console.log(`API Key: ${API_KEY ? 'configurada' : 'NO CONFIGURADA'}`);
});
