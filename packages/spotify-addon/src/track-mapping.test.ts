import { describe, expect, test } from "bun:test";
import {
  discTotalFromAlbum,
  enrichTrackFromSpotifyData,
  musicalKeyFromSpotifyAudioFeatures,
  transformGraphQLAlbumTrack,
  transformGraphQLTrack,
  transformGraphQLTrackItem,
} from "./track-mapping";
import type { Track } from "./types";

const graphQLTrack = {
  uri: "spotify:track:track-1",
  name: "Track One",
  artists: {
    items: [
      {
        uri: "spotify:artist:track-artist",
        profile: { name: "Track Artist", genres: ["Dance Pop"] },
      },
    ],
  },
  albumOfTrack: {
    uri: "spotify:album:album-1",
    name: "Album One",
    date: { isoString: "2024-06-14" },
    genres: { items: [{ name: "Electronic" }] },
    artists: {
      items: [
        {
          uri: "spotify:artist:album-artist",
          profile: { name: "Album Artist", genres: ["dance pop", "House"] },
        },
      ],
    },
    coverArt: { sources: [{ url: "https://example.com/cover.jpg", height: 640 }] },
    tracksV2: { totalCount: 12 },
  },
  trackDuration: { totalMilliseconds: 245_000 },
  contentRating: { label: "EXPLICIT" },
  trackNumber: 3,
  discNumber: 1,
  audioFeatures: { tempo: 124.5, key: 9, mode: 0 },
};

describe("Spotify Track mapping", () => {
  test("maps enriched GraphQL metadata into the Resonance Track contract", () => {
    expect(transformGraphQLTrack(graphQLTrack)).toEqual({
      id: "track-1",
      provider: "net.itsnebula.spotify",
      title: "Track One",
      artists: [{ id: "track-artist", name: "Track Artist" }],
      album: { id: "album-1", name: "Album One" },
      duration: "4:05",
      durationSeconds: 245,
      thumbnailURL: "https://example.com/cover.jpg",
      isExplicit: true,
      genres: ["Electronic", "Dance Pop", "House"],
      releaseYear: 2024,
      albumArtists: [{ id: "album-artist", name: "Album Artist" }],
      trackNumber: 3,
      trackTotal: 12,
      discNumber: 1,
      bpm: 124.5,
      musicalKey: "8A",
    });
  });

  test("normalizes queue, library, playlist, and direct GraphQL wrappers identically", () => {
    const withoutUri = { ...graphQLTrack, uri: undefined };
    const variants = [
      graphQLTrack,
      { data: graphQLTrack },
      { itemV2: { data: graphQLTrack } },
      { track: { data: withoutUri, _uri: graphQLTrack.uri } },
    ];
    const mapped = variants.map((variant) => transformGraphQLTrackItem(variant));

    expect(mapped.every((track) => track != null)).toBe(true);
    const expected = mapped[0]!;
    for (const track of mapped.slice(1)) {
      expect(track).toEqual(expected);
    }
  });

  test("uses album context for album artists, release, totals, and disc count", () => {
    const albumData = {
      uri: "spotify:album:album-2",
      name: "Double Album",
      date: { isoString: "1999" },
      artists: { items: [{ uri: "spotify:artist:artist-2", profile: { name: "Album Artist" } }] },
      tracksV2: {
        totalCount: 2,
        items: [
          { track: { uri: "spotify:track:a", discNumber: 1 } },
          { track: { uri: "spotify:track:b", discNumber: 2 } },
        ],
      },
    };
    const mapped = transformGraphQLAlbumTrack(
      {
        trackNumber: 1,
        track: {
          uri: "spotify:track:a",
          name: "Album Track",
          artists: { items: [{ uri: "spotify:artist:artist-2", profile: { name: "Album Artist" } }] },
          discNumber: 1,
        },
      },
      albumData,
      "album-2",
    );

    expect(mapped).toMatchObject({
      album: { id: "album-2", name: "Double Album" },
      releaseYear: 1999,
      albumArtists: [{ id: "artist-2", name: "Album Artist" }],
      trackNumber: 1,
      trackTotal: 2,
      discNumber: 1,
      discTotal: 2,
    });
  });

  test("merges Web API, artist genre, album, and audio-feature metadata without changing identity", () => {
    const base: Track = {
      id: "track-3",
      provider: "net.itsnebula.spotify",
      title: "Stable Title",
      artists: [{ id: "performer", name: "Performer" }],
      album: { id: "album-3", name: "Album Three" },
      duration: "3:00",
      durationSeconds: 180,
      thumbnailURL: null,
      isExplicit: false,
      genres: ["Existing Genre"],
    };
    const trackData = {
      id: "track-3",
      track_number: 7,
      disc_number: 2,
      artists: [{ id: "performer", name: "Performer" }],
      album: {
        id: "album-3",
        release_date: "2016-11",
        total_tracks: 20,
        artists: [{ id: "album-artist", name: "Album Artist" }],
      },
    };
    const albumData = {
      id: "album-3",
      total_tracks: 20,
      tracks: {
        total: 20,
        items: Array.from({ length: 20 }, (_, index) => ({
          id: `album-track-${index + 1}`,
          disc_number: index < 10 ? 1 : 2,
        })),
      },
    };
    const artistsById = new Map([
      ["album-artist", { id: "album-artist", genres: ["Synthpop", "Existing Genre"] }],
      ["performer", { id: "performer", genres: ["Electropop"] }],
    ]);

    expect(
      enrichTrackFromSpotifyData(base, trackData, {
        albumData,
        artistsById,
        audioFeatures: { id: "track-3", tempo: 128.25, key: 1, mode: 1 },
      }),
    ).toMatchObject({
      id: "track-3",
      title: "Stable Title",
      genres: ["Existing Genre", "Synthpop", "Electropop"],
      releaseYear: 2016,
      albumArtists: [{ id: "album-artist", name: "Album Artist" }],
      trackNumber: 7,
      trackTotal: 20,
      discNumber: 2,
      discTotal: 2,
      bpm: 128.25,
      musicalKey: "3B",
    });
  });

  test("only infers disc totals from complete album track lists", () => {
    expect(
      discTotalFromAlbum({
        total_tracks: 3,
        tracks: { total: 3, items: [{ disc_number: 1 }, { disc_number: 2 }] },
      }),
    ).toBeUndefined();
    expect(discTotalFromAlbum({ discCount: 4 })).toBe(4);
  });
});

describe("Spotify audio feature keys", () => {
  test("converts Spotify pitch class and mode to Camelot notation", () => {
    expect(musicalKeyFromSpotifyAudioFeatures({ key: 9, mode: 0 })).toBe("8A");
    expect(musicalKeyFromSpotifyAudioFeatures({ key: 0, mode: 1 })).toBe("8B");
  });

  test("omits undetected or malformed keys", () => {
    expect(musicalKeyFromSpotifyAudioFeatures({ key: -1, mode: 1 })).toBeUndefined();
    expect(musicalKeyFromSpotifyAudioFeatures({ key: 5, mode: 2 })).toBeUndefined();
  });
});
