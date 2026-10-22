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
const HIANIME_FEED_URL = process.env.HIANIME_FEED_URL || "";
const HIANIME_FEED_TOKEN = process.env.HIANIME_FEED_TOKEN || "";
const HIANIME_SYNC_MINUTES = Math.max(15, Number(process.env.HIANIME_SYNC_MINUTES || 60));
let feedSyncInProgress = false;
let lastFeedSync = { at: null, ok: null, message: "Not synced yet.", importedAnime: 0, importedEpisodes: 0, importedSources: 0 };
const SOURCE_FILE_PATH = "data/sources.json";
const SESSION_COOKIE = "aniverse_session";
const SESSION_SECONDS = 8 * 60 * 60;

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
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
  return { id: String(input.id || crypto.randomUUID()).slice(0, 80), name, language, url, type, episodeNumber: input.episodeNumber == null ? null : String(input.episodeNumber).slice(0, 24), episodeTitle: String(input.episodeTitle || "").trim().slice(0, 180), provider: String(input.provider || "").trim().slice(0, 80), updatedAt: new Date().toISOString() };
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
    authorizedFeedConfigured: Boolean(HIANIME_FEED_URL),
    feedSyncIntervalMinutes: HIANIME_SYNC_MINUTES,
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

function feedUrl() {
  let parsed;
  try { parsed = new URL(HIANIME_FEED_URL); } catch (error) { throw new Error("Set HIANIME_FEED_URL to an authorized JSON feed URL."); }
  if (parsed.protocol !== "https:") throw new Error("The authorized feed must use HTTPS.");
  return parsed.toString();
}

async function syncAuthorizedFeed() {
  if (feedSyncInProgress) throw new Error("A feed sync is already running.");
  if (!HIANIME_FEED_URL) throw new Error("Configure HIANIME_FEED_URL with a JSON feed you are authorized to use.");
  feedSyncInProgress = true;
  try {
    const headers = { "Accept": "application/json", "User-Agent": "AniVerse-Authorized-Feed-Sync" };
    if (HIANIME_FEED_TOKEN) headers.Authorization = "Bearer " + HIANIME_FEED_TOKEN;
    const response = await fetch(feedUrl(), { headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("Feed request failed (" + response.status + ").");
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.anime)) throw new Error('Feed JSON must contain an "anime" array.');
    if (payload.anime.length > 500) throw new Error("Feed is limited to 500 anime per sync.");
    const records = await getRepositoryRecords();
    let importedAnime = 0, importedEpisodes = 0, importedSources = 0;
    for (const item of payload.anime) {
      const id = cleanAnimeId(item && (item.mal_id || item.id));
      const title = String(item && item.title || "").trim().slice(0, 180);
      if (!title) continue;
      const existing = records[id] || { mal_id: Number(id), title, sources: [] };
      const sources = Array.isArray(existing.sources) ? existing.sources.slice() : [];
      const episodes = Array.isArray(item.episodes) ? item.episodes.slice(0, 2000).map(ep => ({
        number: String(ep.number == null ? "" : ep.number).slice(0, 24),
        title: String(ep.title || "").trim().slice(0, 180),
        language: String(ep.language || "").trim().slice(0, 60),
        updatedAt: new Date().toISOString()
      })) : (Array.isArray(existing.episodes) ? existing.episodes : []);
      importedEpisodes += episodes.length;
      // Direct playback sources are accepted only when the feed and each source explicitly
      // mark the URLs as authorized for distribution.
      if (payload.authorizedForDistribution === true && Array.isArray(item.sources)) {
        for (const raw of item.sources.slice(0, 1000)) {
          if (!raw || raw.authorized !== true) continue;
          const source = cleanSource(Object.assign({}, raw, { provider: raw.provider || "authorized feed" }));
          const duplicate = sources.findIndex(x => x.url === source.url && x.name === source.name);
          if (duplicate >= 0) sources[duplicate] = Object.assign({}, sources[duplicate], source);
          else sources.push(source);
          importedSources++;
        }
      }
      records[id] = {
        mal_id: Number(id), title,
        poster: String(item.poster || item.image || existing.poster || "").slice(0, 1500),
        genres: Array.isArray(item.genres) ? item.genres.slice(0, 30).map(g => String(typeof g === "object" ? g.name || "" : g).slice(0, 60)).filter(Boolean) : (existing.genres || []),
        episodes, sources, provider: "authorized HiAnime-compatible feed",
        updatedAt: new Date().toISOString()
      };
      importedAnime++;
    }
    await saveRepositoryRecords(records);
    lastFeedSync = { at: new Date().toISOString(), ok: true, message: "Feed synced successfully.", importedAnime, importedEpisodes, importedSources };
    return lastFeedSync;
  } catch (error) {
    lastFeedSync = Object.assign({}, lastFeedSync, { at: new Date().toISOString(), ok: false, message: String(error.message || "Feed sync failed.").slice(0, 220) });
    throw error;
  } finally { feedSyncInProgress = false; }
}

app.get("/api/feed/status", (req, res) => {
  res.json({ configured: Boolean(HIANIME_FEED_URL), intervalMinutes: HIANIME_SYNC_MINUTES, lastSync: lastFeedSync });
});

app.post("/api/admin/sync-feed", requireAdmin, async (req, res, next) => {
  try { res.json({ ok: true, sync: await syncAuthorizedFeed() }); }
  catch (error) { error.statusCode = 400; next(error); }
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

app.post("/api/admin/import", requireAdmin, async (req, res, next) => {
  try {
    const input = req.body && req.body.anime;
    if (!Array.isArray(input) || input.length < 1) {
      throw badRequest("Provide an anime array containing at least one anime record.");
    }
    if (input.length > 500) throw badRequest("Import is limited to 500 anime records per batch.");
    const records = await getRepositoryRecords();
    let importedAnime = 0;
    let importedSources = 0;
    for (const item of input) {
      const id = cleanAnimeId(item && item.mal_id);
      const title = String(item && item.title || "").trim().slice(0, 180);
      if (!title) throw badRequest("Every anime record must have a title.");
      if (!Array.isArray(item.sources)) throw badRequest("Each anime record must include a sources array.");
      if (item.sources.length > 1000) throw badRequest("An anime record cannot contain more than 1,000 sources.");
      const existing = records[id] || { mal_id: Number(id), title: title, sources: [] };
      const sources = Array.isArray(existing.sources) ? existing.sources.slice() : [];
      for (const raw of item.sources) {
        const source = cleanSource(raw);
        const duplicate = sources.findIndex(x => x.url === source.url && x.name === source.name);
        if (duplicate >= 0) sources[duplicate] = Object.assign({}, sources[duplicate], source);
        else sources.push(source);
        importedSources++;
      }
      records[id] = { mal_id: Number(id), title: title, sources: sources, updatedAt: new Date().toISOString() };
      importedAnime++;
    }
    await saveRepositoryRecords(records);
    res.json({ ok: true, importedAnime, importedSources });
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
  if (HIANIME_FEED_URL) {
    syncAuthorizedFeed().catch(error => console.warn("Initial authorized feed sync failed:", error.message));
    setInterval(() => syncAuthorizedFeed().catch(error => console.warn("Scheduled authorized feed sync failed:", error.message)), HIANIME_SYNC_MINUTES * 60 * 1000).unref();
  } else console.warn("Automatic feed sync is disabled; set HIANIME_FEED_URL to an authorized JSON feed.");
});
