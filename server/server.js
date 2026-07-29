const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const ARCHIVE_ITEM_ID = process.env.ARCHIVE_ITEM_ID || 'Dreamcast_Collection_Test'; // Placeholder

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

// API: Get Games from Archive.org
app.get('/api/games', async (req, res) => {
  try {
    const archiveUrl = `https://archive.org/metadata/${ARCHIVE_ITEM_ID}`;
    const response = await axios.get(archiveUrl);
    const files = response.data.files || [];
    
    // Filter out only supported ROM types (.chd, .cdi, .gdi) and only USA region
    const games = files.filter(f => f.name.match(/\.(chd|cdi|gdi)$/i) && f.name.includes('(USA)')).map(f => {
      return {
        name: f.name.replace(/\.[^/.]+$/, ""),
        filename: f.name,
        size: f.size,
        // We generate a local proxy URL to circumvent CORS and COEP constraints
        url: `/proxy/${encodeURIComponent(f.name)}`
      };
    });

    res.json(games);
  } catch (error) {
    console.error('Error fetching from Archive.org:', error.message);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// API: Proxy file from Archive.org to support Range requests and inject COEP headers
app.get('/proxy/:filename', (req, res) => {
  const filename = req.params.filename;
  // Construct the direct download URL for the archive item
  const fileUrl = `https://archive.org/download/${ARCHIVE_ITEM_ID}/${encodeURIComponent(filename)}`;

  const options = {
    headers: {}
  };

  // Forward range headers for chunked loading
  if (req.headers.range) {
    options.headers['Range'] = req.headers.range;
  }

  // We use http.get or axios stream, but for seamless proxying with headers, 
  // Native HTTP client streaming is often cleaner for byte ranges
  axios({
    method: 'get',
    url: fileUrl,
    headers: options.headers,
    responseType: 'stream',
    validateStatus: status => status >= 200 && status < 400
  })
  .then(response => {
    // Copy the relevant headers from Archive.org (like Content-Type, Content-Length, Content-Range)
    const headersToForward = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    headersToForward.forEach(header => {
      if (response.headers[header]) {
        res.setHeader(header, response.headers[header]);
      }
    });

    res.status(response.status);
    response.data.pipe(res);
  })
  .catch(err => {
    console.error(`Error proxying file ${filename}:`, err.message);
    res.status(500).send('Proxy Error');
  });
});

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
  console.log(`Configured for Archive.org Item: ${ARCHIVE_ITEM_ID}`);
});
