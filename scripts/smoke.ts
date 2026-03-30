import { join } from "node:path";

const root = join(import.meta.dir, "..");

const defaultAddons = ["ytm-addon", "spotify-addon", "am-addon", "torbox-addon"];
const addonArg = process.argv.find((arg) => arg.startsWith("--addon="));
const addons = addonArg ? [addonArg.split("=")[1]] : defaultAddons;

const requiredManifestFields = ["id", "name", "description", "version", "resources"];

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

for (const addon of addons) {
  const name = addon.replace(/-addon$/, "");
  const bundlePath = `${root}/dist/${name}.js`;
  const file = Bun.file(bundlePath);

  if (!(await file.exists())) {
    throw new Error(`${addon}: bundle not found at dist/${name}.js`);
  }

  const code = await file.text();
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
    throw new Error(`${addon}: globalThis.__resonance_addon__ is missing`);
  }

  const { manifest, handlers } = addonRuntime;
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`${addon}: manifest is missing`);
  }

  validateManifest(manifest, addon);
  validateHandlers(handlers, addon);

  console.log(`Smoke passed: ${addon}`);
}
