import { build } from "esbuild";
import esbuildPluginTsc from "esbuild-plugin-tsc";

await build({
	entryPoints: ["src/format.mts"],
	outfile: "dist/index.mjs",
	platform: "node",
	target: "node20",
	format: "esm",
	bundle: true,
	minify: true,
	plugins: [
		esbuildPluginTsc({
			force: true,
		}),
	],
	banner: {
		js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
	},
});
