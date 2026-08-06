# Stage 1: Build React Frontend
FROM node:20 AS frontend-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN rm -f package-lock.json && npm install
COPY client/ ./
RUN npm run build

# Stage 2: Build Node Backend & Download Official Dependencies
FROM node:20 AS backend
WORKDIR /app

# Invalidate cache for clean build
ARG BUILD_REFRESH=2026-08-06-v28

# Install build tools
RUN apt-get update && apt-get install -y curl unzip git p7zip-full zip

# Setup directory structure
RUN mkdir -p /app/client/dist /app/server/data/cores /app/server/bios/dc /app/server/data/cores/reports

# 1. Download official EmulatorJS 4.2.3 release
RUN curl -L -o /tmp/emulatorjs.7z "https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.2.3/4.2.3.7z" && \
    cd /tmp && \
    7z x emulatorjs.7z && \
    cp -r data/* /app/server/data/ && \
    rm -rf /tmp/emulatorjs.7z /tmp/data

# 2. Download official minified EmulatorJS engine and patch requiresWebGL2 to include flycast
RUN curl -L -o /tmp/emulator.min.zip "https://cdn.emulatorjs.org/stable/data/emulator.min.zip" && \
    cd /app/server/data && \
    7z x -y /tmp/emulator.min.zip && \
    rm /tmp/emulator.min.zip && \
    node -e "const fs = require('fs'); let c = fs.readFileSync('emulator.min.js', 'utf8'); c = c.replace('requiresWebGL2(t){return[\"ppsspp\"].includes(t)}', 'requiresWebGL2(t){return[\"ppsspp\",\"flycast\"].includes(t)}'); fs.writeFileSync('emulator.min.js', c);"

# 3. Build valid 7z core archives (flycast-wasm.data) containing flycast.js and flycast.wasm
RUN curl -L -o /tmp/flycast_libretro.js "https://github.com/nasomers/flycast-wasm/releases/download/v1.0/flycast_libretro.js" && \
    curl -L -o /tmp/flycast.wasm "https://github.com/nasomers/flycast-wasm/releases/download/v1.0/flycast_libretro.wasm" && \
    node -e "const fs = require('fs'); let c = fs.readFileSync('/tmp/flycast_libretro.js', 'utf8'); c = c.replace(/if\s*\(typeof exports\s*===\s*'object'[\s\S]*$/, ''); c = c.replace('ctx.audioWorklet.addModule', 'if(!ctx.audioWorklet) ctx.audioWorklet = { addModule: () => Promise.reject() }; ctx.audioWorklet.addModule'); c += '\nwindow.EJS_Runtime = EJS_Runtime;\n'; fs.writeFileSync('/tmp/flycast.js', c);" && \
    echo '{"name":"flycast","extensions":["cdi","gdi","chd","cue","iso"],"options":{"defaultWebGL2":true}}' > /tmp/core.json && \
    cd /tmp && \
    7z a -t7z /app/server/data/cores/flycast-wasm.data flycast.js flycast.wasm core.json && \
    cp /app/server/data/cores/flycast-wasm.data /app/server/data/cores/flycast-legacy-wasm.data && \
    cp /app/server/data/cores/flycast-wasm.data /app/server/data/cores/flycast-thread-wasm.data && \
    cp /app/server/data/cores/flycast-wasm.data /app/server/data/cores/flycast-thread-legacy-wasm.data

# 5. Generate core metadata expected by EmulatorJS loader
RUN echo '{"name":"flycast","extensions":["cdi","gdi","chd","cue","iso"],"options":{"defaultWebGL2":true}}' > /app/server/data/cores/reports/flycast.json && \
    echo '{"name":"flycast","extensions":["cdi","gdi","chd","cue","iso"],"options":{"defaultWebGL2":true}}' > /app/server/data/cores/reports/flycast-wasm.json

# 6. Setup Dreamcast BIOS directory structure
RUN mkdir -p /app/server/bios/dc /app/server/bios/data && \
    touch /app/server/bios/dc_boot.bin /app/server/bios/dc_flash.bin && \
    cp /app/server/bios/dc_boot.bin /app/server/bios/dc/ && \
    cp /app/server/bios/dc_flash.bin /app/server/bios/dc/ && \
    cp /app/server/bios/dc_boot.bin /app/server/bios/data/ && \
    cp /app/server/bios/dc_flash.bin /app/server/bios/data/ && \
    cd /app/server/bios && \
    zip -r dc_bios.zip dc_boot.bin dc_flash.bin dc/ data/

# 7. Setup Node server & dependencies
WORKDIR /app/server
COPY server/package*.json ./
RUN rm -f package-lock.json && npm install --production
COPY server/server.js ./

# 8. Copy built frontend from Stage 1
COPY --from=frontend-builder /app/client/dist /app/client/dist

EXPOSE 3000

CMD ["node", "server.js"]
