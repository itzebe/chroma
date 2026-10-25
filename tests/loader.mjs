/**
 * ESM resolver hook for `node --test`.
 *
 * Application source uses two specifiers only the Next.js bundler resolves: the
 * bare "next/server" package entry (CommonJS, so it also needs an explicit
 * format), and the "@/" path alias for "src/". This hook maps both so tests can
 * import and run the real route handlers against real `Request` objects instead
 * of reimplementing their logic.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolvePath(here, "..", "src");

const PACKAGE_MAP = new Map([
  ["next/server", "next/server.js"],
  ["next/headers", "next/headers.js"],
]);

/** Resolve a bundler-style extensionless path to the file that exists. */
function withExtension(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolvePath(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return base;
}

export async function resolve(specifier, context, nextResolve) {
  const pkg = PACKAGE_MAP.get(specifier);
  if (pkg) {
    const resolved = await nextResolve(pkg, context);
    return { ...resolved, format: "commonjs", shortCircuit: true };
  }

  if (specifier === "@/lib" || specifier.startsWith("@/lib/")) {
    const target = withExtension(resolvePath(srcDir, specifier.slice("@/".length)));
    return nextResolve(pathToFileURL(target).href, context);
  }

  return nextResolve(specifier, context);
}
