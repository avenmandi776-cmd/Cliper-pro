import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApiRouter } from './server/routes/api';
import { ensureBuiltInAssets } from './server/services/ffmpeg';
import { DATA_ROOT, ensureDirectories, resolveSafeDataPath } from './server/services/store';

const PORT = Number(process.env.PORT || 3000);

async function startServer(): Promise<void> {
  ensureDirectories();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Serve generated/uploaded media files with Range support and path confinement
  app.use('/media', (req, res) => {
    try {
      const relPath = decodeURIComponent(req.path.replace(/^\/+/, ''));
      const absPath = resolveSafeDataPath(path.join(DATA_ROOT, relPath));
      if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
        res.status(404).end();
        return;
      }

      if (req.query.download === '1') {
        res.download(absPath, path.basename(absPath));
        return;
      }

      res.sendFile(absPath);
    } catch {
      res.status(403).end();
    }
  });

  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipGenius AI server running on http://localhost:${PORT}`);
    // Pre-generate royalty-free music tracks & studio intro/outro slates in background
    void ensureBuiltInAssets().catch((err) => {
      console.error('Failed to initialize built-in FFmpeg assets:', err);
    });
  });
}

void startServer();
