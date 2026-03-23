import {
  handleOnDeviceFetchReplayUpload,
  isOnDeviceFetchRequiredError,
  recoverOnDeviceFetchResponse,
  responseForOnDeviceFetchMarker,
  responseForOnDeviceFetchRequired,
  runWithOnDeviceFetchContext,
} from "./on-device-fetch";
import { corsHeaders, errorResponse, json, parseConfig } from "./response";
import type { AddonOptions } from "./types";

function getBaseURL(req: Request, port: number): string {
  const host = req.headers.get("host") ?? `localhost:${port}`;
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export function createAddon<T>(options: AddonOptions<T>) {
  const configureHtml = options.configurePage ? Bun.file(options.configurePage).text() : null;

  function generateManifest(baseURL: string, configStr: string | null): Response {
    const resources: any[] = [];

    if (options.stream) {
      resources.push({ type: "stream", idPrefixes: options.stream.idPrefixes });
    }

    const catalogs: any[] = [];
    if (options.catalog) {
      for (const [id, def] of Object.entries(options.catalog)) {
        if (def.manifest === false) continue;
        const entry: any = { id, name: def.name };
        if (def.isDefault) entry.isDefault = true;
        catalogs.push(entry);
      }
    }
    if (options.search) {
      catalogs.push({ id: "search", name: "Search", extra: [{ name: "search", isRequired: true }] });
    }
    if (catalogs.length) {
      resources.push({ type: "catalog", catalogs });
    }

    if (options.lyrics) {
      resources.push({ type: "lyrics", syncTypes: options.lyrics.syncTypes });
    }

    if (options.tts) {
      resources.push({ type: "tts" });
    }

    if (options.metadata) {
      resources.push({ type: "metadata" });
    }

    const capabilities = {
      supportsRadio: !!options.queue,
      supportsQueueActions: !!options.queue?.action,
      supportsContinuation: !!(options.catalog || options.playlist?.more),
      supportsSearchSuggestions: !!options.search?.suggestions,
      supportsLikeStatus: !!options.mutations?.like,
      supportsAddToPlaylist: !!options.mutations?.addToPlaylist,
      supportsFilters: false,
      supportsQuickAccess: false,
      supportsRelated: !!options.related,
      ...options.capabilities,
    };

    const manifest: Record<string, any> = {
      id: options.id,
      name: options.name,
      description: options.description,
      version: options.version,
      icon: options.icon,
      transport: { remote: configStr ? `${baseURL}/${configStr}` : baseURL },
      resources,
      auth: { type: options.auth.type ?? "token", label: options.auth.label, fields: options.auth.fields },
      behaviorHints: { configurable: true, configurationRequired: true },
      capabilities,
    };

    if (options.onDeviceFetchHosts?.length) {
      manifest.onDeviceFetchHosts = options.onDeviceFetchHosts;
    }

    return json(manifest);
  }

  async function handleRoute(config: T, route: string, req: Request, url: URL): Promise<Response> {
    if (req.method === "GET") {
      const catalogMatch = route.match(/^\/catalog\/(\w+)\.json$/);
      if (catalogMatch?.[1] && options.catalog?.[catalogMatch[1]]) {
        return options.catalog[catalogMatch[1]]!.handler(config, {
          continuation: url.searchParams.get("continuation") ?? undefined,
          type: url.searchParams.get("type") ?? undefined,
        });
      }

      if (route === "/search.json" && options.search) {
        const q = url.searchParams.get("q");
        if (!q) return errorResponse("Missing query parameter 'q'", 400);
        const filter = url.searchParams.get("filter") ?? undefined;
        return options.search.handler(config, q, filter, url);
      }

      if (route === "/search/suggestions.json" && options.search?.suggestions) {
        const q = url.searchParams.get("q");
        if (!q) return json([]);
        return options.search.suggestions(config, q);
      }

      const streamMatch = route.match(/^\/stream\/([^/]+)\.json$/);
      if (streamMatch?.[1] && options.stream) {
        return options.stream.handler(config, streamMatch[1]);
      }

      const albumMatch = route.match(/^\/album\/([^/]+)\.json$/);
      if (albumMatch?.[1] && options.album) {
        return options.album(config, albumMatch[1]);
      }

      const artistMatch = route.match(/^\/artist\/([^/]+)\.json$/);
      if (artistMatch?.[1] && options.artist) {
        return options.artist(config, artistMatch[1]);
      }

      const playlistMoreMatch = route.match(/^\/playlist\/([^/]+)\/more\.json$/);
      if (playlistMoreMatch?.[1] && options.playlist?.more) {
        const cont = url.searchParams.get("continuation");
        if (!cont) return errorResponse("Missing continuation parameter", 400);
        return options.playlist.more(config, decodeURIComponent(playlistMoreMatch[1]), cont);
      }

      const playlistMatch = route.match(/^\/playlist\/([^/]+)\.json$/);
      if (playlistMatch?.[1]) {
        const id = playlistMatch[1];
        if (options.playlist?.custom?.[id]) {
          return options.playlist.custom[id]!(config);
        }
        if (options.playlist?.handler) {
          return options.playlist.handler(config, id);
        }
      }

      const relatedForTrackMatch = route.match(/^\/related-for-track\/([^/]+)\.json$/);
      if (relatedForTrackMatch?.[1] && options.related?.forTrack) {
        return options.related.forTrack(config, decodeURIComponent(relatedForTrackMatch[1]));
      }

      const relatedMatch = route.match(/^\/related\/([^/]+)\.json$/);
      if (relatedMatch?.[1] && options.related) {
        return options.related.handler(config, decodeURIComponent(relatedMatch[1]));
      }

      const queueStartMatch = route.match(/^\/queue\/start\/([^/]+)\.json$/);
      if (queueStartMatch?.[1] && options.queue) {
        const context = url.searchParams.get("context") ?? undefined;
        return options.queue.start(config, queueStartMatch[1], context);
      }

      if (route === "/queue/more.json" && options.queue) {
        const token = url.searchParams.get("token");
        if (!token) return errorResponse("Missing token parameter", 400);
        return options.queue.more(config, token);
      }

      if (route === "/lyrics.json" && options.lyrics) {
        return options.lyrics.handler(config, {
          videoId: url.searchParams.get("videoId") ?? undefined,
          title: url.searchParams.get("title") ?? undefined,
          artist: url.searchParams.get("artist") ?? undefined,
        });
      }

      if (route === "/metadata.json" && options.metadata) {
        return options.metadata.handler(config, {
          title: url.searchParams.get("title") ?? undefined,
          artist: url.searchParams.get("artist") ?? undefined,
        });
      }

      if (route === "/tts/voices.json" && options.tts) {
        return json(options.tts.voices);
      }
    }

    if (req.method === "POST") {
      if (route === "/_resonance/on-device-fetch-response") {
        return handleOnDeviceFetchReplayUpload(req);
      }

      if (route === "/queue/action" && options.queue) {
        const body = await req.json();
        return options.queue.action(config, body);
      }

      if (route === "/like" && options.mutations?.like) {
        const body = await req.json();
        return options.mutations.like(config, body);
      }

      if (route === "/playlist/add" && options.mutations?.addToPlaylist) {
        const body = await req.json();
        return options.mutations.addToPlaylist(config, body);
      }

      if (route === "/tts" && options.tts) {
        return options.tts.handler(config, req);
      }
    }

    return errorResponse("Not found", 404);
  }

  return {
    listen(port: number) {
      Bun.serve({
        port,
        idleTimeout: 120,
        async fetch(req) {
          const url = new URL(req.url);
          const path = url.pathname;

          if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders() });
          }

          if (path === "/" || path === "/configure") {
            if (configureHtml) {
              const html = await configureHtml;
              const baseURL = getBaseURL(req, port);
              return new Response(html.replaceAll("{{BASE_URL}}", baseURL), {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            }
            return errorResponse("Configure page not available", 404);
          }

          if (path === "/health") {
            return json({ status: "ok" });
          }

          const baseURL = getBaseURL(req, port);

          if (req.method === "GET" && path === "/manifest.json") {
            return generateManifest(baseURL, null);
          }

          const match = path.match(/^\/([^/]+)(\/.*)?$/);
          if (!match) {
            return errorResponse("Not found", 404);
          }

          const configStr = match[1]!;
          const route = match[2] ?? "/";

          let config: T;
          try {
            const raw = parseConfig<Record<string, any>>(configStr);
            config = options.parseConfig(raw);
          } catch {
            return errorResponse("Invalid config in URL — configure at /configure", 400);
          }

          if (options.onConfig) {
            options.onConfig(config);
          }

          if (route === "/manifest.json") {
            return generateManifest(baseURL, configStr);
          }

          if (route !== "/") {
            console.log(`[${options.id}] ${req.method} ${route}`);
          }

          const handler = () => handleRoute(config, route, req, url);

          try {
            const response = await runWithOnDeviceFetchContext(req, async () => {
              if (options.wrapRequest) {
                return await options.wrapRequest(config, handler);
              }
              return await handler();
            });
            return await recoverOnDeviceFetchResponse(response);
          } catch (e: any) {
            if (isOnDeviceFetchRequiredError(e)) {
              return responseForOnDeviceFetchRequired(e);
            }
            const markerResponse = responseForOnDeviceFetchMarker(e?.message);
            if (markerResponse) {
              return markerResponse;
            }
            console.error(`[${options.id}] Unhandled error:`, e.message);
            return errorResponse(e.message, 500);
          }
        },
      });

      console.log(`${options.name} addon running on http://localhost:${port}`);
      console.log(`Configure at http://localhost:${port}/configure`);

      if (options.onStart) {
        Promise.resolve(options.onStart()).catch(() => {});
      }
    },
  };
}
