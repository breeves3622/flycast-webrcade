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
  <!-- Console noise suppression -->
  <script>
    (function() {
      var origWarn = console.warn;
      console.warn = function() {
        if (arguments.length > 0 && typeof arguments[0] === 'string') {
          var msg = arguments[0];
          if (msg.indexOf('__syscall_mprotect') !== -1) return;
          if (msg.indexOf('is not a valid value') !== -1) return;
        }
        return origWarn.apply(console, arguments);
      };
    })();
  </script>
  <!-- WebGL2 compatibility patches from flycast.medieval.software -->
  <script>
    (function() {
      var origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        var ctx = origGetContext.call(this, type, attrs);
        if (ctx && (type === 'webgl2' || type === 'experimental-webgl2') && !ctx.__flycastPatched) {
          ctx.__flycastPatched = true;
          var origGetParam = ctx.getParameter.bind(ctx);

          ctx.getParameter = function(pname) {
            if (pname === 0x1F02 || pname === ctx.VERSION) return 'OpenGL ES 3.0 WebGL 2.0';
            if (pname === 0x8B8C || pname === ctx.SHADING_LANGUAGE_VERSION) return 'OpenGL ES GLSL ES 3.00';
            return origGetParam(pname);
          };

          var origGetError = ctx.getError.bind(ctx);
          ctx.getError = function() {
            var err = origGetError();
            while (err === 0x500) { err = origGetError(); }
            return err;
          };

          var texBindings = {};
          texBindings[ctx.TEXTURE_2D] = ctx.TEXTURE_BINDING_2D;
          texBindings[ctx.TEXTURE_CUBE_MAP] = ctx.TEXTURE_BINDING_CUBE_MAP;
          if (ctx.TEXTURE_3D) texBindings[ctx.TEXTURE_3D] = ctx.TEXTURE_BINDING_3D;
          if (ctx.TEXTURE_2D_ARRAY) texBindings[ctx.TEXTURE_2D_ARRAY] = ctx.TEXTURE_BINDING_2D_ARRAY;

          var origTexParameteri = ctx.texParameteri.bind(ctx);
          ctx.texParameteri = function(target, pname, param) {
            var b = texBindings[target];
            if (b && !origGetParam(b)) return;
            return origTexParameteri(target, pname, param);
          };

          var origTexParameterf = ctx.texParameterf.bind(ctx);
          ctx.texParameterf = function(target, pname, param) {
            var b = texBindings[target];
            if (b && !origGetParam(b)) return;
            return origTexParameterf(target, pname, param);
          };

          // Rewrite #version 130 → #version 300 es
          var origShaderSource = ctx.shaderSource.bind(ctx);
          ctx.shaderSource = function(shader, source) {
            if (typeof source === 'string' && source.indexOf('#version 130') !== -1) {
              source = source.replace(/#version 130/g, '#version 300 es');
              console.log('[flycast-wasm] Rewrote #version 130 → 300 es');
            }
            return origShaderSource(shader, source);
          };

          // texImage2D internalformat fix: GL_RED (0x1903) -> GL_R8 (0x8229)
          var origTexImage2D = ctx.texImage2D.bind(ctx);
          ctx.texImage2D = function() {
            var args = Array.prototype.slice.call(arguments);
            if (args.length >= 3 && args[2] === 0x1903) args[2] = 0x8229;
            return origTexImage2D.apply(null, args);
          };

          // Fallback for any shader that fails to compile
          var origCompileShader = ctx.compileShader.bind(ctx);
          ctx.compileShader = function(shader) {
            origCompileShader(shader);
            if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
              var log = ctx.getShaderInfoLog(shader);
              var type = ctx.getShaderParameter(shader, ctx.SHADER_TYPE);
              console.warn('[flycast-wasm] Shader compile failed, substituting fallback. Log:', log);
              var fallback;
              if (type === ctx.VERTEX_SHADER) {
                fallback = '#version 300 es\\nin vec3 VertexCoord;\\nuniform float time;\\nvoid main() { gl_Position = vec4(0.0); }\\n';
              } else {
                fallback = '#version 300 es\\nprecision mediump float;\\nout vec4 FragColor;\\nvoid main() { FragColor = vec4(0.0, 0.0, 0.0, 0.0); }\\n';
              }
              origShaderSource(shader, fallback);
              origCompileShader(shader);
            }
          };
        }
        return ctx;
      };
    })();
  </script>
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

    const CORE_OPTIONS = {
      'reicast_boot_to_bios': 'disabled',
      'reicast_hle_bios': 'disabled',
      'reicast_threaded_rendering': 'disabled',
      'reicast_synchronous_rendering': 'disabled',
      'reicast_internal_resolution': '320x240',
      'reicast_mipmapping': 'disabled',
      'reicast_anisotropic_filtering': '1',
      'reicast_texupscale': 'disabled',
      'reicast_enable_rttb': 'disabled',
      'reicast_enable_purupuru': 'disabled',
      'reicast_alpha_sorting': 'per-strip (fast, least accurate)',
      'reicast_delay_frame_swapping': 'disabled',
      'reicast_frame_skipping': 'enabled',
      'reicast_framerate': 'normal',
      'reicast_enable_dsp': 'disabled',
      'reicast_gdrom_fast_loading': 'enabled'
    };

    const CORE_OPTIONS_STR = Object.keys(CORE_OPTIONS).map(k => k + ' = "' + CORE_OPTIONS[k] + '"').join('\\n') + '\\n';

    function installStartGamePatch() {
      const BIOS_FILES = ['dc_boot.bin', 'dc_flash.bin'];
      const iv = setInterval(() => {
        const emu = window.EJS_emulator;
        if (!emu || emu.__flycastPatched) return;
        emu.__flycastPatched = true;
        clearInterval(iv);

        const origStartGame = emu.startGame;
        emu.startGame = async function() {
          try {
            if (this.gameManager && this.gameManager.FS) {
              const FS = this.gameManager.FS;
              const biosDir = '/dc';
              try { if (!FS.analyzePath(biosDir).exists) FS.mkdir(biosDir); } catch(e) {}
              for (let j = 0; j < BIOS_FILES.length; j++) {
                const src = '/' + BIOS_FILES[j];
                const dst = biosDir + '/' + BIOS_FILES[j];
                try {
                  if (FS.analyzePath(src).exists && !FS.analyzePath(dst).exists) {
                    const data = FS.readFile(src);
                    FS.writeFile(dst, data);
                  }
                } catch(e) {}
              }

              if (this.Module && this.Module.callbacks) {
                const origCb = this.Module.callbacks.setupCoreSettingFile;
                this.Module.callbacks.setupCoreSettingFile = function(filePath) {
                  try { FS.writeFile(filePath, CORE_OPTIONS_STR); } catch(e) {}
                  if (origCb) origCb(filePath);
                };
              }

              const cfgPath = '/home/web_user/.config/retroarch/retroarch.cfg';
              try {
                const cfg = new TextDecoder().decode(FS.readFile(cfgPath));
                if (cfg.indexOf('system_directory') === -1) {
                  FS.writeFile(cfgPath, cfg + 'system_directory = "/"\\n');
                }
              } catch(e) {}
            }
          } catch(e) {
            console.error('[flycast-wasm] startGame patch failed:', e);
          }
          return origStartGame.apply(this, arguments);
        };
      }, 50);
    }

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
      window.EJS_biosUrl = '/bios/dc_bios.zip?v=4';
      window.EJS_defaultOptions = CORE_OPTIONS;

      installStartGamePatch();

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
