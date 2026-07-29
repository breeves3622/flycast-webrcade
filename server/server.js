const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

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
  next();
});

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
        thumbnailUrl: `https://thumbnails.libretro.com/Sega%20-%20Dreamcast/Named_Boxarts/${encodeURIComponent(cleanName)}.png`,
        // Direct link to the static route
        url: `/roms/${encodeURIComponent(f)}`
      };
    });

    res.json(games);
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
