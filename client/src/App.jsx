import { useState, useEffect, useRef, useMemo } from 'react';

const CATEGORIES = ['ALL GAMES', 'ACTION & ADVENTURE', 'ARCADE & FIGHTING', 'RACING & SPORTS'];

function App() {
  const [games, setGames] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0);

  // Focus Navigation Zones:
  // 0 = Search Input Bar
  // 1 = Category Pills
  // 2 = Launch Play Button / Preview Strip
  // 3 = Clean Cards Grid
  const [focusedZone, setFocusedZone] = useState(3);
  const [focusedCardIndex, setFocusedCardIndex] = useState(0);
  const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);

  const [isBooting, setIsBooting] = useState(false);
  const [status, setStatus] = useState('Loading Dreamcast Library...');
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [gamepadName, setGamepadName] = useState('');

  const searchInputRef = useRef(null);
  const focusedCardRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastNavTimeRef = useRef(0);

  // Fetch games from server
  useEffect(() => {
    fetch('/api/games')
      .then(res => res.json())
      .then(data => {
        setGames(data);
        if (data.length > 0) {
          setStatus('Library ready.');
        } else {
          setStatus('No games found in local ROM directory.');
        }
      })
      .catch(err => setStatus(`Error: ${err.message}`));
  }, []);

  // Filter games by category and search query
  const filteredGames = useMemo(() => {
    return games.filter(game => {
      const matchesSearch = !searchQuery || game.name.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      const catName = CATEGORIES[selectedCategoryIndex];
      if (catName === 'ALL GAMES') return true;

      const nameLower = game.name.toLowerCase();
      if (catName === 'ARCADE & FIGHTING') {
        return nameLower.includes('fight') || nameLower.includes('vs') || nameLower.includes('street') || nameLower.includes('capcom') || nameLower.includes('snk') || nameLower.includes('marvel') || nameLower.includes('dead') || nameLower.includes('soul') || nameLower.includes('virtua');
      } else if (catName === 'RACING & SPORTS') {
        return nameLower.includes('race') || nameLower.includes('speed') || nameLower.includes('rally') || nameLower.includes('2k') || nameLower.includes('nba') || nameLower.includes('nfl') || nameLower.includes('nhl') || nameLower.includes('tennis') || nameLower.includes('golf') || nameLower.includes('gt');
      } else if (catName === 'ACTION & ADVENTURE') {
        return !nameLower.includes('2k') && !nameLower.includes('fight') && !nameLower.includes('vs');
      }

      return true;
    });
  }, [games, searchQuery, selectedCategoryIndex]);

  // Keep focusedCardIndex within valid range when filtered list changes
  useEffect(() => {
    if (focusedCardIndex >= filteredGames.length) {
      setFocusedCardIndex(Math.max(0, filteredGames.length - 1));
    }
  }, [filteredGames.length, focusedCardIndex]);

  // Currently focused game
  const selectedGame = filteredGames[focusedCardIndex] || games[0] || null;

  // Flycast WASM patches & execution
  const applyFlycastPatches = () => {
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

          const origShaderSource = ctx.shaderSource.bind(ctx);
          ctx.shaderSource = function(shader, source) {
            if (typeof source === 'string' && source.indexOf('#version 130') !== -1) {
              source = source.replace(/#version 130/g, '#version 300 es');
            }
            return origShaderSource(shader, source);
          };

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

  const launchGame = (gameObj) => {
    if (!gameObj) return;
    setIsBooting(true);
    setStatus(`Booting ${gameObj.name}... Initializing Flycast...`);

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
    setStatus('Library ready.');
    window.location.reload();
  };

  // Controller / Gamepad Navigation Engine
  useEffect(() => {
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
        if (now - lastNavTimeRef.current > 180) { // 180ms debounce
          const axisX = activePad.axes[0] || 0;
          const axisY = activePad.axes[1] || 0;
          const dpadUp = activePad.buttons[12]?.pressed;
          const dpadDown = activePad.buttons[13]?.pressed;
          const dpadLeft = activePad.buttons[14]?.pressed;
          const dpadRight = activePad.buttons[15]?.pressed;

          const btnA = activePad.buttons[0]?.pressed; // A / Cross
          const btnB = activePad.buttons[1]?.pressed; // B / Circle
          const btnLB = activePad.buttons[4]?.pressed; // LB
          const btnRB = activePad.buttons[5]?.pressed; // RB

          // Bumpers cycle categories
          if (btnRB) {
            setSelectedCategoryIndex(prev => (prev + 1) % CATEGORIES.length);
            lastNavTimeRef.current = now;
          } else if (btnLB) {
            setSelectedCategoryIndex(prev => (prev - 1 + CATEGORIES.length) % CATEGORIES.length);
            lastNavTimeRef.current = now;
          }

          // D-Pad Navigation
          if (dpadRight || axisX > 0.5) {
            if (focusedZone === 1) { // Category Pills
              setSelectedCategoryIndex(prev => (prev + 1) % CATEGORIES.length);
            } else if (focusedZone === 3 && filteredGames.length > 0) { // Game Grid
              setFocusedCardIndex(prev => Math.min(prev + 1, filteredGames.length - 1));
            }
            lastNavTimeRef.current = now;
          } else if (dpadLeft || axisX < -0.5) {
            if (focusedZone === 1) { // Category Pills
              setSelectedCategoryIndex(prev => (prev - 1 + CATEGORIES.length) % CATEGORIES.length);
            } else if (focusedZone === 3 && filteredGames.length > 0) { // Game Grid
              setFocusedCardIndex(prev => Math.max(prev - 1, 0));
            }
            lastNavTimeRef.current = now;
          } else if (dpadDown || axisY > 0.5) {
            if (focusedZone === 0) setFocusedZone(1);
            else if (focusedZone === 1) setFocusedZone(2);
            else if (focusedZone === 2) setFocusedZone(3);
            else if (focusedZone === 3 && filteredGames.length > 0) {
              // Move down one grid row (~4 cards per row)
              setFocusedCardIndex(prev => Math.min(prev + 4, filteredGames.length - 1));
            }
            lastNavTimeRef.current = now;
          } else if (dpadUp || axisY < -0.5) {
            if (focusedZone === 3) {
              if (focusedCardIndex >= 4) {
                setFocusedCardIndex(prev => prev - 4);
              } else {
                setFocusedZone(2);
              }
            } else if (focusedZone === 2) setFocusedZone(1);
            else if (focusedZone === 1) setFocusedZone(0);
            lastNavTimeRef.current = now;
          }

          // Action Buttons
          if (btnA && !isBooting) {
            if (focusedZone === 2 && selectedGame) {
              launchGame(selectedGame);
            } else if (focusedZone === 3 && selectedGame) {
              launchGame(selectedGame);
            }
            lastNavTimeRef.current = now + 400;
          } else if (btnB) {
            if (isBooting) {
              closeGame();
            } else if (searchQuery) {
              setSearchQuery('');
            }
            lastNavTimeRef.current = now + 400;
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(pollGamepad);
    };

    animFrameRef.current = requestAnimationFrame(pollGamepad);

    const handleConnect = (e) => { setGamepadConnected(true); setGamepadName(e.gamepad.id || 'Controller'); };
    const handleDisconnect = () => { setGamepadConnected(false); setGamepadName(''); };

    window.addEventListener('gamepadconnected', handleConnect);
    window.addEventListener('gamepaddisconnected', handleDisconnect);

    return () => {
      window.removeEventListener('gamepadconnected', handleConnect);
      window.removeEventListener('gamepaddisconnected', handleDisconnect);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [filteredGames, focusedZone, focusedCardIndex, isBooting, gamepadConnected, selectedGame, searchQuery]);

  // Keyboard navigation fallback
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isBooting) {
        if (e.key === 'Escape') closeGame();
        return;
      }

      if (e.key === 'ArrowRight') {
        if (focusedZone === 3) setFocusedCardIndex(prev => Math.min(prev + 1, filteredGames.length - 1));
        else if (focusedZone === 1) setSelectedCategoryIndex(prev => (prev + 1) % CATEGORIES.length);
      } else if (e.key === 'ArrowLeft') {
        if (focusedZone === 3) setFocusedCardIndex(prev => Math.max(prev - 1, 0));
        else if (focusedZone === 1) setSelectedCategoryIndex(prev => (prev - 1 + CATEGORIES.length) % CATEGORIES.length);
      } else if (e.key === 'ArrowDown') {
        if (focusedZone < 3) setFocusedZone(prev => prev + 1);
        else if (focusedZone === 3) setFocusedCardIndex(prev => Math.min(prev + 4, filteredGames.length - 1));
      } else if (e.key === 'ArrowUp') {
        if (focusedZone === 3) {
          if (focusedCardIndex >= 4) setFocusedCardIndex(prev => prev - 4);
          else setFocusedZone(2);
        } else if (focusedZone > 0) setFocusedZone(prev => prev - 1);
      } else if (e.key === 'Enter') {
        if (selectedGame) launchGame(selectedGame);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredGames, focusedZone, focusedCardIndex, isBooting, selectedGame]);

  // Auto-focus search input element when focusedZone === 0
  useEffect(() => {
    if (focusedZone === 0 && searchInputRef.current) {
      searchInputRef.current.focus();
    } else if (searchInputRef.current) {
      searchInputRef.current.blur();
    }
  }, [focusedZone]);

  // Auto-scroll focused game card into view
  useEffect(() => {
    if (focusedCardRef.current && focusedZone === 3) {
      focusedCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [focusedCardIndex, focusedZone]);

  // Dynamic Background Backdrop URL (uses game snap screenshot, falls back to boxart)
  const bgBackdropUrl = selectedGame ? (selectedGame.snapUrl || selectedGame.boxartUrl) : '';

  return (
    <div>
      {/* Dynamic Full-Screen Game Screenshot Backdrop */}
      {bgBackdropUrl && (
        <div
          className="bg-backdrop"
          style={{ backgroundImage: `url(${bgBackdropUrl})` }}
        />
      )}
      <div className="bg-overlay" />

      {/* Main Content Area */}
      <div className="app-wrapper">
        {/* Top Header Navbar */}
        <header className="top-bar">
          <div className="brand">
            <h1>SEGA DREAMCAST</h1>
          </div>
          <div className={`pad-badge ${gamepadConnected ? 'connected' : ''}`}>
            🎮 {gamepadConnected ? `Connected: ${gamepadName.substring(0, 24)}...` : 'Gamepad Ready (Connect Controller)'}
          </div>
        </header>

        {/* Controls Bar: Search & Category Tabs */}
        {!isBooting && (
          <div className="controls-bar">
            {/* Live Search Input */}
            <div className="search-input-wrapper">
              <span className="search-icon">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search Dreamcast titles (e.g. Crazy Taxi, Marvel, Sonic)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={focusedZone === 0 ? 'focused' : ''}
                onFocus={() => setFocusedZone(0)}
              />
            </div>

            {/* Category Filter Pills */}
            <div className="category-tabs">
              {CATEGORIES.map((cat, idx) => {
                const isActive = selectedCategoryIndex === idx;
                const isFocused = focusedZone === 1 && selectedCategoryIndex === idx;
                return (
                  <button
                    key={idx}
                    className={`category-tab ${isActive ? 'active' : ''} ${isFocused ? 'focused' : ''}`}
                    onClick={() => {
                      setSelectedCategoryIndex(idx);
                      setFocusedZone(1);
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected Game Preview Strip */}
        {!isBooting && selectedGame && (
          <div className="selection-preview-bar">
            <div className="preview-title">
              <h2>{selectedGame.name}</h2>
              <span>CHD Disc Image Format • {(selectedGame.size / (1024 * 1024)).toFixed(1)} MB</span>
            </div>
            <button
              className={`play-action-btn ${focusedZone === 2 ? 'focused' : ''}`}
              onClick={() => launchGame(selectedGame)}
            >
              ► PLAY NOW (Press A)
            </button>
          </div>
        )}

        {/* Clean Game Cards Grid */}
        {!isBooting && (
          <div className="cards-grid">
            {filteredGames.map((game, index) => {
              const isFocused = focusedZone === 3 && index === focusedCardIndex;
              return (
                <div
                  key={index}
                  ref={isFocused ? focusedCardRef : null}
                  className={`game-card-clean ${isFocused ? 'focused' : ''}`}
                  onClick={() => {
                    setFocusedCardIndex(index);
                    setFocusedZone(3);
                    launchGame(game);
                  }}
                  onMouseEnter={() => {
                    setFocusedCardIndex(index);
                  }}
                >
                  <div className="card-media">
                    <img
                      src={game.boxartUrl}
                      alt={game.name}
                      onError={(e) => {
                        e.target.src = game.snapUrl || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=400';
                      }}
                    />
                    <div className="card-badge">DREAMCAST</div>
                  </div>
                  <div className="card-details">
                    <h3>{game.name}</h3>
                    <div className="meta-row">
                      <span>CHD</span>
                      <span>{(game.size / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Controller Legend Footer */}
        {!isBooting && (
          <footer className="controller-footer">
            <div>
              <strong>Controls:</strong> &nbsp;
              <span>🎮 D-Pad / Left Stick: Navigate Grid</span> &nbsp;|&nbsp;
              <span>🅰️ Button A / Enter: Launch</span> &nbsp;|&nbsp;
              <span>LB / RB: Cycle Category Filter</span> &nbsp;|&nbsp;
              <span>🅱️ Button B: Clear Search</span>
            </div>
            <div>Status: {status} ({filteredGames.length} games)</div>
          </footer>
        )}

        {/* Active Emulation Modal */}
        {isBooting && (
          <div className="emu-overlay-screen">
            <button
              className="emu-close-btn"
              onClick={closeGame}
              title="Exit Emulation (Press B or ESC)"
            >
              ✕
            </button>
            <div id="game-container" />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
