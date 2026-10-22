const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "sources.json");
const PORT = Number(process.env.PORT || 10000);
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || "";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const SOURCE_FILE_PATH = "data/sources.json";
const SESSION_COOKIE = "aniverse_session";
const SESSION_SECONDS = 8 * 60 * 60;

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

function localRecords() {
  try {
    const value = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
}

function repositoryFileUrl() {
  if (!GITHUB_REPOSITORY || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GITHUB_REPOSITORY)) {
    throw new Error("Set GITHUB_REPOSITORY as owner/repository.");
  }
  return "https://api.github.com/repos/" + GITHUB_REPOSITORY + "/contents/" +
    SOURCE_FILE_PATH + "?ref=" + encodeURIComponent(GITHUB_BRANCH);
}

function githubHeaders(extra) {
  return Object.assign({
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + GITHUB_TOKEN,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "AniVerse-Source-Manager"
  }, extra || {});
}

async function getRepositoryRecords() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return localRecords();
  const response = await fetch(repositoryFileUrl(), { headers: githubHeaders() });
  if (response.status === 404) return localRecords();
  if (!response.ok) throw new Error("GitHub read failed (" + response.status + ").");
  const file = await response.json();
  try {
    const records = JSON.parse(Buffer.from(file.content || "", "base64").toString("utf8"));
    return records && typeof records === "object" && !Array.isArray(records) ? records : {};
  } catch (error) {
    throw new Error("The shared source file contains invalid JSON.");
  }
}

async function saveRepositoryRecords(records) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    const error = new Error("Shared sync is not configured. Add GITHUB_TOKEN and GITHUB_REPOSITORY in Render.");
    error.statusCode = 503;
    throw error;
  }
  let sha;
  const getResponse = await fetch(repositoryFileUrl(), { headers: githubHeaders() });
  if (getResponse.ok) {
    const existing = await getResponse.json();
    sha = existing.sha;
  } else if (getResponse.status !== 404) {
    throw new Error("GitHub could not read the source file (" + getResponse.status + ").");
  }
  const endpoint = "https://api.github.com/repos/" + GITHUB_REPOSITORY + "/contents/" + SOURCE_FILE_PATH;
  const body = {
    message: "Update AniVerse episode sources",
    content: Buffer.from(JSON.stringify(records, null, 2) + "\n", "utf8").toString("base64"),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: githubHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("GitHub could not save the source file (" + response.status + "). " + detail.slice(0, 220));
  }
  return response.json();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_SECONDS * 1000 })).toString("base64url");
  return payload + "." + sign(payload);
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const item of cookies) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return "";
}

function isAdmin(req) {
  if (!SESSION_SECRET) return false;
  const token = cookieValue(req, SESSION_COOKIE);
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(parts[1], sign(parts[0]))) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return Number(payload.exp) > Date.now();
  } catch (error) {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Please log in as an admin." });
  next();
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function cleanSource(input) {
  if (!input || typeof input !== "object") throw badRequest("Provide an episode/source object.");
  const name = String(input.name || "").trim().slice(0, 90);
  const url = String(input.url || "").trim();
  const language = String(input.language || "").trim().slice(0, 60);
  const type = ["auto", "video", "embed"].includes(input.type) ? input.type : "auto";
  if (!name) throw badRequest("Episode/source name is required.");
  let parsed;
  try { parsed = new URL(url); } catch (error) { throw badRequest("Enter a valid video or embed URL."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw badRequest("Only HTTP and HTTPS URLs are accepted.");
  if (url.length > 2500) throw badRequest("The URL is too long.");
  return { id: String(input.id || crypto.randomUUID()).slice(0, 80), name, language, url, type, updatedAt: new Date().toISOString() };
}

function cleanAnimeId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9]{1,12}$/.test(id)) throw badRequest("Anime ID must be a numeric catalogue ID.");
  return id;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "AniVerse API",
    sharedSyncConfigured: Boolean(GITHUB_TOKEN && GITHUB_REPOSITORY),
    adminConfigured: Boolean(ADMIN_PASSWORD && SESSION_SECRET)
  });
});

