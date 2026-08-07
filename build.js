import { build } from "esbuild";

await build({
	entryPoints: ["src/format.mts"],
	outfile: "dist/index.mjs",
	platform: "node",
	target: "node20",
	format: "esm",
	bundle: true,
	minify: true,
	banner: {
		js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
	},
});
