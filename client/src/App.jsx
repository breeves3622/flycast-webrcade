import { useState, useEffect } from 'react';

function App() {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [isBooting, setIsBooting] = useState(false);
  const [status, setStatus] = useState('Loading game list...');

  useEffect(() => {
    fetch('/api/games')
      .then(res => res.json())
      .then(data => {
        setGames(data);
        if (data.length > 0) {
          setSelectedGame(data[0]);
          setStatus(`Ready to boot: ${data[0].name}`);
        } else {
          setStatus('No games found in local ROM directory.');
        }
      })
      .catch(err => setStatus(`Error fetching games: ${err.message}`));
  }, []);

  const bootTestGame = () => {
    if (!selectedGame) return;
    setIsBooting(true);
    setStatus(`Booting ${selectedGame.name}... Please wait.`);

    // Set up clean EmulatorJS configuration
    window.EJS_player = '#game-container';
    window.EJS_core = 'flycast';
    const ext = selectedGame.filename.split('.').pop();
    window.EJS_gameUrl = `/api/rom/${encodeURIComponent(selectedGame.filename)}/game.${ext}`;
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

    const script = document.createElement('script');
    script.src = '/data/loader.js';
    script.id = 'ejs-loader';
    script.onload = () => setStatus('Emulator engine loaded into DOM.');
    script.onerror = () => setStatus('Failed to load /data/loader.js');
    document.body.appendChild(script);
  };

  return (
    <div style={{
      padding: '40px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#111',
      color: '#fff',
      minHeight: '100vh',
      boxSizing: 'border-box'
    }}>
      <h1 style={{ marginTop: 0, color: '#ff2a6d' }}>Flycast WASM Test Runner</h1>
      <p style={{ color: '#aaa', fontSize: '14px' }}>Minimal diagnostic boot test for Sega Dreamcast WebAssembly core.</p>
      
      <div style={{ margin: '20px 0', padding: '15px', backgroundColor: '#222', borderRadius: '8px', border: '1px solid #333' }}>
        <strong>Status: </strong> <span>{status}</span>
      </div>

      {games.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Select Game: </label>
          <select 
            value={selectedGame ? selectedGame.filename : ''} 
            onChange={(e) => {
              const g = games.find(x => x.filename === e.target.value);
              setSelectedGame(g);
              setStatus(`Ready to boot: ${g.name}`);
            }}
            disabled={isBooting}
            style={{
              padding: '10px 15px',
              fontSize: '16px',
              backgroundColor: '#333',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: '6px',
              width: '100%',
              maxWidth: '500px'
            }}
          >
            {games.map((g, i) => (
              <option key={i} value={g.filename}>
                {g.name} ({(g.size / (1024 * 1024)).toFixed(1)} MB)
              </option>
            ))}
          </select>
        </div>
      )}

      {!isBooting && selectedGame && (
        <button 
          onClick={bootTestGame}
          style={{
            padding: '14px 28px',
            fontSize: '18px',
            fontWeight: 'bold',
            backgroundColor: '#ff2a6d',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          ► BOOT TEST GAME
        </button>
      )}

      <div 
        id="game-container" 
        style={{ 
          marginTop: '30px', 
          width: '640px', 
          height: '480px', 
          backgroundColor: '#000', 
          border: '2px solid #333',
          borderRadius: '8px',
          overflow: 'hidden'
        }}
      ></div>
    </div>
  );
}

export default App;
