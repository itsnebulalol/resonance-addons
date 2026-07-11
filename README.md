# Resonance Addons

A collection of addons for [Resonance](https://resonance.stkc.win).

## Addons

All addons are available on the [Resonance Addons homepage](https://resonance.itsnebula.net).

| Addon | Description |
|-------|-------------|
| **YouTube Music** | Stream, browse, and sync listening history |
| **Spotify** | Stream, browse, search, manage your library, and sync listening history |
| **Apple Music** | Stream, browse, and sync playback, history, lyrics & metadata |
| **LRCLIB** | Fetch synced and plain lyrics from LRCLIB |
| **SoundCloud** | Search, stream, browse, and sync tracks, profiles, albums, playlists, and history |
| **TorBox** | Stream music from cached torrents via TorBox |

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
```

### Build

```sh
# Build all addons
bun run build

# Build a single addon
bun run build:ytm
bun run build:spotify
bun run build:am
bun run build:lrclib
bun run build:soundcloud
bun run build:torbox
```

### Lint & Format

```sh
bun run check    # lint + format (auto-fix)
bun run lint     # lint only
bun run format   # format only (auto-fix)
```

## Project Structure

```
packages/
  sdk/             Shared addon SDK (defineAddon, types, errors)
  ytm-addon/       YouTube Music addon
  spotify-addon/   Spotify addon
  am-addon/        Apple Music addon
  lrclib-addon/    LRCLIB lyrics addon
  soundcloud-addon/ SoundCloud addon
  torbox-addon/    TorBox addon
public/
  index.html       Static homepage
scripts/
  build.ts         Builds all addons using Bun.build()
  smoke.ts         Smoke tests for built bundles
```

## Creating an Addon

Each addon uses `defineAddon` from `@resonance-addons/sdk` to declare its manifest and handlers:

```ts
import { defineAddon } from "@resonance-addons/sdk";

export const addon = defineAddon({
  id: "com.resonance.example",
  name: "Example",
  description: "An example addon",
  version: "1.0.0",
  resources: [{ type: "stream", idPrefixes: ["com.resonance.example"] }],
  handlers: {
    resolveStream: (config, trackId) => {
      // ...
    },
  },
});
```

### History Providers

Declare `{ type: "history", idPrefixes: [...] }` and implement
`recordHistory(config, trackId, event)` to sync committed listens. Resonance resolves tracks from
other catalog providers before calling the handler, so `trackId` is already in the History
provider's namespace.

```ts
recordHistory: async (config, trackId, event) => {
  // Translate the committed listen into the provider's scrobble or playback-reporting API.
}
```

`event` includes `playbackId`, `startedAtMs`, `reportedAtMs`, `listenedSeconds`,
`positionSeconds`, `durationSeconds`, and `completed`. History providers are independently enabled
with checkboxes; every checked provider receives the listen.

The build script bundles each addon into a self-contained IIFE that sets `globalThis.__resonance_addon__` when executed.

## License

Resonance Addons are licensed under [GPL-3.0](LICENSE).
