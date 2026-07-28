import { describe, expect, test } from "bun:test";
import type { SearchResultItem, Track } from "../types";
import { preferExplicit } from "./search";

function track(id: string, title: string, artist: string, isExplicit: boolean): SearchResultItem {
  const value: Track = {
    id,
    provider: "net.itsnebula.spotify",
    title,
    artists: [{ id: null, name: artist }],
    album: null,
    duration: "3:00",
    durationSeconds: 180,
    thumbnailURL: null,
    isExplicit,
  };
  return { type: "track", track: value };
}

describe("preferExplicit", () => {
  test("drops a clean twin when an explicit equivalent exists", () => {
    const clean = track("clean", "Song", "Artist", false);
    const explicit = track("explicit", "Song", "Artist", true);

    expect(preferExplicit([clean, explicit])).toEqual([explicit]);
  });

  test("keeps clean tracks when no explicit equivalent exists", () => {
    const clean = track("clean", "Song", "Artist", false);

    expect(preferExplicit([clean])).toEqual([clean]);
  });

  test("does not merge tracks with a different primary artist", () => {
    const clean = track("clean", "Song", "Artist A", false);
    const explicit = track("explicit", "Song", "Artist B", true);

    expect(preferExplicit([clean, explicit])).toEqual([clean, explicit]);
  });
});
