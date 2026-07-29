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

# Install tools for downloading dependencies
RUN apt-get update && apt-get install -y curl unzip git p7zip-full

# Setup directories
RUN mkdir -p /app/client/dist /app/server/data/cores /app/server/bios

# Download full EmulatorJS release
RUN curl -L -o /tmp/emulatorjs.7z "https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.2.3/4.2.3.7z" && \
    cd /tmp && \
    7z x emulatorjs.7z && \
    cp -r data/* /app/server/data/ && \
    rm -rf /tmp/emulatorjs.7z /tmp/data

# Explicitly download the minified emulator files (required by modern EmulatorJS)
RUN curl -L -o /tmp/emulator.min.zip "https://cdn.emulatorjs.org/stable/data/emulator.min.zip" && \
    cd /app/server/data && \
    unzip -o /tmp/emulator.min.zip && \
    rm /tmp/emulator.min.zip

# Download flycast-wasm core from nasomers release and rename to what EmulatorJS expects (flycast-legacy-wasm)
RUN curl -L -o /app/server/data/cores/flycast-legacy-wasm.data "https://github.com/nasomers/flycast-wasm/releases/download/v1.0.0/flycast-wasm.data" && \
    curl -L -o /app/server/data/cores/flycast-legacy-wasm.js "https://github.com/nasomers/flycast-wasm/releases/download/v1.0.0/flycast_libretro.js" && \
    curl -L -o /app/server/data/cores/flycast-legacy-wasm.wasm "https://github.com/nasomers/flycast-wasm/releases/download/v1.0.0/flycast_libretro.wasm"

# Download Dreamcast BIOS files from archive.org
RUN curl -L -o /app/server/bios/dc_boot.bin "https://archive.org/download/sega-dreamcast-bios/dc_boot.bin" && \
    curl -L -o /app/server/bios/dc_flash.bin "https://archive.org/download/sega-dreamcast-bios/dc_flash.bin"

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
