# AniVerse

A responsive anime discovery and watch site with searchable catalogue, genre filters, video playback, watch history, personal favourites, and a GitHub-synced episode-source admin panel.

## Features
- Anime discovery/search with Tenrai and Jikan API fallback.
- Trending, popular, currently airing, movies, and genre filters.
- Anime details, synopsis, score, genres, and official watch-search links.
- Toonstream-style watch modal with episode cards, audio/subtitle language filtering, previous/next episode controls, and a focused player header.
- Player support for direct MP4/WebM files, HLS streams (.m3u8) where browser/CORS support permits, and provider embeds.
- YouTube watch/short links are converted to embed URLs; Vimeo links are converted to player URLs.
- “Continue watching” progress and “My List” are stored in the visitor's browser.
- Shared episode sources are stored in data/sources.json and can be managed through the authenticated /admin panel. Successful edits are committed to this GitHub repository.
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
