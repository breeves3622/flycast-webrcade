const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = 3000;

// Required headers for SharedArrayBuffer
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Access-Control-Allow-Origin': '*',
};

app.use(cors());

// Apply headers to all requests
app.use((req, res, next) => {
  res.set(ISOLATION_HEADERS);
  
  // Prevent Cloudflare Tunnel and browser caching of index.html and core binaries
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  
  next();
});

// Direct diagnostic boot test page to completely bypass Cloudflare CDN bundle caching
app.get('/test', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Flycast WASM Direct Test Runner</title>
  <style>
    body { background: #111; color: #fff; font-family: system-ui, sans-serif; padding: 40px; }
    h1 { color: #ff2a6d; margin-top: 0; }
    .card { background: #222; border: 1px solid #333; padding: 15px; border-radius: 8px; margin: 20px 0; }
    button { background: #ff2a6d; color: #fff; border: none; padding: 14px 28px; font-size: 18px; font-weight: bold; border-radius: 6px; cursor: pointer; }
    select { padding: 10px; font-size: 16px; background: #333; color: #fff; border: 1px solid #444; border-radius: 6px; width: 100%; max-width: 500px; margin-bottom: 20px; }
    #game-container { width: 640px; height: 480px; background: #000; border: 2px solid #333; border-radius: 8px; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>Flycast WASM Direct Test Runner</h1>
  <p>Direct HTML diagnostic runner (Bypassing Cloudflare Tunnel asset caching)</p>
  
  <div class="card">
    <strong>Status: </strong><span id="status">Fetching game list...</span>
  </div>

  <div>
    <select id="game-select" disabled></select>
  </div>

  <button id="boot-btn" disabled>► BOOT TEST GAME</button>

  <div id="game-container"></div>

  <script>
    let gamesList = [];
    const statusEl = document.getElementById('status');
    const selectEl = document.getElementById('game-select');
    const bootBtn = document.getElementById('boot-btn');

    fetch('/api/games')
      .then(res => res.json())
      .then(data => {
        gamesList = data;
        if (data.length > 0) {
          selectEl.innerHTML = data.map((g, i) => \`<option value="\${i}">\${g.name} (\${(g.size/(1024*1024)).toFixed(1)} MB)</option>\`).join('');
          selectEl.disabled = false;
          bootBtn.disabled = false;
          statusEl.innerText = 'Ready to boot: ' + data[0].name;
        } else {
          statusEl.innerText = 'No games found in local ROM directory.';
        }
      })
      .catch(err => statusEl.innerText = 'Error fetching games: ' + err.message);

    bootBtn.onclick = () => {
      const selected = gamesList[selectEl.value];
      if (!selected) return;
      
      bootBtn.disabled = true;
      selectEl.disabled = true;
      statusEl.innerText = 'Booting ' + selected.name + '... Loading EmulatorJS...';

      window.EJS_player = '#game-container';
      window.EJS_core = 'flycast';
      const ext = selected.filename.split('.').pop();
      window.EJS_gameUrl = '/api/rom/' + encodeURIComponent(selected.filename) + '/game.' + ext;
      window.EJS_pathtodata = '/data/';
      window.EJS_startOnLoaded = true;
      window.EJS_color = '#ff2a6d';
      window.EJS_threads = true;
      window.EJS_biosUrl = '/bios/dc_bios.zip?v=3';

      window.EJS_defaultOptions = {
        'reicast_boot_to_bios': 'disabled',
        'reicast_hle_bios': 'disabled',
        'reicast_threaded_rendering': 'disabled',
        'reicast_synchronous_rendering': 'disabled',
        'reicast_internal_resolution': '640x480'
      };

      const s = document.createElement('script');
      s.src = '/data/loader.js';
      s.onload = () => statusEl.innerText = 'EmulatorJS loaded. Initializing WebAssembly core...';
      s.onerror = () => statusEl.innerText = 'Failed to load /data/loader.js';
      document.body.appendChild(s);
    };
  </script>
</body>
</html>`);
});

// Provide a clean URL for EmulatorJS to bypass virtual filesystem parsing bugs
app.get('/api/rom/:filename/game.:ext', (req, res) => {
  const filePath = path.join(__dirname, 'roms', req.params.filename);
  res.sendFile(filePath);
});

// Custom BIOS packaging logic removed - we now strictly use the verified archive.org BIOS downloaded in the Dockerfile



// API: Get Games from local directory
app.get('/api/games', (req, res) => {
  const romsDir = path.join(__dirname, 'roms');
  
  fs.readdir(romsDir, (err, files) => {
    if (err) {
      console.error('Error reading roms directory:', err.message);
      return res.status(500).json({ error: 'Failed to read local roms directory' });
    }
    
    // Filter out only supported ROM types (.chd, .cdi, .gdi) and USA region
    const games = files.filter(f => f.match(/\.(chd|cdi|gdi)$/i) && (f.includes('(USA)') || f.includes('(US)'))).map(f => {
      let size = 0;
      try {
        const stats = fs.statSync(path.join(romsDir, f));
        size = stats.size;
      } catch(e) {
        // Ignore stat errors
      }

      const cleanName = f.replace(/\.[^/.]+$/, "");
      return {
        name: cleanName,
        filename: f,
        size: size,
        thumbnailUrl: `/api/thumbnail?url=${encodeURIComponent(`https://thumbnails.libretro.com/Sega%20-%20Dreamcast/Named_Boxarts/${encodeURIComponent(cleanName)}.png`)}`,
        // Direct link to the static route
        url: `/roms/${encodeURIComponent(f)}`
      };
    });

    res.json(games);
  });
});

// API: Proxy thumbnails to inject COEP headers
app.get('/api/thumbnail', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL required');
  
  https.get(targetUrl, (targetRes) => {
    if (targetRes.headers['content-type']) {
      res.setHeader('Content-Type', targetRes.headers['content-type']);
    }
    // Cache for 24 hours to reduce load
    res.setHeader('Cache-Control', 'public, max-age=86400');
    targetRes.pipe(res);
  }).on('error', (err) => {
    console.error('Thumbnail proxy error:', err.message);
    res.status(500).send('Error');
  });
});

// Serve ROM files natively with Express static (supports Range requests out of the box!)
app.use('/roms', express.static(path.join(__dirname, 'roms')));



// Serve EmulatorJS data and BIOS
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use('/bios', express.static(path.join(__dirname, 'bios')));

// Serve frontend in production
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Configured for Local ROM Hosting (/app/server/roms)`);
});
