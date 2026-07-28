import { join } from "node:path";
import { resolveAddons } from "./addons";

const root = join(import.meta.dir, "..");
const addons = resolveAddons(process.argv);

const requiredManifestFields = ["id", "name", "description", "version", "resources"];
const formatHeader = "// resonance-addon-format: 1";
const maximumPackageSize = 16 * 1024 * 1024;
const seenIDs = new Set<string>();
const readme = await Bun.file(`${root}/README.md`).text();
const homepage = await Bun.file(`${root}/public/index.html`).text();

function validateManifest(manifest: Record<string, unknown>, addon: string) {
  for (const field of requiredManifestFields) {
    if (!(field in manifest)) {
      throw new Error(`${addon}: missing manifest.${field}`);
    }
  }
}

function validateHandlers(handlers: unknown, addon: string) {
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) {
    throw new Error(`${addon}: handlers must be an object`);
  }

  for (const [name, value] of Object.entries(handlers as Record<string, unknown>)) {
    if (typeof value !== "function") {
      throw new Error(`${addon}: handlers.${name} must be a function`);
    }
  }
}

function validateCapabilities(manifest: Record<string, any>, handlers: Record<string, unknown>, addon: string) {
  const requiredHandlers: Array<[string, string]> = [
    ["supportsAddToPlaylist", "addToPlaylist"],
    ["supportsCreatePlaylist", "createPlaylist"],
    ["supportsEditPlaylist", "updatePlaylist"],
    ["supportsRemoveFromPlaylist", "removeFromPlaylist"],
  ];
  for (const [capability, handler] of requiredHandlers) {
    if (manifest.capabilities?.[capability] === true && typeof handlers[handler] !== "function") {
      throw new Error(`${addon}: manifest.capabilities.${capability} requires handlers.${handler}`);
    }
  }
}

for (const addon of addons) {
  const bundlePath = `${root}/dist/${addon.outputName}.resonance`;
  const file = Bun.file(bundlePath);

  if (!(await file.exists())) {
    throw new Error(`${addon.packageName}: bundle not found at dist/${addon.outputName}.resonance`);
  }
  if (file.size > maximumPackageSize) {
    throw new Error(`${addon.packageName}: package exceeds 16 MB`);
  }

  const code = await file.text();
  if (!code.startsWith(formatHeader)) {
    throw new Error(`${addon.packageName}: missing ${formatHeader}`);
  }
  const context: Record<string, unknown> = {
    globalThis: {},
    console,
    setTimeout,
    clearTimeout,
    URL,
    fetch,
  };
  context.globalThis = context;

  const script = new Function("globalThis", "console", "setTimeout", "clearTimeout", "URL", "fetch", code);
  script(context, console, setTimeout, clearTimeout, URL, fetch);

  const addonRuntime = (context as Record<string, unknown>).__resonance_addon__ as
    | { manifest: Record<string, unknown>; handlers: unknown }
    | undefined;

  if (!addonRuntime || typeof addonRuntime !== "object") {
    throw new Error(`${addon.packageName}: globalThis.__resonance_addon__ is missing`);
  }

  const { manifest, handlers } = addonRuntime;
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`${addon.packageName}: manifest is missing`);
  }

  validateManifest(manifest, addon.packageName);
  validateHandlers(handlers, addon.packageName);
  validateCapabilities(manifest, handlers as Record<string, unknown>, addon.packageName);
  if (
    manifest.id !== addon.id ||
    manifest.name !== addon.name ||
    manifest.version !== addon.version ||
    manifest.description !== addon.description
  ) {
    throw new Error(`${addon.packageName}: manifest metadata does not match scripts/addons.ts`);
  }
  if (!readme.includes(addon.description) || !homepage.includes(addon.description)) {
    throw new Error(`${addon.packageName}: public description does not match scripts/addons.ts`);
  }
  if (seenIDs.has(manifest.id as string)) {
    throw new Error(`${addon.packageName}: duplicate addon ID ${manifest.id}`);
  }
  seenIDs.add(manifest.id as string);

  console.log(`Smoke passed: ${addon.packageName}`);
}
