import { join } from "node:path";
import { type BunPlugin, Glob } from "bun";
import { resolveAddons } from "./addons";

const root = join(import.meta.dir, "..");
const addons = resolveAddons(process.argv);

const workspaceResolver: BunPlugin = {
  name: "workspace-resolver",
  setup(build) {
    build.onResolve({ filter: /^@resonance-addons\// }, (args) => {
      const pkg = args.path.replace("@resonance-addons/", "");
      return { path: join(root, "packages", pkg, "src", "index.ts") };
    });
  },
};

const distDir = `${root}/dist`;
await Bun.$`rm -rf ${distDir}`;
await Bun.$`mkdir -p ${distDir}`;

for (const addon of addons) {
  const entry = `${root}/packages/${addon.packageName}/src/index.ts`;

  const result = await Bun.build({
    entrypoints: [entry],
    format: "iife",
    target: "browser",
    minify: true,
    plugins: [workspaceResolver],
    banner:
      "// resonance-addon-format: 1\nvar self = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this);",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  if (!result.success) {
    console.error(`Failed to build ${addon.packageName}:`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const output = result.outputs[0];
  if (!output) {
    throw new Error(`${addon.packageName}: build produced no output`);
  }
  await Bun.write(`${distDir}/${addon.outputName}.resonance`, output);
  console.log(`Built ${addon.packageName} → dist/${addon.outputName}.resonance`);
}

const siteDir = `${root}/public`;
const glob = new Glob("**/*");

for await (const path of glob.scan({ cwd: siteDir, dot: false })) {
  const src = Bun.file(`${siteDir}/${path}`);
  await Bun.write(`${distDir}/${path}`, src);
}

console.log("Copied site/ → dist/");
