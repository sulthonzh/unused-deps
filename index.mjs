import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

/**
 * Find all JS/TS source files in a directory, respecting common ignore patterns.
 */
export function findSourceFiles(rootDir, options = {}) {
  const exts = options.extensions || ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
  const ignoreDirs = new Set(options.ignoreDirs || [
    'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
    'out', '.cache', '.turbo', '.vercel', '.svelte-kit', 'vendor',
  ]);
  const ignorePatterns = options.ignorePatterns || [];
  const results = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) walk(join(dir, entry.name));
      } else if (exts.includes(extname(entry.name))) {
        const full = join(dir, entry.name);
        const rel = relative(rootDir, full);
        if (!ignorePatterns.some(p => rel.includes(p))) {
          results.push(full);
        }
      }
    }
  }

  walk(rootDir);
  return results;
}

/**
 * Extract all import/require specifiers from source files.
 * Returns a Set of bare specifiers (package names).
 */
export function extractImports(files) {
  const imports = new Set();

  // Match: import ... from 'pkg', require('pkg'), import('pkg')
  // Also handles scoped packages like @scope/name
  const importRe = /(?:import\s+[^;]*?\s+from\s+|import\s*\(|require\s*\()\s*['"](@?[a-zA-Z0-9._-]+\/?[a-zA-Z0-9._-]*)/g;

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      let match;
      while ((match = importRe.exec(content)) !== null) {
        const specifier = match[1];
        // Extract package name: @scope/name → @scope/name, lodash/map → lodash
        const pkgName = extractPackageName(specifier);
        if (pkgName) imports.add(pkgName);
      }
    } catch {
      // skip unreadable files
    }
  }

  return imports;
}

/**
 * Extract the package name from a module specifier.
 * @scope/foo/bar → @scope/foo
 * lodash/map → lodash
 * ./path → null (relative)
 */
export function extractPackageName(specifier) {
  if (!specifier) return null;
  // Skip relative and absolute paths
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;

  // Scoped package
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return null;
  }

  // Unscoped: take first segment
  return specifier.split('/')[0];
}

/**
 * Read dependencies from package.json
 */
export function readPackageJson(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    const deps = new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ]);
    return { deps, pkg };
  } catch {
    return { deps: new Set(), pkg: null };
  }
}

/**
 * Built-in Node.js modules to exclude from analysis.
 */
export const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline',
  'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  'node:assert', 'node:async_hooks', 'node:buffer', 'node:child_process',
  'node:cluster', 'node:console', 'node:constants', 'node:crypto', 'node:dgram',
  'node:diagnostics_channel', 'node:dns', 'node:dns/promises', 'node:domain',
  'node:events', 'node:fs', 'node:fs/promises', 'node:http', 'node:http2',
  'node:https', 'node:inspector', 'node:module', 'node:net', 'node:os',
  'node:path', 'node:perf_hooks', 'node:process', 'node:punycode',
  'node:querystring', 'node:readline', 'node:readline/promises', 'node:repl',
  'node:stream', 'node:stream/consumers', 'node:stream/promises',
  'node:stream/web', 'node:string_decoder', 'node:sys', 'node:test',
  'node:timers', 'node:timers/promises', 'node:tls', 'node:trace_events',
  'node:tty', 'node:url', 'node:util', 'node:v8', 'node:vm', 'node:wasi',
  'node:worker_threads', 'node:zlib',
]);

/**
 * Find unused dependencies.
 * Returns { unused, used, allDeps, pkg, sourceFiles }
 */
export function findUnused(dir, options = {}) {
  const { deps: allDeps, pkg } = readPackageJson(dir);
  if (allDeps.size === 0) {
    return { unused: [], used: [], allDeps: [], pkg, sourceFiles: [] };
  }

  const sourceFiles = findSourceFiles(dir, options);
  const imports = extractImports(sourceFiles);

  // Filter out builtins and local paths
  const used = new Set();
  const unused = [];

  for (const dep of allDeps) {
    if (imports.has(dep)) {
      used.add(dep);
    } else {
      unused.push(dep);
    }
  }

  // Check for peer deps, optional deps that might be conditionally imported
  const peerDeps = new Set([
    ...Object.keys(pkg?.peerDependencies || {}),
  ]);

  return {
    unused: unused.filter(d => !peerDeps.has(d)).sort(),
    used: [...used].sort(),
    allDeps: [...allDeps].sort(),
    pkg,
    sourceFiles,
  };
}

/**
 * Format results as text
 */
export function formatText(result, options = {}) {
  const lines = [];
  if (result.unused.length === 0) {
    lines.push('All dependencies are in use. Clean! ✓');
    return lines.join('\n');
  }

  lines.push(`Found ${result.unused.length} unused ${result.unused.length === 1 ? 'dependency' : 'dependencies'}:\n`);
  for (const dep of result.unused) {
    lines.push(`  ${dep}`);
  }

  if (options.verbose) {
    lines.push(`\n${result.used.length} used dependencies:`);
    for (const dep of result.used) {
      lines.push(`  ${dep}`);
    }
    lines.push(`\nScanned ${result.sourceFiles.length} source files`);
  }

  return lines.join('\n');
}

/**
 * Format results as JSON
 */
export function formatJSON(result) {
  return JSON.stringify({
    unused: result.unused,
    used: result.used,
    total: result.allDeps.length,
    sourceFiles: result.sourceFiles.length,
  }, null, 2);
}

/**
 * Format results as markdown
 */
export function formatMarkdown(result) {
  const lines = ['# Unused Dependencies\n'];
  if (result.unused.length === 0) {
    lines.push('All dependencies are in use. ✓');
    return lines.join('\n');
  }

  lines.push(`| # | Package |`, `|---|---------|`);
  result.unused.forEach((dep, i) => {
    lines.push(`| ${i + 1} | \`${dep}\` |`);
  });
  lines.push('', `> Scanned ${result.sourceFiles.length} source files · ${result.used.length}/${result.allDeps.length} dependencies used`);
  return lines.join('\n');
}

/**
 * Parse CLI arguments
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { dir: '.', format: 'text', verbose: false, ignore: [] };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--json': result.format = 'json'; break;
      case '--markdown': case '--md': result.format = 'markdown'; break;
      case '--verbose': case '-v': result.verbose = true; break;
      case '--ignore':
        result.ignore = args[++i]?.split(',') || [];
        break;
      case '--help': case '-h':
        result.help = true;
        break;
      default:
        if (!args[i].startsWith('-')) result.dir = args[i];
        break;
    }
  }

  return result;
}

export const HELP = `unused-deps — find unused npm dependencies

Usage:
  unused-deps [dir] [options]

Options:
  --json          Output as JSON
  --markdown      Output as markdown table
  --verbose, -v   Show used deps too
  --ignore <list> Comma-separated dirs to ignore
  --help, -h      Show this help

Examples:
  unused-deps
  unused-deps ./my-project --json
  unused-deps . --ignore src/generated,src/vendor
`;
