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
  next();
});

// Provide a clean URL for EmulatorJS to bypass virtual filesystem parsing bugs
app.get('/api/rom/:filename/game.:ext', (req, res) => {
  const filePath = path.join(__dirname, 'roms', req.params.filename);
  res.sendFile(filePath);
});

// Custom BIOS packaging logic to pull from user's NAS mount if they provided them
const destBiosDir = path.join(__dirname, 'bios');
const romsDir = path.join(__dirname, 'roms');
const { execSync } = require('child_process');

try {
  let foundBoot = null;
  let foundFlash = null;
  
  // Recursively search for bios files (case-insensitive) up to 2 levels deep
  function findBiosFiles(dir, depth) {
    if (depth > 2) return;
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          findBiosFiles(fullPath, depth + 1);
        } else {
          const lower = file.toLowerCase();
          if (lower === 'dc_boot.bin' || lower === 'dc_boot.rom' || 
             ((lower.includes('bios') || lower.includes('boot')) && (lower.endsWith('.bin') || lower.endsWith('.rom')))) {
            foundBoot = fullPath;
          }
          if (lower === 'dc_flash.bin' || lower === 'dc_flash.rom' || 
             (lower.includes('flash') && (lower.endsWith('.bin') || lower.endsWith('.rom')))) {
            foundFlash = fullPath;
          }
        }
      } catch (e) {}
    }
  }
  
  findBiosFiles(romsDir, 0);

  if (foundBoot) {
    console.log(`Found user-provided BIOS files on NAS mount (${foundBoot}). Packaging them...`);
    execSync(`mkdir -p ${destBiosDir}/dc ${destBiosDir}/data`);
    execSync(`cp "${foundBoot}" "${destBiosDir}/dc_boot.bin"`);
    
    if (foundFlash) {
      execSync(`cp "${foundFlash}" "${destBiosDir}/dc_flash.bin"`);
    }
    
    execSync(`cp "${destBiosDir}/dc_boot.bin" "${destBiosDir}/dc/"`);
    if (foundFlash) execSync(`cp "${destBiosDir}/dc_flash.bin" "${destBiosDir}/dc/"`);
    
    execSync(`cp "${destBiosDir}/dc_boot.bin" "${destBiosDir}/data/"`);
    if (foundFlash) execSync(`cp "${destBiosDir}/dc_flash.bin" "${destBiosDir}/data/"`);
    
    const zipFiles = foundFlash ? "dc_boot.bin dc_flash.bin" : "dc_boot.bin";
    execSync(`cd "${destBiosDir}" && zip -r dc_bios.zip ${zipFiles} dc/ data/`);
    console.log('Successfully packaged user-provided BIOS files.');
  } else {
    console.log('No user-provided BIOS files found on NAS mount. Falling back to default downloaded BIOS.');
  }
} catch (err) {
  console.error('Error packaging user-provided BIOS files:', err.message);
}



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
