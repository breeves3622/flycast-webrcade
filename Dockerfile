# Stage 1: Build React Frontend
FROM node:20 AS frontend-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN rm -f package-lock.json && npm install
COPY client/ ./
RUN npm run build

# Stage 2: Build Node Backend & Download Dependencies
FROM node:20 AS backend
WORKDIR /app

# Bust Docker layer cache for downloads on new commits
ARG CACHE_DATE=2026-08-04-v20

# Install tools for downloading dependencies
RUN apt-get update && apt-get install -y curl unzip git p7zip-full zip

# Setup directories
RUN mkdir -p /app/client/dist /app/server/data/cores /app/server/bios/dc

# Download full EmulatorJS release
RUN curl -L -o /tmp/emulatorjs.7z "https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.2.3/4.2.3.7z" && \
    cd /tmp && \
    7z x emulatorjs.7z && \
    cp -r data/* /app/server/data/ && \
    rm -rf /tmp/emulatorjs.7z /tmp/data

# Explicitly download the minified emulator files (required by modern EmulatorJS)
RUN curl -L -o /tmp/emulator.min.zip "https://cdn.emulatorjs.org/stable/data/emulator.min.zip" && \
    cd /app/server/data && \
    7z x -y /tmp/emulator.min.zip && \
    rm /tmp/emulator.min.zip

# Download flycast-wasm core from nasomers release and rename to what EmulatorJS expects (flycast-wasm)
RUN curl -L -o /app/server/data/cores/flycast-wasm.js "https://github.com/nasomers/flycast-wasm/releases/download/v1.0/flycast_libretro.js" && \
    curl -L -o /app/server/data/cores/flycast-wasm.wasm "https://github.com/nasomers/flycast-wasm/releases/download/v1.0/flycast_libretro.wasm" && \
    touch /app/server/data/cores/flycast-wasm.data && \
    cd /app/server/data/cores && \
    cp flycast-wasm.js flycast-legacy-wasm.js && \
    cp flycast-wasm.wasm flycast-legacy-wasm.wasm && \
    cp flycast-wasm.data flycast-legacy-wasm.data && \
    cp flycast-wasm.js flycast-thread-wasm.js && \
    cp flycast-wasm.wasm flycast-thread-wasm.wasm && \
    cp flycast-wasm.data flycast-thread-wasm.data && \
    cp flycast-wasm.js flycast-thread-legacy-wasm.js && \
    cp flycast-wasm.wasm flycast-thread-legacy-wasm.wasm && \
    cp flycast-wasm.data flycast-thread-legacy-wasm.data && \
    echo "window.EJS_Runtime = EJS_Runtime;" >> flycast-wasm.js && \
    echo "window.EJS_Runtime = EJS_Runtime;" >> flycast-legacy-wasm.js && \
    echo "window.EJS_Runtime = EJS_Runtime;" >> flycast-thread-wasm.js && \
    echo "window.EJS_Runtime = EJS_Runtime;" >> flycast-thread-legacy-wasm.js

# Generate core report metadata expected by EmulatorJS
RUN mkdir -p /app/server/data/cores/reports && \
    echo '{"name":"flycast","extensions":["cdi","gdi","chd","cue","iso"],"options":{"defaultWebGL2":true}}' > /app/server/data/cores/reports/flycast.json && \
    echo '{"name":"flycast","extensions":["cdi","gdi","chd","cue","iso"],"options":{"defaultWebGL2":true}}' > /app/server/data/cores/reports/flycast-wasm.json

# Download Dreamcast BIOS files from archive.org and package into a zip for correct folder structure
RUN mkdir -p /app/server/bios/dc /app/server/bios/data && \
    curl -L -o /app/server/bios/dc_boot.bin "https://archive.org/download/sega-dreamcast-bios/dc_boot.bin" && \
    curl -L -o /app/server/bios/dc_flash.bin "https://archive.org/download/sega-dreamcast-bios/dc_flash.bin" && \
    cp /app/server/bios/dc_boot.bin /app/server/bios/dc/ && \
    cp /app/server/bios/dc_flash.bin /app/server/bios/dc/ && \
    cp /app/server/bios/dc_boot.bin /app/server/bios/data/ && \
    cp /app/server/bios/dc_flash.bin /app/server/bios/data/ && \
    cd /app/server/bios && \
    zip -r dc_bios.zip dc_boot.bin dc_flash.bin dc/ data/

# Setup Node server
WORKDIR /app/server
COPY server/package*.json ./
RUN rm -f package-lock.json && npm install --production
COPY server/server.js ./

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/client/dist /app/client/dist

# Expose port
EXPOSE 3000

# Run the server
CMD ["node", "server.js"]