app.get("/api/catalog", async (req, res, next) => {
  try {
    const records = await getRepositoryRecords();
    res.setHeader("Cache-Control", "no-store");
    res.json({ records: records });
  } catch (error) { next(error); }
});

app.get("/api/sources/:animeId", async (req, res, next) => {
  try {
    const id = cleanAnimeId(req.params.animeId);
    const records = await getRepositoryRecords();
    const record = records[id] || { mal_id: Number(id), title: "", sources: [] };
    res.setHeader("Cache-Control", "no-store");
    res.json({ anime: record, sources: Array.isArray(record.sources) ? record.sources : [] });
  } catch (error) { next(error); }
});

app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD || !SESSION_SECRET) {
    return res.status(503).json({ error: "Admin login is not configured. Set ADMIN_PASSWORD and SESSION_SECRET in Render." });
  }
  if (!safeEqual(req.body && req.body.password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Incorrect admin password." });
  }
  const cookie = SESSION_COOKIE + "=" + createSession() +
    "; Path=/; Max-Age=" + SESSION_SECONDS + "; HttpOnly; SameSite=Strict" +
    (process.env.NODE_ENV === "production" ? "; Secure" : "");
  res.setHeader("Set-Cookie", cookie);
  res.json({ ok: true, expiresIn: SESSION_SECONDS });
});

app.get("/api/admin/session", (req, res) => {
  res.json({ authenticated: isAdmin(req) });
});

app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict" +
    (process.env.NODE_ENV === "production" ? "; Secure" : ""));
  res.json({ ok: true });
});

app.post("/api/admin/sources", requireAdmin, async (req, res, next) => {
  try {
    const id = cleanAnimeId(req.body && req.body.mal_id);
    const title = String(req.body && req.body.title || "").trim().slice(0, 180);
    if (!title) return res.status(400).json({ error: "Anime title is required." });
    const source = cleanSource(req.body && req.body.source);
    const records = await getRepositoryRecords();
    const existing = records[id] || { mal_id: Number(id), title: title, sources: [] };
    const sources = Array.isArray(existing.sources) ? existing.sources.slice() : [];
    const duplicate = sources.findIndex(x => x.url === source.url && x.name === source.name);
    if (duplicate >= 0) sources[duplicate] = Object.assign({}, sources[duplicate], source);
    else sources.push(source);
    records[id] = { mal_id: Number(id), title: title, sources: sources, updatedAt: new Date().toISOString() };
    await saveRepositoryRecords(records);
    res.json({ ok: true, anime: records[id] });
  } catch (error) { next(error); }
});

app.delete("/api/admin/sources/:animeId/:sourceId", requireAdmin, async (req, res, next) => {
  try {
    const id = cleanAnimeId(req.params.animeId);
    const records = await getRepositoryRecords();
    if (!records[id]) return res.status(404).json({ error: "Anime has no shared source record." });
    records[id].sources = (Array.isArray(records[id].sources) ? records[id].sources : [])
      .filter(source => String(source.id) !== String(req.params.sourceId));
    records[id].updatedAt = new Date().toISOString();
    await saveRepositoryRecords(records);
    res.json({ ok: true, anime: records[id] });
  } catch (error) { next(error); }
});

app.get("/admin", (req, res) => res.sendFile(path.join(ROOT, "admin.html")));
app.get("/admin.html", (req, res) => res.sendFile(path.join(ROOT, "admin.html")));
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/index.html", (req, res) => res.sendFile(path.join(ROOT, "index.html")));

app.use((error, req, res, next) => {
  const status = Number(error.statusCode) || 500;
  res.status(status).json({ error: status === 500 ? "Server error. Check the Render logs and environment variables." : error.message });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("AniVerse listening on port " + PORT);
  if (!ADMIN_PASSWORD || !SESSION_SECRET) console.warn("Admin login requires ADMIN_PASSWORD and SESSION_SECRET.");
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) console.warn("Shared GitHub source sync is not configured yet.");
});
