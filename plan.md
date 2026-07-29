# Flycast Webrcade Docker Container

This plan outlines the architecture and steps to build a Portainer-ready Docker container that serves a Netflix/webrcade-style UI, embeds the `flycast-wasm` emulator, and streams ROMs directly from Archive.org.

## User Review Required

> [!IMPORTANT]
> **Dreamcast BIOS Files**: The emulator requires `dc_boot.bin` and `dc_flash.bin` to run games. Since these are copyrighted, they cannot be included in the container. The plan assumes these files will be mounted into the container via a volume (e.g., `/app/bios`). Does this approach work for you?
> 
> **Archive.org Source**: I will need an Archive.org Item ID or URL that contains the Dreamcast ROMs (e.g., `.chd` or `.cdi` files) you wish to use. For the plan, I will build a dynamic fetcher, but please provide a specific Archive.org collection or item URL to test with.

## Open Questions

> [!WARNING]
> 1. Which Archive.org URL or Item ID should the app pull ROMs from by default?
> 2. Would you like a specific color scheme (e.g., Dark mode with neon pink/blue like the flycast demo, or a classic dark Netflix theme)?

## Proposed Changes

### Architecture Overview

We will build a full-stack application inside a single Docker container:
- **Backend (Node.js/Express)**: 
  - Injects the strict cross-origin isolation headers (`COEP/COOP`) required by WebAssembly `SharedArrayBuffer` for the emulator to run.
  - Proxies ROM files from Archive.org. Since Archive.org doesn't provide the correct CORS/CORP headers needed for SharedArrayBuffer streaming, the Node backend will stream the chunks (supporting Range requests) to the frontend.
  - Queries Archive.org metadata APIs to generate the game catalog.
- **Frontend (Vite + React)**: 
  - A beautiful, responsive, "webrcade" / Netflix-style UI.
  - Features glassmorphism, smooth animations, and a curated color palette.
  - Hosts the `EmulatorJS` core and dynamic game launcher.

---

### 1. Backend API & Proxy Server (`server/`)
- **`server.js`**: An Express server handling:
  - `/api/games`: Fetches file lists from a configured Archive.org item and returns ROM metadata.
  - `/proxy/:filename`: Streams file bytes from Archive.org, supporting `Range` headers to allow the emulator to download CD chunks on demand without downloading a 1GB file upfront.
  - Serving the static React frontend and `EmulatorJS` dependencies.

### 2. Frontend UI (`client/`)
- **Vite/React Setup**: A modern React application.
- **`App.jsx` & UI Components**: 
  - **Hero Section**: Showcases a featured game.
  - **Game Carousel**: Horizontal scrolling list of available games fetched from Archive.org.
  - **Emulator Overlay**: When a game is clicked, an overlay takes over the screen, mounting the `EmulatorJS` environment with `flycast-wasm`.

### 3. Emulator Dependencies (`scripts/`)
- **`download_deps.sh`**: A build script that automatically fetches:
  - `flycast-wasm.data` from the `nasomers/flycast-wasm` GitHub releases.
  - The `EmulatorJS` loader and frontend data files.
  
### 4. Docker & Portainer Integration
- **`Dockerfile`**: 
  1. Multi-stage build: Builds the React frontend.
  2. Downloads the EmulatorJS and Flycast-WASM cores.
  3. Packages the Node.js Express server with the built static files.
- **`docker-compose.yml`**: A template ready for Portainer, mapping port `3000` and exposing a `/app/bios` volume for the user to drop in the required Dreamcast BIOS files.

## Verification Plan

### Automated Tests
- Build the Docker container locally using `docker-compose build`.
- Start the container and verify that the Express server boots and serves the React UI.

### Manual Verification
- Provide a placeholder Archive.org item to test the metadata fetch.
- Run a lightweight homebrew ROM or testing file through the proxy to ensure `Range` requests and `SharedArrayBuffer` constraints are satisfied.
- Verify the UI aesthetics (hover effects, dark mode) meet premium standards.
