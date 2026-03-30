import { join } from "node:path";
import { type BunPlugin, Glob } from "bun";

const root = join(import.meta.dir, "..");

const defaultAddons = ["ytm-addon", "spotify-addon", "am-addon", "torbox-addon"];
const addonArg = process.argv.find((arg) => arg.startsWith("--addon="));
const addons = addonArg ? [addonArg.split("=")[1]] : defaultAddons;

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
await Bun.$`mkdir -p ${distDir}`;

for (const addon of addons) {
  const name = addon.replace(/-addon$/, "");
  const entry = `${root}/packages/${addon}/src/index.ts`;

  const result = await Bun.build({
    entrypoints: [entry],
    format: "iife",
    target: "browser",
    minify: true,
    plugins: [workspaceResolver],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  if (!result.success) {
    console.error(`Failed to build ${addon}:`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  await Bun.write(`${distDir}/${name}.js`, result.outputs[0]);
  console.log(`Built ${addon} → dist/${name}.js`);
}

const siteDir = `${root}/public`;
const glob = new Glob("**/*");

for await (const path of glob.scan({ cwd: siteDir, dot: false })) {
  const src = Bun.file(`${siteDir}/${path}`);
  await Bun.write(`${distDir}/${path}`, src);
}

console.log("Copied site/ → dist/");
