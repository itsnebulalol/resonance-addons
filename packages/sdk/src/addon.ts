import type { AddonDefinition } from "./types";

export function defineAddon<TConfig = Record<string, string>>(definition: AddonDefinition<TConfig>) {
  const manifest = {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    version: definition.version,
    icon: definition.icon,
    resources: definition.resources,
    auth: definition.auth,
    config: definition.config,
    behaviorHints: definition.behaviorHints,
    capabilities: definition.capabilities,
  };

  const addon = {
    manifest,
    handlers: definition.handlers,
  };

  (globalThis as Record<string, unknown>).__resonance_addon__ = addon;

  return addon;
}
