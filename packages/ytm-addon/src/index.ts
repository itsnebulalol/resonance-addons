import { runWithRegion } from "./auth";
import { handleConfigure } from "./configure";
import { handleAlbum } from "./routes/album";
import { handleArtist } from "./routes/artist";
import { handleHome } from "./routes/catalog";
import { handleLibrary } from "./routes/library";
import { handleLyrics } from "./routes/lyrics";
import { handleManifest } from "./routes/manifest";
import { handleAddToPlaylist, handleLike } from "./routes/mutations";
import { handlePlaylist, handlePlaylistMore } from "./routes/playlist";
import { handleQueueAction, handleQueueMore, handleQueueStart } from "./routes/queue";
import { handleRelated, handleRelatedForTrack } from "./routes/related";
import { handleSearch, handleSearchSuggestions } from "./routes/search";
import { handleStream } from "./routes/stream";
import { corsHeaders, errorResponse, json, parseConfig } from "./utils";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

function getBaseURL(req: Request): string {
  const host = req.headers.get("host") ?? `localhost:${PORT}`;
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (path === "/" || path === "/configure") {
      return handleConfigure(getBaseURL(req));
    }

    if (path === "/health") {
      return json({ status: "ok" });
    }

    if (req.method === "GET" && path === "/manifest.json") {
      return handleManifest(getBaseURL(req), null);
    }

    const match = path.match(/^\/([^/]+)(\/.*)?$/);
    if (match?.[2]) {
      console.log(`[router] ${req.method} ${match[2]}`);
    }
    if (!match) {
      return errorResponse("Not found", 404);
    }

    const configStr = match[1]!;
    const route = match[2] ?? "/";

    let config;
    try {
      config = parseConfig(configStr);
    } catch {
      return errorResponse("Invalid config in URL — configure at /configure", 400);
    }

    const baseURL = getBaseURL(req);
    const rt = config.refreshToken;
    const gl = config.region ?? "US";
    const hl = config.language ?? "en";

    if (req.method === "GET" && route === "/manifest.json") {
      return handleManifest(baseURL, configStr);
    }

    return runWithRegion(gl, hl, async () => {
      // GET routes
      if (req.method === "GET") {
        if (route === "/catalog/home.json") {
          const cont = url.searchParams.get("continuation") ?? undefined;
          return handleHome(rt, cont);
        }

        if (route === "/catalog/library.json") {
          const type = url.searchParams.get("type") ?? undefined;
          const continuation = url.searchParams.get("continuation") ?? undefined;
          return handleLibrary(rt, type, continuation);
        }

        if (route === "/search.json") {
          const q = url.searchParams.get("q");
          if (!q) return errorResponse("Missing query parameter 'q'", 400);
          const filter = url.searchParams.get("filter") ?? undefined;
          return handleSearch(rt, q, filter);
        }

        if (route === "/search/suggestions.json") {
          const q = url.searchParams.get("q");
          if (!q) return json([]);
          return handleSearchSuggestions(rt, q);
        }

        const streamMatch = route.match(/^\/stream\/([^/]+)\.json$/);
        if (streamMatch?.[1]) {
          return handleStream(rt, streamMatch[1]);
        }

        const albumMatch = route.match(/^\/album\/([^/]+)\.json$/);
        if (albumMatch?.[1]) {
          return handleAlbum(rt, albumMatch[1]);
        }

        const artistMatch = route.match(/^\/artist\/([^/]+)\.json$/);
        if (artistMatch?.[1]) {
          return handleArtist(rt, artistMatch[1]);
        }

        const playlistMoreMatch = route.match(/^\/playlist\/([^/]+)\/more\.json$/);
        if (playlistMoreMatch?.[1]) {
          const continuation = url.searchParams.get("continuation");
          if (!continuation) return errorResponse("Missing continuation parameter", 400);
          return handlePlaylistMore(rt, decodeURIComponent(playlistMoreMatch[1]), continuation);
        }

        const playlistMatch = route.match(/^\/playlist\/([^/]+)\.json$/);
        if (playlistMatch?.[1]) {
          return handlePlaylist(rt, playlistMatch[1]);
        }

        const relatedForTrackMatch = route.match(/^\/related-for-track\/([^/]+)\.json$/);
        if (relatedForTrackMatch?.[1]) {
          return handleRelatedForTrack(rt, decodeURIComponent(relatedForTrackMatch[1]));
        }

        const relatedMatch = route.match(/^\/related\/([^/]+)\.json$/);
        if (relatedMatch?.[1]) {
          return handleRelated(rt, decodeURIComponent(relatedMatch[1]));
        }

        const queueStartMatch = route.match(/^\/queue\/start\/([^/]+)\.json$/);
        if (queueStartMatch?.[1]) {
          const context = url.searchParams.get("context") ?? undefined;
          return handleQueueStart(rt, queueStartMatch[1], context);
        }

        if (route === "/queue/more.json") {
          const token = url.searchParams.get("token");
          if (!token) return errorResponse("Missing token parameter", 400);
          return handleQueueMore(rt, token);
        }

        if (route === "/lyrics.json") {
          const videoId = url.searchParams.get("videoId") ?? undefined;
          const title = url.searchParams.get("title") ?? undefined;
          const artist = url.searchParams.get("artist") ?? undefined;
          return handleLyrics(rt, videoId, title, artist);
        }
      }

      // POST routes
      if (req.method === "POST") {
        if (route === "/queue/action") {
          const body = (await req.json()) as any;
          return handleQueueAction(rt, body);
        }

        if (route === "/like") {
          const body = (await req.json()) as any;
          return handleLike(rt, body);
        }

        if (route === "/playlist/add") {
          const body = (await req.json()) as any;
          return handleAddToPlaylist(rt, body);
        }
      }

      return errorResponse("Not found", 404);
    });
  },
});

console.log(`YTM addon server running on http://localhost:${PORT}`);
console.log(`Configure at http://localhost:${PORT}/configure`);
