import { describe, expect, test } from "bun:test";

import { PROVIDER_ID, songToTrack } from "./api";

describe("songToTrack", () => {
  test("maps rich song and included album attributes", () => {
    const track = songToTrack({
      id: "song-1",
      type: "songs",
      attributes: {
        name: "Rich Song",
        artistName: "Lead Artist & Guest Artist",
        albumArtistName: "Album Artist",
        albumName: "Rich Album",
        artwork: { url: "https://example.com/{w}x{h}{c}.jpg" },
        contentRating: "explicit",
        durationInMillis: 245_500,
        genreNames: ["Alternative", "Indie"],
        releaseDate: "2024-03-15",
        trackNumber: 7,
        discNumber: 2,
        beatsPerMinute: 128.5,
        keySignature: "C# minor",
        playParams: { id: "song-1", kind: "song" },
      },
      relationships: {
        albums: {
          data: [
            {
              id: "album-1",
              type: "albums",
              attributes: {
                name: "Rich Album",
                artistName: "Album Artist",
                trackCount: 14,
                discCount: 2,
              },
            },
          ],
        },
        artists: {
          data: [
            { id: "artist-1", type: "artists", attributes: { name: "Lead Artist" } },
            { id: "artist-2", type: "artists", attributes: { name: "Guest Artist" } },
          ],
        },
      },
    });

    expect(track).toEqual({
      id: "song-1",
      provider: PROVIDER_ID,
      title: "Rich Song",
      artists: [
        { id: "artist-1", name: "Lead Artist" },
        { id: "artist-2", name: "Guest Artist" },
      ],
      album: { id: "album-1", name: "Rich Album" },
      duration: "4:06",
      durationSeconds: 246,
      thumbnailURL: "https://example.com/1200x1200bb.jpg",
      isExplicit: true,
      genres: ["Alternative", "Indie"],
      releaseYear: 2024,
      albumArtists: [{ id: null, name: "Album Artist" }],
      trackNumber: 7,
      trackTotal: 14,
      discNumber: 2,
      discTotal: 2,
      bpm: 128.5,
      musicalKey: "C# minor",
    });
  });

  test("uses album detail context for metadata missing from relationship tracks", () => {
    const track = songToTrack(
      {
        id: "song-2",
        type: "songs",
        attributes: {
          name: "Album Track",
          artistName: "Album Artist",
          durationInMillis: 180_000,
          trackNumber: 4,
          discNumber: 1,
        },
        relationships: {
          artists: {
            data: [{ id: "artist-3", type: "artists", attributes: { name: "Album Artist" } }],
          },
        },
      },
      {
        album: {
          id: "album-2",
          attributes: {
            name: "Context Album",
            artistName: "Album Artist",
            genreNames: ["Jazz"],
            releaseDate: "1977-01-01",
            trackCount: 8,
          },
        },
      },
    );

    expect(track).toMatchObject({
      album: { id: "album-2", name: "Context Album" },
      genres: ["Jazz"],
      releaseYear: 1977,
      albumArtists: [{ id: "artist-3", name: "Album Artist" }],
      trackNumber: 4,
      trackTotal: 8,
      discNumber: 1,
    });
    expect(track.discTotal).toBeUndefined();
    expect(track.bpm).toBeUndefined();
    expect(track.musicalKey).toBeUndefined();
  });

  test("keeps library identity and omits unavailable optional metadata", () => {
    const track = songToTrack({
      id: "library-song-1",
      type: "library-songs",
      attributes: {
        name: "Library Song",
        artistName: "Library Artist",
        albumName: "Library Album",
        playParams: { catalogId: "catalog-song-1", purchasedId: "album-3" },
      },
      relationships: {
        artists: {
          data: [{ id: "artist-4", type: "artists" }],
        },
      },
    });

    expect(track.id).toBe("catalog-song-1");
    expect(track.artists).toEqual([{ id: "artist-4", name: "Library Artist" }]);
    expect(track.album).toEqual({ id: "album-3", name: "Library Album" });
    expect(track).not.toHaveProperty("genres");
    expect(track).not.toHaveProperty("releaseYear");
    expect(track).not.toHaveProperty("albumArtists");
    expect(track).not.toHaveProperty("trackNumber");
    expect(track).not.toHaveProperty("trackTotal");
    expect(track).not.toHaveProperty("discNumber");
    expect(track).not.toHaveProperty("discTotal");
    expect(track).not.toHaveProperty("bpm");
    expect(track).not.toHaveProperty("musicalKey");
  });
});
