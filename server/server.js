const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = 3000;

// Enable CORS for development
app.use(cors());

// Custom BIOS packaging logic to pull from user's NAS mount if they provided them
const romsBiosDir = path.join(__dirname, 'roms', 'bios');
const destBiosDir = path.join(__dirname, 'bios');
const { execSync } = require('child_process');

try {
  if (fs.existsSync(path.join(romsBiosDir, 'dc_boot.bin'))) {
    console.log('Found user-provided BIOS files on NAS mount. Packaging them...');
    execSync(`mkdir -p ${destBiosDir}/dc ${destBiosDir}/data`);
    execSync(`cp "${romsBiosDir}/dc_boot.bin" "${destBiosDir}/"`);
    // Flash bin is optional, ignore errors if missing
    execSync(`cp "${romsBiosDir}/dc_flash.bin" "${destBiosDir}/" 2>/dev/null || true`);
    
    execSync(`cp "${destBiosDir}/dc_boot.bin" "${destBiosDir}/dc/"`);
    execSync(`cp "${destBiosDir}/dc_flash.bin" "${destBiosDir}/dc/" 2>/dev/null || true`);
    
    execSync(`cp "${destBiosDir}/dc_boot.bin" "${destBiosDir}/data/"`);
    execSync(`cp "${destBiosDir}/dc_flash.bin" "${destBiosDir}/data/" 2>/dev/null || true`);
    
    execSync(`cd "${destBiosDir}" && zip -r dc_bios.zip dc_boot.bin dc_flash.bin dc/ data/`);
    console.log('Successfully packaged user-provided BIOS files.');
  } else {
    console.log('No user-provided BIOS files found on NAS mount. Falling back to default downloaded BIOS.');
  }
} catch (err) {
  console.error('Error packaging user-provided BIOS files:', err.message);
}

// Ensure BIOS directory exists for express static (in case it wasn't built yet)
if (!fs.existsSync(destBiosDir)) {
    fs.mkdirSync(destBiosDir, { recursive: true });
}

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

// Provide a clean URL for EmulatorJS to bypass virtual filesystem parsing bugs
app.use('/api/rom/:filename/game.:ext', (req, res, next) => {
  req.url = '/' + encodeURIComponent(req.params.filename);
  next();
}, express.static(path.join(__dirname, 'roms')));

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
