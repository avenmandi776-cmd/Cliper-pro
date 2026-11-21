# ClipGenius AI

ClipGenius AI is a full-stack AI video clipping and vertical short-form production studio built with React, TypeScript, Tailwind CSS, Express, FFmpeg, and the Google Gemini API (`@google/genai`).

## Features

- **AI Video Clipping & Highlight Detection**: Upload videos (MP4, MOV, WebM, MKV) or generate a spoken-word sample podcast video. Choose clip durations (`15s`, `30s`, `45s`, `60s`) and detect viral moments, funny exchanges, reactions, and key insights scored `1–100` with explanations, titles, descriptions, and hashtags.
- **Multi-Language Auto Captions**: Speech transcription via `gemini-3.5-transcribe` (or an optional Whisper-compatible endpoint) supporting **English**, **Hindi**, and **Bengali**. Includes AI caption correction, word-by-word animated `.ass` burn-in styles, font/color/size/position customization, and `.srt` export.
- **Authorized Live Stream Clipping**: Monitor authorized HLS streams, YouTube Live broadcasts (via official YouTube oEmbed metadata + optional authorized relay), or the built-in Studio Demo Live Stream. Supports continuous segment analysis, auto-clipping, and one-click manual clipping (`15s`, `30s`, `45s`).
- **9:16 Vertical Video Editor**: Render `720×1280` (HD) or `480×854` (low-resource) vertical MP4s with auto-reframe / subject focus tracking, blurred 16:9 fit backdrop, licensed background music mixing with volume ducking, and custom intro/outro concatenation.
- **Resilient Background Queue**: Sequential low-resource job worker with live progress indicators and failed-job stage resumption.

## Prerequisites

- **Node.js** `>= 20` (tested on `v22`)
- **FFmpeg** & **FFprobe** installed on `PATH` (compiled with `libx264`, `libass`, `libfreetype`, and `libflite` for built-in sample generation)
- **GEMINI_API_KEY** configured as a server environment variable

## Setup Instructions

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables (keep secrets server-side only):
   ```bash
   export GEMINI_API_KEY="your_gemini_api_key"
   # Optional: override default Gemini model
   export GEMINI_MODEL="gemini-4-hydrogen"
   # Optional: Whisper-compatible HTTP transcription endpoint
   export WHISPER_API_URL=""
   ```

3. Start the full-stack server on port `3000`:
   ```bash
   npm run dev
   ```

4. Run unit tests for subtitle generation and video math:
   ```bash
   npx --yes tsx --test shared/subtitles.test.ts shared/videoMath.test.ts
   ```

5. Build for production:
   ```bash
   npm run build
   npm start
   ```

## Live Stream Authorization Policy

ClipGenius AI is designed strictly for streams that you own or have explicit permission to record and process. It never bypasses DRM, access controls, or platform restrictions. For YouTube Live URLs, official metadata is retrieved via YouTube's oEmbed API, and video frame ingestion uses an authorized companion HLS/RTMP relay or studio stream input.
