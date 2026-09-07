import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolves the file extension the calling module is itself running as.
 *
 * The same loader code runs from two trees: `bun --watch src/index.ts` executes
 * TypeScript sources directly, while `bun start` executes the compiled output in
 * `dist/`. Hardcoding either extension makes the loader silently find nothing in
 * the other tree, so the caller passes its own `import.meta.url` and the
 * directory scan follows it.
 *
 * @param moduleUrl The calling module's `import.meta.url`.
 * @returns The caller's extension, e.g. `.ts` in development or `.js` in a build.
 */
export function moduleExtensionOf(moduleUrl: string): string {
	return path.extname(fileURLToPath(moduleUrl)) || '.js';
}

/**
 * Lists loadable command or event modules in a directory.
 *
 * Declaration files are emitted next to the JavaScript output and end in `.ts`,
 * so they are excluded explicitly rather than by extension alone.
 *
 * @param directory Absolute path of the directory to scan.
 * @param extension Module extension to match, from {@link moduleExtensionOf}.
 * @returns File names (not full paths) that should be dynamically imported.
 */
export function listModuleFiles(
	directory: string,
	extension: string,
): string[] {
	return fs
		.readdirSync(directory)
		.filter((file) => file.endsWith(extension) && !file.endsWith('.d.ts'));
}
