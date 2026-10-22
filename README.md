# AniVerse

Responsive anime discovery frontend with a dark theme, searchable anime catalogue, genre filters, title details, and an external-source player UI.

## Features
- Anime catalogue and search powered by the public Jikan API (MyAnimeList data).
- Trending, popular, currently airing, movie, and genre filters.
- Anime details with synopsis, score, genres, and official watch-search link.
- External video-source UI for URLs you are authorized to use.
- Responsive mobile and desktop layout.
- Render static-site configuration in `render.yaml`.

## Deploy on Render
1. Open https://dashboard.render.com/
2. Choose **New + → Static Site**.
3. Connect `stark12300-hue/Anime-stream`.
4. If configuring manually, use:
   - Build command: `echo "Static site ready"`
   - Publish directory: `.`
5. Deploy.

## Notes
- Catalogue information loads from Jikan at runtime; network availability and API rate limits may affect loading.
- Sources added in this prototype are saved in the current browser's local storage only. They are not shared across users or devices. For a production admin panel, add an authenticated backend and persistent database.
- Ad spaces are placeholders. Add approved ad-network code after approval and ensure the site complies with the provider's policies.
- Use only video URLs and embeds you are authorized to distribute. This project does not scrape third-party streaming sites.
