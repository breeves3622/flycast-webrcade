import { useState, useEffect, useRef } from 'react';

function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeGame, setActiveGame] = useState(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  
  const gameRefs = useRef([]);
  const lastInputTime = useRef(0);

  useEffect(() => {
    // Fetch games from our Node Express backend
    fetch('/api/games')
      .then(res => res.json())
      .then(data => {
        setGames(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load games:', err);
        setLoading(false);
      });
  }, []);

  const launchGame = (game) => {
    setActiveGame(game);
    
    // Set up EmulatorJS Globals
    window.EJS_player = '#game-container';
    window.EJS_core = 'flycast';
    window.EJS_gameUrl = game.url; // This points to our /proxy/:filename
    window.EJS_pathtodata = '/data/'; // Served by Express static or docker volume
    window.EJS_startOnLoaded = true;
    window.EJS_color = '#ff2a6d';
    window.EJS_biosUrl = '/bios/dc_boot.bin'; // We expect this in the proxy
    
    const script = document.createElement('script');
    script.src = '/data/loader.js';
    script.id = 'ejs-loader';
    document.body.appendChild(script);
  };

  const closeEmulator = () => {
    setActiveGame(null);
    // Reload page to clear EmulatorJS from memory since it mutates globals heavily
    window.location.reload();
  };

  // Scroll focused element into view
  useEffect(() => {
    if (!activeGame && gameRefs.current[focusedIndex]) {
      gameRefs.current[focusedIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
  }, [focusedIndex, activeGame]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (activeGame) return; // Disable menu navigation while game is playing

      if (e.key === 'ArrowRight') {
        setFocusedIndex(prev => Math.min(prev + 1, games.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setFocusedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        if (games.length > 0) {
          launchGame(games[focusedIndex]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeGame, games, focusedIndex]);

  // Gamepad navigation (polling loop)
  useEffect(() => {
    let animationFrameId;

    const pollGamepad = () => {
      if (!activeGame) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads[0];

        if (gp) {
          const now = Date.now();
          // 200ms debounce to prevent rapid firing
          if (now - lastInputTime.current > 200) {
            const axesX = gp.axes[0];
            const dpadLeft = gp.buttons[14]?.pressed;
            const dpadRight = gp.buttons[15]?.pressed;
            const buttonA = gp.buttons[0]?.pressed;

            let moved = false;

            if (axesX > 0.5 || dpadRight) {
              setFocusedIndex(prev => Math.min(prev + 1, games.length - 1));
              moved = true;
            } else if (axesX < -0.5 || dpadLeft) {
              setFocusedIndex(prev => Math.max(prev - 1, 0));
              moved = true;
            } else if (buttonA) {
              if (games.length > 0) {
                launchGame(games[focusedIndex]);
              }
              moved = true;
            }

            if (moved) {
              lastInputTime.current = now;
            }
          }
        }
      }

      animationFrameId = requestAnimationFrame(pollGamepad);
    };

    animationFrameId = requestAnimationFrame(pollGamepad);
    return () => cancelAnimationFrame(animationFrameId);
  }, [activeGame, games, focusedIndex]);

  return (
    <div className="app-container">
      <header>
        <h1>Flycast Arcade</h1>
      </header>

      <div className="hero">
        <div className="hero-content">
          <h2>Dreamcast, Redefined.</h2>
          <p>Stream your favorite classic games instantly from your local network. Powered by WebAssembly and EmulatorJS.</p>
        </div>
      </div>

      <div className="games-section">
        <h3>Available Titles</h3>
        
        {loading ? (
          <div className="loading">Scanning local ROMs directory...</div>
        ) : games.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No USA/US games (.chd, .cdi, .gdi) found in your local ROM directory.</p>
        ) : (
          <div className="games-row">
            {games.map((game, i) => (
              <div 
                key={i} 
                ref={el => gameRefs.current[i] = el}
                className={`game-card ${i === focusedIndex ? 'focused' : ''}`}
                onClick={() => {
                  setFocusedIndex(i);
                  launchGame(game);
                }}
                onMouseEnter={() => setFocusedIndex(i)}
              >
                <div className="game-art">
                  <img src={game.thumbnailUrl} alt={game.name} loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                </div>
                <div className="game-info">
                  <h4>{game.name}</h4>
                  <p>{(game.size / (1024 * 1024)).toFixed(1)} MB</p>
                </div>
                <div className="play-icon">
                  <svg viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeGame && (
        <div className="emulator-overlay">
          <button className="emulator-close" onClick={closeEmulator}>
            &times;
          </button>
          <div id="game-container"></div>
        </div>
      )}
    </div>
  );
}

export default App;
