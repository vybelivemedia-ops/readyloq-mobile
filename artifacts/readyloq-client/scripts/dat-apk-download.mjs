import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream';

const filename = 'pest-insight-dat-arm64-debug.apk';
const expectedSize = 125235211;
const expectedHash = 'ccf2c837ad3ad6454e88dfafe3202a2a3ff95d2d5bd837a30b1c716a4fac1d57';

/** Development-only transfer of one existing APK; never included in production. */
export function datApkDownload(basePath) {
  let verifiedVersion;
  let verification;
  return {
    name: 'verified-dat-apk-download',
    apply: 'serve',
    configureServer(server) {
      const apkPath = path.resolve(server.config.root, '../../downloads', filename);
      const downloadPath = `${basePath.replace(/\/$/, '')}/downloads/${filename}`;
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname !== downloadPath && pathname !== `/downloads/${filename}`) return next();
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(405, { Allow: 'GET, HEAD' });
          return res.end();
        }
        void (async () => {
          const info = await stat(apkPath);
          if (!info.isFile() || info.size !== expectedSize) throw new Error('APK size mismatch');
          const version = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
          if (version !== verifiedVersion) {
            // Deduplicate concurrent checks; do not block unrelated portal requests.
            verification ??= (async () => {
              const hash = createHash('sha256');
              for await (const chunk of createReadStream(apkPath)) hash.update(chunk);
              if (hash.digest('hex') !== expectedHash) throw new Error('APK checksum mismatch');
              verifiedVersion = version;
            })().finally(() => { verification = undefined; });
            await verification;
            if (verifiedVersion !== version) throw new Error('APK changed during verification');
          }
          if (res.destroyed) return;
          const headers = {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(expectedSize),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, no-store, no-transform',
            'X-Content-Type-Options': 'nosniff',
            ETag: `"${expectedHash}"`,
          };
          let start = 0;
          let end = expectedSize - 1;
          let status = 200;
          if (req.method === 'GET' && req.headers.range &&
              (!req.headers['if-range'] || req.headers['if-range'] === headers.ETag)) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (range && (range[1] || range[2])) {
              start = range[1] ? Number(range[1]) : Math.max(0, expectedSize - Number(range[2]));
              end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
            }
            if (!range || (!range[1] && !range[2]) || start > end || start >= expectedSize) {
              res.writeHead(416, { 'Content-Range': `bytes */${expectedSize}` });
              return res.end();
            }
            status = 206;
            headers['Content-Range'] = `bytes ${start}-${end}/${expectedSize}`;
            headers['Content-Length'] = String(end - start + 1);
          }
          res.writeHead(status, headers);
          if (req.method === 'HEAD') return res.end();
          pipeline(createReadStream(apkPath, { start, end }), res, (error) => {
            if (error && !res.destroyed) res.destroy(error);
          });
        })().catch((error) => {
          console.warn('[DAT APK download]', error.message);
          if (res.headersSent) return res.destroy();
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('The verified test APK is unavailable. No substitute file was served.');
        });
      });
    },
  };
}