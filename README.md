# unused-deps

Find npm dependencies you list in `package.json` but never actually import.

## Why?

Every project accumulates deps. You tried that library once, didn't use it, forgot to remove it. Your `node_modules` grows, your install time creeps up, and your bundle gets heavier for no reason.

`unused-deps` scans your source files, finds every `import` and `require`, then tells you which packages in your `package.json` never get used.

## Install

```bash
npm install -g unused-deps
```

Or use without installing:

```bash
npx unused-deps
```

## Usage

```bash
# Scan current directory
unused-deps

# Scan a specific project
unused-deps ./my-project

# JSON output (for scripts/CI)
unused-deps --json

# Markdown table
unused-deps --markdown

# Verbose — shows used deps too
unused-deps --verbose

# Ignore generated dirs
unused-deps --ignore src/generated,src/vendor
```

### CI Integration

Exit code is `1` when unused deps are found, `0` when clean. Add to your CI:

```yaml
- name: Check for unused deps
  run: npx unused-deps --json
```

## What it detects

- ESM imports: `import foo from 'pkg'`
- CommonJS: `require('pkg')`
- Dynamic: `import('pkg')`
- Scoped packages: `@scope/name`
- Subpath imports: `lodash/map` → correctly maps to `lodash`

Skips:
- `node_modules`, `dist`, `build`, `.git`, `.next`, `coverage`, etc.
- Node.js built-in modules
- Peer dependencies (usually conditionally imported)

## Output formats

**Text (default):**
```
Found 2 unused dependencies:

  express
  moment
```

**JSON:**
```json
{
  "unused": ["express", "moment"],
  "used": ["lodash"],
  "total": 3,
  "sourceFiles": 12
}
```

**Markdown:**

| # | Package |
|---|---------|
| 1 | `express` |
| 2 | `moment` |

## Programmatic API

```javascript
import { findUnused, formatText, formatJSON } from 'unused-deps';

const result = findUnused('./my-project');
console.log(formatText(result));

// result.unused — string[] of unused dep names
// result.used — string[] of used dep names
// result.allDeps — string[] of all deps
// result.sourceFiles — string[] of scanned file paths
```

## Limitations

- String-based analysis, not AST — clever dynamic requires might be missed
- Only scans `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts` files
- Doesn't detect usage in config files (webpack, babel, etc.) — those deps would be flagged as unused
- Packages used only in `scripts` in package.json aren't detected

## License

MIT
