# AniVerse

A responsive anime discovery and watch site with searchable catalogue, genre filters, video playback, watch history, personal favourites, and a GitHub-synced episode-source admin panel.

## Features
- Anime discovery/search with Tenrai and Jikan API fallback.
- ToonStream-inspired portal layout with a centered search, anime/movie navigation, random-series sidebar, and a latest-episodes shelf populated from the shared AniVerse source API.
- Latest-episode language filters automatically adapt to the languages assigned to imported sources. The homepage does not scrape or copy ToonStream videos; add only sources you are authorized to distribute.
- Trending, popular, currently airing, movies, and genre filters.
- Anime details, synopsis, score, genres, and official watch-search links.
- Watch modal with admin/device-added playable-source cards, audio/subtitle language filtering, and previous/next controls.
- On-demand episode guide from Jikan for the selected anime, with paginated episode details and official-watch search links.
- On-demand links to legal external streaming episodes when AniList lists them for the selected title; these links open the provider site and are not direct video files.
- Player support for direct MP4/WebM files, HLS streams (.m3u8) where browser/CORS support permits, and provider embeds.
- YouTube watch/short links are converted to embed URLs; Vimeo links are converted to player URLs.
- “Continue watching” progress and “My List” are stored in the visitor's browser.
- Shared episode sources are stored in data/sources.json and can be managed through the authenticated /admin panel. Individual edits and authenticated bulk JSON imports are committed to this GitHub repository.
- Bulk import accepts an `{"anime":[{"mal_id":"5114","title":"Example","sources":[{"name":"Episode 1","language":"Hindi Dub","url":"https://authorized.example/episode-1.mp4","type":"video"}]}]}` payload in `/admin`; use only authorized API/feed exports or URLs you may distribute.
- Authorized HiAnime-compatible feed adapter: the `/admin` panel has a **Sync feed now** control. Set `HIANIME_FEED_URL` to a JSON API/feed you are authorized to access; optional `HIANIME_FEED_TOKEN` sends a Bearer token. `HIANIME_SYNC_MINUTES` sets automatic sync cadence (minimum 15 minutes; default 60). It performs an initial sync on startup and then repeats automatically.
- Feed JSON schema: `{"authorizedForDistribution":true,"anime":[{"mal_id":"5114","title":"Example","poster":"https://…","genres":["Action"],"episodes":[{"number":"1","title":"Episode title","language":"Hindi Dub"}],"sources":[{"name":"Episode 1","episodeNumber":"1","episodeTitle":"Episode title","language":"Hindi Dub","url":"https://authorized.example/episode-1.mp4","type":"video","authorized":true}]}]}`. The feed-level `authorizedForDistribution:true` and each source's `authorized:true` are required before playback URLs are imported. Metadata and episode lists can sync without video sources. This adapter consumes JSON only; it does not scrape HiAnime webpages or bypass access controls.
- Render Node web-service configuration is included in render.yaml.

## Deploy on Render
This version needs a **Web Service**, not a Static Site, because it uses a Node/Express API for shared sources and admin login.

1. Open https://dashboard.render.com/ and create a new **Web Service** connected to stark12300-hue/Anime-stream.
2. Use build command `npm install --omit=dev` and start command `node server.js` (the included render.yaml uses these settings for a Blueprint deployment).
3. Add these environment variables in Render:
   - `GITHUB_REPOSITORY` = `stark12300-hue/Anime-stream`
   - `GITHUB_BRANCH` = `main`
   - `GITHUB_TOKEN` = a GitHub fine-grained token with **Contents: Read and write** for this repository only
   - `ADMIN_PASSWORD` = a strong, unique admin password
   - `SESSION_SECRET` = a long random secret (the Blueprint config generates one automatically; set one manually if configuring by hand)
   - `NODE_ENV` = `production`
4. Deploy the Web Service. Open `/api/health` on the new Render URL to check that admin and GitHub sync configuration show as enabled. Open `/admin` to manage shared episode sources.
5. Use the new Web Service URL for the website. An older Static Site deployment will not run the API/admin backend.

## Important limitations
- The shared source list stores only source metadata/URLs; it does not host video files. A source must be valid, playable, and authorized for distribution. External providers can block iframe playback, and HLS can fail if the provider does not allow cross-origin playback.
- Watch history and My List are device/browser-local; no visitor accounts or cross-device sync are implemented.
- Admin-managed shared sources are committed to the public repository's data/sources.json file. Do not add private credentials or secret URLs there. Keep GITHUB_TOKEN in Render environment variables only; never put it in browser code or commit it.
- Catalogue information comes from third-party APIs. Rate limits, network failures, CORS, or API changes may affect loading.
- Ad spaces are placeholders. Add an approved ad-network tag only after the provider approves the site and follow its policies.
- This project does not scrape third-party streaming sites or bypass access controls. Only use video URLs and embeds you are authorized to stream.
