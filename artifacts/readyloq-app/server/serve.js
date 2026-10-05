/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function createServer(options = {}) {
  const staticRoot = fs.realpathSync(options.staticRoot || STATIC_ROOT);
  const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");
  const landingPageTemplate =
    options.landingPageTemplate ??
    fs.readFileSync(options.templatePath || TEMPLATE_PATH, "utf-8");
  const appName = options.appName || getAppName();

  function resolveStaticFile(urlPath) {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(urlPath);
    } catch {
      return { status: 400 };
    }

    // Backslashes are path separators on Windows, but ordinary characters on
    // POSIX. Reject them consistently so traversal cannot vary by platform.
    if (decodedPath.includes("\\") || decodedPath.includes("\0")) {
      return { status: 403 };
    }

    const relativePath = decodedPath.replace(/^\/+/, "");
    const candidatePath = path.resolve(staticRoot, relativePath);
    if (
      candidatePath !== staticRoot &&
      !candidatePath.startsWith(staticRoot + path.sep)
    ) {
      return { status: 403 };
    }

    let realPath;
    try {
      realPath = fs.realpathSync(candidatePath);
    } catch {
      return { status: 404 };
    }
    if (realPath !== staticRoot && !realPath.startsWith(staticRoot + path.sep)) {
      return { status: 403 };
    }

    try {
      if (fs.statSync(realPath).isDirectory()) {
        return { status: 404 };
      }
    } catch {
      return { status: 404 };
    }
    return { path: realPath };
  }

  function serveStaticFile(urlPath, res) {
    const resolved = resolveStaticFile(urlPath);
    if (!resolved.path) {
      res.writeHead(resolved.status);
      res.end(resolved.status === 403 ? "Forbidden" : "Not Found");
      return;
    }

    const ext = path.extname(resolved.path).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = fs.readFileSync(resolved.path);
    res.writeHead(200, { "content-type": contentType });
    res.end(content);
  }

  function serveManifest(platform, res) {
    const resolved = resolveStaticFile(`${platform}/manifest.json`);
    if (!resolved.path) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
      );
      return;
    }

    const manifest = fs.readFileSync(resolved.path, "utf-8");
    res.writeHead(200, {
      "content-type": "application/json",
      "expo-protocol-version": "1",
      "expo-sfv-version": "0",
    });
    res.end(manifest);
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    let pathname = url.pathname;

    if (basePath && pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length) || "/";
    }

    if (pathname === "/" || pathname === "/manifest") {
      const platform = req.headers["expo-platform"];
      if (platform === "ios" || platform === "android") {
        return serveManifest(platform, res);
      }

      if (pathname === "/") {
        return serveLandingPage(req, res, landingPageTemplate, appName);
      }
    }

    serveStaticFile(pathname, res);
  });
}

module.exports = { createServer };

if (require.main === module) {
  const server = createServer();
  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Serving static Expo build on port ${port}`);
  });
}
