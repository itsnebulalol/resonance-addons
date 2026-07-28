import { afterEach, expect, test } from "bun:test";
import { continueDJQueue, resolveDJStartRequest, switchDJQueue } from "./dj";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("DJ start requests are single-flight", async () => {
  let starts = 0;
  let resolveStart: ((value: any) => void) | undefined;
  const start = () => {
    starts += 1;
    return new Promise<any>((resolve) => {
      resolveStart = resolve;
    });
  };

  const first = resolveDJStartRequest("account", start);
  const second = resolveDJStartRequest("account", start);
  expect(first).toBe(second);
  expect(starts).toBe(1);

  resolveStart?.({
    tracks: [{ id: "track", title: "Track", artists: [] }],
  });
  await first;
});

test("Mix it up returns a narrated, freshness-safe action", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        tracks: [
          {
            id: "fresh-track",
            title: "Fresh Track",
            artists: [{ id: "artist", name: "Artist" }],
            durationSeconds: 180,
          },
          {
            id: "fresh-track-2",
            title: "Fresh Track 2",
            artists: [{ id: "artist", name: "Artist" }],
            durationSeconds: 190,
          },
        ],
        narrationText: "<speak>Here is something fresh.</speak>",
        narrationTitle: "Up next",
        narrationArtist: "DJ X",
        narrationArtworkUrl: "https://example.com/dj.png",
        outroNarration: {
          text: "<speak>That was something fresh.</speak>",
          title: "Up next",
          artist: "DJ X",
          artworkUrl: "https://example.com/dj.png",
        },
        continuationToken: "continue",
        switchToken: "switch",
        canSwitch: true,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as unknown as typeof fetch;

  const page = await switchDJQueue("sp-dc", "https://spotify.example.com", "server-token", "old-switch");
  expect(page.tracks.map((track) => track.id)).toEqual(["fresh-track", "fresh-track-2"]);
  expect(page.djScript?.slots[0]?.text).toBe("Here is something fresh.");
  expect(page.djScript?.slots[0]?.presentation).toEqual({
    title: "Up next",
    artist: "DJ X",
    artworkURL: "https://example.com/dj.png",
  });
  expect(page.djScript?.slots[1]).toMatchObject({
    trackId: "fresh-track-2",
    text: "That was something fresh.",
    position: "afterTrack",
  });
  expect(page.actions).toHaveLength(1);
  expect(page.actions[0]).toMatchObject({
    title: "Mix it up",
    allowsPrefetch: false,
    isMomentary: true,
    shouldAdvancePlayback: true,
    isStationRetrigger: true,
  });
});

test("DJ continuation schedules entry and outro narration", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        tracks: [
          {
            id: "continued-track",
            title: "Continued Track",
            artists: [{ id: "artist", name: "Artist" }],
            durationSeconds: 180,
          },
          {
            id: "continued-track-2",
            title: "Continued Track 2",
            artists: [{ id: "artist", name: "Artist" }],
            durationSeconds: 200,
          },
        ],
        narrationText: "<speak>Coming next, something different.</speak>",
        outroNarration: {
          text: "<speak>That was the end of this set.</speak>",
        },
        continuationToken: "continue-next",
        switchToken: "switch-next",
        canSwitch: true,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as unknown as typeof fetch;

  const page = await continueDJQueue("sp-dc", "https://spotify.example.com", "server-token", "continue");
  expect(page.djScript?.slots).toEqual([
    {
      trackId: "continued-track",
      text: "Coming next, something different.",
      audio: null,
      presentation: {
        title: "Up next",
        artist: "DJ X",
        artworkURL: "https://lexicon-assets.spotifycdn.com/Your-DJ-Cover-Art-300.png",
      },
      position: "beforeTrack",
    },
    {
      trackId: "continued-track-2",
      text: "That was the end of this set.",
      audio: null,
      presentation: {
        title: "Up next",
        artist: "DJ X",
        artworkURL: "https://lexicon-assets.spotifycdn.com/Your-DJ-Cover-Art-300.png",
      },
      position: "afterTrack",
    },
  ]);
});

test("DJ exhaustion clears continuation without inventing tracks", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        tracks: [],
        continuationToken: null,
        switchToken: null,
        canSwitch: false,
        exhausted: true,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as unknown as typeof fetch;

  const page = await continueDJQueue("sp-dc", "https://spotify.example.com", "server-token", "continue");
  expect(page.tracks).toEqual([]);
  expect(page.continuation).toBeNull();
  expect(page.actions).toEqual([]);
  expect(page.djScript).toBeNull();
});

test("Mix it up tells the server which section is currently playing", async () => {
  let receivedBody: Record<string, string> | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    receivedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        tracks: [
          {
            id: "next-track",
            title: "Next Track",
            artists: [{ id: "artist", name: "Artist" }],
          },
        ],
        narrationText: "<speak>Switching it up.</speak>",
        continuationToken: "continue",
        switchToken: "switch",
        canSwitch: true,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;

  await switchDJQueue("sp-dc", "https://spotify.example.com", "server-token", "switch", "playing-track");

  expect(receivedBody).toEqual({
    token: "switch",
    currentTrackId: "playing-track",
  });
});

test("DJ pages reject silent radio fallbacks", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        tracks: [
          {
            id: "silent-track",
            title: "Silent Track",
            artists: [{ id: "artist", name: "Artist" }],
          },
        ],
        narrationText: null,
        continuationToken: "continue",
        switchToken: "switch",
        canSwitch: true,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as unknown as typeof fetch;

  await expect(switchDJQueue("sp-dc", "https://spotify.example.com", "server-token", "switch")).rejects.toThrow(
    "without narration",
  );
});
