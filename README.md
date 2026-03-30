# Resonance Addons

A collection of addons for [Resonance](https://resonance.stkc.win).

## Addons

All addons are available on the [Resonance Addons homepage](https://resonance.itsnebula.net).

| Addon | Description |
|-------|-------------|
| **YouTube Music** | Stream and browse your YouTube Music library |
| **Spotify** | Browse, search, and manage your Spotify library |
| **Apple Music Enhancements** | Lyrics, metadata, and artwork from Apple Music |
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
  am-addon/        Apple Music Enhancements addon
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

The build script bundles each addon into a self-contained IIFE that sets `globalThis.__resonance_addon__` when executed.

## License

Resonance Addons are licensed under [GPL-3.0](LICENSE).
