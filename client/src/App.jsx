import { useState, useEffect } from 'react';

function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeGame, setActiveGame] = useState(null);

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
    
    // Apply WebGL and EmulatorJS patches here if needed, similar to the demo
    // For now, we inject the loader.js
    
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

  return (
    <div className="app-container">
      <header>
        <h1>Flycast Arcade</h1>
      </header>

      <div className="hero">
        <div className="hero-content">
          <h2>Dreamcast, Redefined.</h2>
          <p>Stream your favorite classic games directly from the archive in your browser. Powered by WebAssembly and EmulatorJS.</p>
        </div>
      </div>

      <div className="games-section">
        <h3>Available Titles</h3>
        
        {loading ? (
          <div className="loading">Connecting to Archive.org...</div>
        ) : games.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No compatible games (.chd, .cdi, .gdi) found in the configured Archive.org collection.</p>
        ) : (
          <div className="games-row">
            {games.map((game, i) => (
              <div 
                key={i} 
                className="game-card"
                onClick={() => launchGame(game)}
              >
                <h4>{game.name}</h4>
                <p>{(game.size / (1024 * 1024)).toFixed(1)} MB</p>
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
