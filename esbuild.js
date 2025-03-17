const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: "esbuild-problem-matcher",

	setup(build) {
		build.onStart(() => {
			console.log("[watch] build started")
		})
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`)
				console.error(`    ${location.file}:${location.line}:${location.column}:`)
			})
			console.log("[watch] build finished")
		})
	},
}

const copyWasmFiles = {
	name: "copy-wasm-files",
	setup(build) {
		build.onEnd(() => {
			// tree sitter
			const sourceDir = path.join(__dirname, "node_modules", "web-tree-sitter")
			const targetDir = path.join(__dirname, "dist")

			// Copy tree-sitter.wasm
			fs.copyFileSync(path.join(sourceDir, "tree-sitter.wasm"), path.join(targetDir, "tree-sitter.wasm"))

			// Copy language-specific WASM files
			const languageWasmDir = path.join(__dirname, "node_modules", "tree-sitter-wasms", "out")
			const languages = [
				"typescript",
				"tsx",
				"python",
				"rust",
				"javascript",
				"go",
				"cpp",
				"c",
				"c_sharp",
				"ruby",
				"java",
				"php",
				"swift",
				"kotlin",
			]

			languages.forEach((lang) => {
				const filename = `tree-sitter-${lang}.wasm`
				fs.copyFileSync(path.join(languageWasmDir, filename), path.join(targetDir, filename))
			})
		})
	},
}

const copyLocalesFiles = {
	name: "copy-locales-files",
	setup(build) {
		build.onEnd(() => {
			// Source directory for translations
			const srcDir = path.join(__dirname, "src", "i18n", "locales")

			// Two destination directories to handle different import paths
			const destDirNested = path.join(__dirname, "dist", "i18n", "locales")
			const destDirFlat = path.join(__dirname, "dist", "locales")

			// Create the destination directories if they don't exist
			fs.mkdirSync(destDirNested, { recursive: true })
			fs.mkdirSync(destDirFlat, { recursive: true })

			// Function to copy directory recursively
			function copyDirRecursively(src, dest) {
				// Read the source directory
				const entries = fs.readdirSync(src, { withFileTypes: true })

				// Process each entry
				entries.forEach((entry) => {
					const srcPath = path.join(src, entry.name)
					const destPath = path.join(dest, entry.name)

					if (entry.isDirectory()) {
						// Create directory if it doesn't exist
						fs.mkdirSync(destPath, { recursive: true })
						// Recursively copy contents
						copyDirRecursively(srcPath, destPath)
					} else {
						// Copy the file
						fs.copyFileSync(srcPath, destPath)
					}
				})
			}

			// Copy all locales recursively if the directory exists
			if (fs.existsSync(srcDir)) {
				// Copy to both locations for maximum compatibility
				copyDirRecursively(srcDir, destDirNested)
				copyDirRecursively(srcDir, destDirFlat)
				console.log("Copied translation files to dist/i18n/locales and dist/locales")

				// Also copy to out directory for debugging (if it exists)
				const outDirNested = path.join(__dirname, "out", "i18n", "locales")
				const outDirFlat = path.join(__dirname, "out", "locales")

				try {
					fs.mkdirSync(outDirNested, { recursive: true })
					fs.mkdirSync(outDirFlat, { recursive: true })
					copyDirRecursively(srcDir, outDirNested)
					copyDirRecursively(srcDir, outDirFlat)
					console.log("Copied translation files to out/i18n/locales and out/locales")
				} catch (err) {
					console.warn("Warning: Could not copy to out directory", err.message)
				}
			} else {
				console.warn("Warning: locales directory not found in src/i18n")
			}
		})
	},
}

const extensionConfig = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	logLevel: "silent",
	plugins: [
		copyWasmFiles,
		copyLocalesFiles,
		/* add to the end of plugins array */
		esbuildProblemMatcherPlugin,
		{
			name: "alias-plugin",
			setup(build) {
				build.onResolve({ filter: /^pkce-challenge$/ }, (args) => {
					return { path: require.resolve("pkce-challenge/dist/index.browser.js") }
				})
			},
		},
	],
	entryPoints: ["src/extension.ts"],
	format: "cjs",
	sourcesContent: false,
	platform: "node",
	outfile: "dist/extension.js",
	external: ["vscode"],
}

async function main() {
	const extensionCtx = await esbuild.context(extensionConfig)
	if (watch) {
		await extensionCtx.watch()
	} else {
		await extensionCtx.rebuild()
		await extensionCtx.dispose()
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
