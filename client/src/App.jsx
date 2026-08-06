import { useState, useEffect, useRef } from 'react';

function App() {
  const [games, setGames] = useState([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activeRow, setActiveRow] = useState(1); // 0 = Hero Button, 1 = Game Carousel
  const [isBooting, setIsBooting] = useState(false);
  const [status, setStatus] = useState('Loading Dreamcast Library...');
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [gamepadName, setGamepadName] = useState('');

  const focusedCardRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastNavTimeRef = useRef(0);

  // Fetch games on load
  useEffect(() => {
    fetch('/api/games')
      .then(res => res.json())
      .then(data => {
        setGames(data);
        if (data.length > 0) {
          setStatus('Ready to boot.');
        } else {
          setStatus('No games found in ROM directory.');
        }
      })
      .catch(err => setStatus(`Error: ${err.message}`));
  }, []);

  // WebGL2 and startGame patches
  const applyFlycastPatches = () => {
    // 1. WebGL2 Context compatibility patches
    if (!window.__flycastCanvasPatched) {
      window.__flycastCanvasPatched = true;
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        const ctx = origGetContext.call(this, type, attrs);
        if (ctx && (type === 'webgl2' || type === 'experimental-webgl2') && !ctx.__flycastPatched) {
          ctx.__flycastPatched = true;
          const origGetParam = ctx.getParameter.bind(ctx);

          ctx.getParameter = function(pname) {
            if (pname === 0x1F02 || pname === ctx.VERSION) return 'OpenGL ES 3.0 WebGL 2.0';
            if (pname === 0x8B8C || pname === ctx.SHADING_LANGUAGE_VERSION) return 'OpenGL ES GLSL ES 3.00';
            return origGetParam(pname);
          };

          const origGetError = ctx.getError.bind(ctx);
          ctx.getError = function() {
            let err = origGetError();
            while (err === 0x500) { err = origGetError(); }
            return err;
          };

          const texBindings = {};
          texBindings[ctx.TEXTURE_2D] = ctx.TEXTURE_BINDING_2D;
          texBindings[ctx.TEXTURE_CUBE_MAP] = ctx.TEXTURE_BINDING_CUBE_MAP;
          if (ctx.TEXTURE_3D) texBindings[ctx.TEXTURE_3D] = ctx.TEXTURE_BINDING_3D;
          if (ctx.TEXTURE_2D_ARRAY) texBindings[ctx.TEXTURE_2D_ARRAY] = ctx.TEXTURE_BINDING_2D_ARRAY;

          const origTexParameteri = ctx.texParameteri.bind(ctx);
          ctx.texParameteri = function(target, pname, param) {
            const b = texBindings[target];
            if (b && !origGetParam(b)) return;
            return origTexParameteri(target, pname, param);
          };

          const origTexParameterf = ctx.texParameterf.bind(ctx);
          ctx.texParameterf = function(target, pname, param) {
            const b = texBindings[target];
            if (b && !origGetParam(b)) return;
            return origTexParameterf(target, pname, param);
          };

          // Rewrite #version 130 → #version 300 es
          const origShaderSource = ctx.shaderSource.bind(ctx);
          ctx.shaderSource = function(shader, source) {
            if (typeof source === 'string' && source.indexOf('#version 130') !== -1) {
              source = source.replace(/#version 130/g, '#version 300 es');
            }
            return origShaderSource(shader, source);
          };

          // texImage2D internalformat fix: GL_RED (0x1903) -> GL_R8 (0x8229)
          const origTexImage2D = ctx.texImage2D.bind(ctx);
          ctx.texImage2D = function() {
            const args = Array.prototype.slice.call(arguments);
            if (args.length >= 3 && args[2] === 0x1903) args[2] = 0x8229;
            return origTexImage2D.apply(null, args);
          };

          const origCompileShader = ctx.compileShader.bind(ctx);
          ctx.compileShader = function(shader) {
            origCompileShader(shader);
            if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
              const type = ctx.getShaderParameter(shader, ctx.SHADER_TYPE);
              let fallback;
              if (type === ctx.VERTEX_SHADER) {
                fallback = '#version 300 es\nin vec3 VertexCoord;\nuniform float time;\nvoid main() { gl_Position = vec4(0.0); }\n';
              } else {
                fallback = '#version 300 es\nprecision mediump float;\nout vec4 FragColor;\nvoid main() { FragColor = vec4(0.0, 0.0, 0.0, 0.0); }\n';
              }
              origShaderSource(shader, fallback);
              origCompileShader(shader);
            }
          };
        }
        return ctx;
      };
    }

    // 2. AudioWorklet polyfill for HTTP
    const origAudioCtx = window.AudioContext || window.webkitAudioContext;
    if (origAudioCtx && !window.__audioPatched) {
      window.__audioPatched = true;
      const PatchedAudioContext = function() {
        const ctx = new origAudioCtx(arguments[0]);
        if (!ctx.audioWorklet) {
          ctx.audioWorklet = {
            addModule: function() { return Promise.reject(new Error('AudioWorklet disabled on HTTP')); }
          };
        }
        return ctx;
      };
      PatchedAudioContext.prototype = origAudioCtx.prototype;
      window.AudioContext = PatchedAudioContext;
      if (window.webkitAudioContext) window.webkitAudioContext = PatchedAudioContext;
    }

    // 3. installStartGamePatch
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
    const CORE_OPTIONS_STR = Object.keys(CORE_OPTIONS).map(k => k + ' = "' + CORE_OPTIONS[k] + '"').join('\n') + '\n';
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
                FS.writeFile(cfgPath, cfg + 'system_directory = "/"\n');
              }
            } catch(e) {}
          }
        } catch(e) {
          console.error('[flycast-wasm] startGame patch error:', e);
        }
        return origStartGame.apply(this, arguments);
      };
    }, 50);
  };

  // Launch Game Handler
  const launchGame = (gameObj) => {
    if (!gameObj) return;
    setIsBooting(true);
    setStatus(`Booting ${gameObj.name}... Initializing Flycast WASM...`);

    applyFlycastPatches();

    window.EJS_player = '#game-container';
    window.EJS_core = 'flycast';
    const ext = gameObj.filename.split('.').pop();
    window.EJS_gameUrl = `/api/rom/${encodeURIComponent(gameObj.filename)}/game.${ext}`;
    window.EJS_pathtodata = '/data/';
    window.EJS_startOnLoaded = true;
    window.EJS_color = '#ff2a6d';
    window.EJS_threads = false;
    try {
      localStorage.removeItem('ejs_threads');
      localStorage.setItem('ejs_threads', 'disabled');
    } catch(e) {}
    window.EJS_biosUrl = '/bios/dc_bios.zip?v=' + Date.now();

    const existingLoader = document.getElementById('ejs-loader');
    if (existingLoader) existingLoader.remove();

    const script = document.createElement('script');
    script.src = '/data/loader.js';
    script.id = 'ejs-loader';
    script.onload = () => setStatus(`Emulating: ${gameObj.name}`);
    script.onerror = () => setStatus('Failed to load /data/loader.js');
    document.body.appendChild(script);
  };

  const closeGame = () => {
    setIsBooting(false);
    setStatus('Ready to boot.');
    window.location.reload();
  };

  // Gamepad Event Listeners & Polling Engine
  useEffect(() => {
    const handleConnect = (e) => {
      setGamepadConnected(true);
      setGamepadName(e.gamepad.id || 'Controller');
    };
    const handleDisconnect = () => {
      setGamepadConnected(false);
      setGamepadName('');
    };

    window.addEventListener('gamepadconnected', handleConnect);
    window.addEventListener('gamepaddisconnected', handleDisconnect);

    const pollGamepad = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      let activePad = null;
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          activePad = gamepads[i];
          break;
        }
      }

      if (activePad) {
        if (!gamepadConnected) {
          setGamepadConnected(true);
          setGamepadName(activePad.id || 'Controller');
        }

        const now = Date.now();
        if (now - lastNavTimeRef.current > 200) { // 200ms debounce
          const axisX = activePad.axes[0] || 0;
          const axisY = activePad.axes[1] || 0;
          const dpadUp = activePad.buttons[12]?.pressed;
          const dpadDown = activePad.buttons[13]?.pressed;
          const dpadLeft = activePad.buttons[14]?.pressed;
          const dpadRight = activePad.buttons[15]?.pressed;

          const btnA = activePad.buttons[0]?.pressed; // A / Cross
          const btnB = activePad.buttons[1]?.pressed; // B / Circle

          // Navigation
          if (dpadRight || axisX > 0.5) {
            setFocusedIndex(prev => Math.min(prev + 1, games.length - 1));
            lastNavTimeRef.current = now;
          } else if (dpadLeft || axisX < -0.5) {
            setFocusedIndex(prev => Math.max(prev - 1, 0));
            lastNavTimeRef.current = now;
          } else if (dpadDown || axisY > 0.5) {
            setActiveRow(1);
            lastNavTimeRef.current = now;
          } else if (dpadUp || axisY < -0.5) {
            setActiveRow(0);
            lastNavTimeRef.current = now;
          }

          // Action Buttons
          if (btnA && !isBooting) {
            launchGame(games[focusedIndex]);
            lastNavTimeRef.current = now + 500;
          } else if (btnB && isBooting) {
            closeGame();
            lastNavTimeRef.current = now + 500;
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(pollGamepad);
    };

    animFrameRef.current = requestAnimationFrame(pollGamepad);

    return () => {
      window.removeEventListener('gamepadconnected', handleConnect);
      window.removeEventListener('gamepaddisconnected', handleDisconnect);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [games, focusedIndex, activeRow, isBooting, gamepadConnected]);

  // Keyboard navigation fallback (Arrow keys, Enter, Esc)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isBooting) {
        if (e.key === 'Escape') closeGame();
        return;
      }

      if (e.key === 'ArrowRight') {
        setFocusedIndex(prev => Math.min(prev + 1, games.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setFocusedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'ArrowUp') {
        setActiveRow(0);
      } else if (e.key === 'ArrowDown') {
        setActiveRow(1);
      } else if (e.key === 'Enter') {
        launchGame(games[focusedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [games, focusedIndex, isBooting]);

  // Auto-scroll focused game into view
  useEffect(() => {
    if (focusedCardRef.current && activeRow === 1) {
      focusedCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [focusedIndex, activeRow]);

  const selectedGame = games[focusedIndex] || null;

  return (
    <div className="app-container">
      {/* Header Bar */}
      <header>
        <h1>DREAMCAST TV</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{
            fontSize: '13px',
            padding: '6px 12px',
            borderRadius: '20px',
            backgroundColor: gamepadConnected ? 'rgba(0, 255, 102, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${gamepadConnected ? '#00ff66' : 'rgba(255, 255, 255, 0.1)'}`,
            color: gamepadConnected ? '#00ff66' : '#aaa'
          }}>
            🎮 {gamepadConnected ? `Connected: ${gamepadName.substring(0, 20)}...` : 'Gamepad Ready (Connect Controller)'}
          </div>
        </div>
      </header>

      {/* Main Netflix Content Showcase */}
      {!isBooting && selectedGame && (
        <div className="hero" style={{
          backgroundImage: `linear-gradient(0deg, var(--bg-dark) 0%, rgba(15,15,19,0.4) 100%), url(${selectedGame.thumbnailUrl})`
        }}>
          <div className="hero-content">
            <div style={{
              display: 'inline-block',
              padding: '4px 10px',
              backgroundColor: 'var(--accent)',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: '700',
              letterSpacing: '1px',
              marginBottom: '12px'
            }}>
              SEGA DREAMCAST
            </div>
            <h2>{selectedGame.name}</h2>
            <p>Sega Dreamcast WebAssembly • CHD Disc Format • {(selectedGame.size / (1024 * 1024)).toFixed(1)} MB</p>

            <div style={{ display: 'flex', gap: '15px', marginTop: '20px' }}>
              <button
                onClick={() => launchGame(selectedGame)}
                className={activeRow === 0 ? 'focused' : ''}
                style={{
                  padding: '16px 36px',
                  fontSize: '18px',
                  fontWeight: '700',
                  backgroundColor: 'var(--accent)',
                  color: '#fff',
                  border: activeRow === 0 ? '3px solid #fff' : 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  boxShadow: activeRow === 0 ? '0 0 25px var(--accent-glow)' : 'none',
                  transform: activeRow === 0 ? 'scale(1.05)' : 'scale(1)',
                  transition: 'all 0.2s ease'
                }}
              >
                ► PLAY GAME (Press A)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Games Catalog Row */}
      {!isBooting && games.length > 0 && (
        <div className="games-section">
          <h3>Dreamcast Games Library ({games.length})</h3>
          <div className="games-row">
            {games.map((game, index) => {
              const isFocused = activeRow === 1 && index === focusedIndex;
              return (
                <div
                  key={index}
                  ref={isFocused ? focusedCardRef : null}
                  className={`game-card ${isFocused ? 'focused' : ''}`}
                  onClick={() => {
                    setFocusedIndex(index);
                    setActiveRow(1);
                    launchGame(game);
                  }}
                  style={{
                    border: isFocused ? '3px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
                    boxShadow: isFocused ? '0 0 25px var(--accent-glow)' : 'none'
                  }}
                >
                  <div className="game-art">
                    <img
                      src={game.thumbnailUrl}
                      alt={game.name}
                      onError={(e) => {
                        e.target.src = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400';
                      }}
                    />
                  </div>
                  <div className="play-icon">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                  <div className="game-info">
                    <h4>{game.name}</h4>
                    <p>{(game.size / (1024 * 1024)).toFixed(1)} MB</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Controller Navigation Footer Bar */}
      {!isBooting && (
        <footer style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px 40px',
          backgroundColor: 'rgba(15, 15, 19, 0.95)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 100,
          fontSize: '13px',
          color: 'var(--text-muted)'
        }}>
          <div>
            <strong>Controls:</strong> <span>🎮 D-Pad / Left Stick: Navigate Cards</span> &nbsp;|&nbsp; <span>🅰️ Button A / Enter: Select / Launch</span> &nbsp;|&nbsp; <span>⬆️⬇️ Up/Down: Toggle Hero Banner</span>
          </div>
          <div>Status: {status}</div>
        </footer>
      )}

      {/* Active Emulation Modal Container */}
      {isBooting && (
        <div className="emulator-overlay">
          <button
            className="emulator-close"
            onClick={closeGame}
            title="Exit Emulation (Press B)"
          >
            ✕
          </button>
          <div
            id="game-container"
            style={{ width: '100vw', height: '100vh', backgroundColor: '#000' }}
          ></div>
        </div>
      )}
    </div>
  );
}

export default App;
