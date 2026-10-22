# AniVerse

Responsive anime discovery and watch UI with a dark theme, catalogue search, genre filters, anime details, episode/source management, watch history, and a personal watchlist.

## Features
- Anime discovery/search with Tenrai API and Jikan API fallback.
- Trending, popular, currently airing, movies, and genre filters.
- Anime details, synopsis, score, genres, and official watch-search links.
- Video player supports direct MP4/WebM files, HLS streams (.m3u8) where the browser can play them, and supported provider embeds.
- YouTube watch/short links are converted to embed URLs; Vimeo links are converted to the player URL.
- Add an episode/source label, audio/subtitle note, URL, and player type.
- Continue Watching saves playback progress for direct video playback and provides Resume.
- My List / favourites and history are stored in the browser's local storage.
- Responsive mobile and desktop layout.
- Render static-site configuration in render.yaml.

## Deploy on Render
1. Open https://dashboard.render.com/
2. Choose New + → Static Site.
3. Connect stark12300-hue/Anime-stream.
4. If configuring manually, use:
   - Build command: echo "Static site ready"
   - Publish directory: .
5. Deploy the latest commit.

## Important limitations
- This repository currently deploys as a static frontend. Episodes and sources added through the details dialog are stored in the current browser only; they are not shared with other visitors/devices.
- There is no shared admin dashboard, user login, remote database, or synchronized episode catalogue yet. Those features require a backend service and persistent database.
- Embed providers can block iframe playback. HLS availability depends on the stream's CORS configuration and the browser. Only authorized and compatible stream URLs can play.
- Catalogue services are third-party APIs. Network availability, CORS behavior, rate limits, or API changes may affect loading.
- Ad spaces are placeholders. Add an approved ad-network tag only after the provider has approved the site and follow its policies.
- This project does not scrape third-party streaming sites or bypass access controls. Use video URLs and embeds you are authorized to stream.
