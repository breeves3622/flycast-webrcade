# Stage 1: Build React Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Build Node Backend & Download Dependencies
FROM node:18-alpine AS backend
WORKDIR /app

# Install tools for downloading dependencies
RUN apk add --no-cache curl unzip git

# Setup directories
RUN mkdir -p /app/client/dist /app/server/data/cores /app/server/bios

# Download EmulatorJS data folder
# We do a sparse checkout to just get the 'data' folder
RUN git clone --depth 1 --filter=blob:none --sparse https://github.com/EmulatorJS/EmulatorJS.git /tmp/emulatorjs && \
    cd /tmp/emulatorjs && \
    git sparse-checkout set data && \
    cp -r data/* /app/server/data/ && \
    rm -rf /tmp/emulatorjs

# Download flycast-wasm core from nasomers release
RUN curl -L -o /app/server/data/cores/flycast-wasm.data "https://github.com/nasomers/flycast-wasm/releases/download/v1.0.0/flycast-wasm.data"

# Download Dreamcast BIOS files from archive.org
RUN curl -L -o /app/server/bios/dc_boot.bin "https://archive.org/download/sega-dreamcast-bios/dc_boot.bin" && \
    curl -L -o /app/server/bios/dc_flash.bin "https://archive.org/download/sega-dreamcast-bios/dc_flash.bin"

# Setup Node server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --production
COPY server/server.js ./

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/client/dist /app/client/dist

# Expose port
EXPOSE 3000

# Run the server
CMD ["node", "server.js"]
