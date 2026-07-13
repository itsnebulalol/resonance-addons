import { ampGet, getStorefront, radioNextTracks, songStationId, songToTrack } from "../api";
import type { Track } from "../models";

// browseId is the QueuePage.relatedBrowseId we set in startQueue = a station id
export async function handleRelated(browseId: string): Promise<Track[]> {
  if (browseId.startsWith("ra.")) {
    return radioNextTracks(browseId, 10);
  }
  const sf = await getStorefront();
  try {
    const d = await ampGet(`/v1/catalog/${sf}/artists/${browseId}/view/top-songs`, { limit: 25 });
    return (d?.data ?? []).map(songToTrack);
  } catch (e: any) {
    console.error("[related] failed:", e.message);
    return [];
  }
}

export async function handleRelatedForTrack(trackId: string): Promise<Track[]> {
  // Apple's "you might also like" for this song
  const radio = (await radioNextTracks(songStationId(trackId), 10)).filter((t) => t.id !== trackId);
  if (radio.length) return radio;

  // fallback: the song's artist's top songs
  const sf = await getStorefront();
  try {
    const sd = await ampGet(`/v1/catalog/${sf}/songs/${trackId}`, { include: "artists" });
    const artistId = sd?.data?.[0]?.relationships?.artists?.data?.[0]?.id;
    if (!artistId) return [];
    const d = await ampGet(`/v1/catalog/${sf}/artists/${artistId}/view/top-songs`, { limit: 25 });
    return (d?.data ?? []).map(songToTrack).filter((t: Track) => t.id !== trackId);
  } catch (e: any) {
    console.error("[related] for-track failed:", e.message);
    return [];
  }
}
