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
ARG BUILD_REFRESH=2026-08-06-v26

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

# 3. Download official nasomers/flycast-wasm v1.0 release files
RUN curl -L -o /app/server/data/cores/flycast-wasm.js "https://github.com/nasomers/flycast-wasm/releases/download/v1.0/flycast_libretro.js" && \
    curl -L -o /app/server/data/cores/flycast-wasm.wasm "https://github.com/nasomers/flycast-wasm/releases/download/v1.0/flycast_libretro.wasm" && \
    touch /app/server/data/cores/flycast-wasm.data

# 4. Duplicate core into all 4 filename variations and strip module exports so window.EJS_Runtime is unconditionally set on window
RUN cd /app/server/data/cores && \
    cp flycast-wasm.js flycast-legacy-wasm.js && \
    cp flycast-wasm.wasm flycast-legacy-wasm.wasm && \
    cp flycast-wasm.data flycast-legacy-wasm.data && \
    cp flycast-wasm.js flycast-thread-wasm.js && \
    cp flycast-wasm.wasm flycast-thread-wasm.wasm && \
    cp flycast-wasm.data flycast-thread-wasm.data && \
    cp flycast-wasm.js flycast-thread-legacy-wasm.js && \
    cp flycast-wasm.wasm flycast-thread-legacy-wasm.wasm && \
    cp flycast-wasm.data flycast-thread-legacy-wasm.data && \
    node -e "const fs = require('fs'); ['flycast-wasm.js', 'flycast-legacy-wasm.js', 'flycast-thread-wasm.js', 'flycast-thread-legacy-wasm.js'].forEach(file => { let c = fs.readFileSync(file, 'utf8'); c = c.replace(/if\s*\(typeof exports\s*===\s*'object'[\s\S]*$/, ''); c += '\nwindow.EJS_Runtime = EJS_Runtime;\n'; fs.writeFileSync(file, c); });"

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
