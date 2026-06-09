import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findSourceFiles, extractImports, extractPackageName, readPackageJson,
  findUnused, formatText, formatJSON, formatMarkdown, parseArgs, NODE_BUILTINS,
} from './index.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TMP = join('/tmp', 'unused-deps-test-' + Date.now());

function setupTmp(structure) {
  mkdirSync(TMP, { recursive: true });
  for (const [path, content] of Object.entries(structure)) {
    const full = join(TMP, path);
    mkdirSync(full.replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(full, content);
  }
}

function cleanup() {
  rmSync(TMP, { recursive: true, force: true });
}

// --- extractPackageName ---
describe('extractPackageName', () => {
  it('handles scoped packages', () => {
    assert.equal(extractPackageName('@scope/foo'), '@scope/foo');
    assert.equal(extractPackageName('@scope/foo/bar'), '@scope/foo');
  });

  it('handles unscoped packages', () => {
    assert.equal(extractPackageName('lodash'), 'lodash');
    assert.equal(extractPackageName('lodash/map'), 'lodash');
  });

  it('rejects relative paths', () => {
    assert.equal(extractPackageName('./foo'), null);
    assert.equal(extractPackageName('../bar'), null);
    assert.equal(extractPackageName('/abs'), null);
  });

  it('handles null/undefined', () => {
    assert.equal(extractPackageName(null), null);
    assert.equal(extractPackageName(undefined), null);
  });
});

// --- extractImports ---
describe('extractImports', () => {
  it('detects ESM imports', () => {
    const files = [join(TMP, 'a.mjs')];
    setupTmp({ 'a.mjs': `import lodash from 'lodash';` });
    try {
      const imports = extractImports(files);
      assert(imports.has('lodash'));
    } finally { cleanup(); }
  });

  it('detects require calls', () => {
    const files = [join(TMP, 'b.js')];
    setupTmp({ 'b.js': `const expr = require('express');` });
    try {
      const imports = extractImports(files);
      assert(imports.has('express'));
    } finally { cleanup(); }
  });

  it('detects dynamic imports', () => {
    const files = [join(TMP, 'c.mjs')];
    setupTmp({ 'c.mjs': `const mod = import('chalk');` });
    try {
      const imports = extractImports(files);
      assert(imports.has('chalk'));
    } finally { cleanup(); }
  });

  it('detects scoped packages', () => {
    const files = [join(TMP, 'd.mjs')];
    setupTmp({ 'd.mjs': `import thing from '@sveltejs/kit';` });
    try {
      const imports = extractImports(files);
      assert(imports.has('@sveltejs/kit'));
    } finally { cleanup(); }
  });

  it('handles subpath imports correctly', () => {
    const files = [join(TMP, 'e.mjs')];
    setupTmp({ 'e.mjs': `import pick from 'lodash/pick';` });
    try {
      const imports = extractImports(files);
      assert(imports.has('lodash'));
      assert(!imports.has('lodash/pick'));
    } finally { cleanup(); }
  });

  it('skips unreadable files gracefully', () => {
    const imports = extractImports(['/nonexistent/file.js']);
    assert.equal(imports.size, 0);
  });
});

// --- findSourceFiles ---
describe('findSourceFiles', () => {
  it('finds js and ts files', () => {
    setupTmp({
      'src/a.js': '',
      'src/b.ts': '',
      'src/c.mjs': '',
      'src/nested/d.jsx': '',
    });
    try {
      const files = findSourceFiles(TMP);
      assert(files.some(f => f.endsWith('a.js')));
      assert(files.some(f => f.endsWith('b.ts')));
      assert(files.some(f => f.endsWith('c.mjs')));
      assert(files.some(f => f.endsWith('d.jsx')));
    } finally { cleanup(); }
  });

  it('ignores node_modules and other dirs', () => {
    setupTmp({
      'src/good.js': '',
      'node_modules/bad.js': '',
      'dist/bad2.js': '',
      '.git/bad3.js': '',
    });
    try {
      const files = findSourceFiles(TMP);
      assert(files.some(f => f.endsWith('good.js')));
      assert(!files.some(f => f.includes('node_modules')));
      assert(!files.some(f => f.includes('dist')));
      assert(!files.some(f => f.includes('.git')));
    } finally { cleanup(); }
  });
});

// --- readPackageJson ---
describe('readPackageJson', () => {
  it('reads deps and devDeps', () => {
    setupTmp({
      'package.json': JSON.stringify({
        dependencies: { express: '^4.0.0' },
        devDependencies: { jest: '^29.0.0' },
      }),
    });
    try {
      const { deps, pkg } = readPackageJson(TMP);
      assert(deps.has('express'));
      assert(deps.has('jest'));
      assert(pkg);
    } finally { cleanup(); }
  });

  it('returns empty on missing package.json', () => {
    const { deps, pkg } = readPackageJson('/nonexistent');
    assert.equal(deps.size, 0);
    assert.equal(pkg, null);
  });
});

// --- findUnused (integration) ---
describe('findUnused', () => {
  it('detects unused deps', () => {
    setupTmp({
      'package.json': JSON.stringify({ dependencies: { lodash: '^4.0.0', express: '^4.0.0' } }),
      'src/index.js': `import lodash from 'lodash';`,
    });
    try {
      const result = findUnused(TMP);
      assert(result.unused.includes('express'));
      assert(result.used.includes('lodash'));
    } finally { cleanup(); }
  });

  it('returns empty when all used', () => {
    setupTmp({
      'package.json': JSON.stringify({ dependencies: { lodash: '^4.0.0' } }),
      'src/index.js': `import lodash from 'lodash';`,
    });
    try {
      const result = findUnused(TMP);
      assert.equal(result.unused.length, 0);
      assert(result.used.includes('lodash'));
    } finally { cleanup(); }
  });

  it('handles no package.json', () => {
    const result = findUnused('/nonexistent');
    assert.equal(result.unused.length, 0);
    assert.equal(result.used.length, 0);
  });
});

// --- formatText ---
describe('formatText', () => {
  it('shows unused deps', () => {
    const out = formatText({ unused: ['express', 'lodash'], used: ['chalk'], allDeps: ['express', 'lodash', 'chalk'], sourceFiles: [] });
    assert(out.includes('express'));
    assert(out.includes('lodash'));
    assert(out.includes('2 unused'));
  });

  it('shows clean message when none unused', () => {
    const out = formatText({ unused: [], used: ['chalk'], allDeps: ['chalk'], sourceFiles: [] });
    assert(out.includes('Clean'));
  });

  it('verbose mode shows used deps and file count', () => {
    const out = formatText({ unused: ['old-pkg'], used: ['chalk'], allDeps: ['chalk', 'old-pkg'], sourceFiles: ['f1', 'f2', 'f3'] }, { verbose: true });
    assert(out.includes('chalk'));
    assert(out.includes('3 source files'));
  });
});

// --- formatJSON ---
describe('formatJSON', () => {
  it('produces valid JSON with expected keys', () => {
    const result = { unused: ['express'], used: ['lodash'], allDeps: ['express', 'lodash'], sourceFiles: ['f1', 'f2', 'f3', 'f4', 'f5'] };
    const json = formatJSON(result);
    const parsed = JSON.parse(json);
    assert.deepEqual(parsed.unused, ['express']);
    assert.deepEqual(parsed.used, ['lodash']);
    assert.equal(parsed.total, 2);
    assert.equal(parsed.sourceFiles, 5);
  });
});

// --- formatMarkdown ---
describe('formatMarkdown', () => {
  it('produces markdown table', () => {
    const out = formatMarkdown({ unused: ['express'], used: ['lodash'], allDeps: ['express', 'lodash'], sourceFiles: ['f1', 'f2', 'f3'] });
    assert(out.includes('| 1 | `express` |'));
    assert(out.includes('3 source files'));
  });

  it('shows clean message', () => {
    const out = formatMarkdown({ unused: [], used: ['lodash'], allDeps: ['lodash'], sourceFiles: ['f1'] });
    assert(out.includes('All dependencies'));
  });
});

// --- parseArgs ---
describe('parseArgs', () => {
  it('defaults', () => {
    const args = parseArgs(['node', 'unused-deps']);
    assert.equal(args.dir, '.');
    assert.equal(args.format, 'text');
    assert.equal(args.verbose, false);
  });

  it('parses json and dir', () => {
    const args = parseArgs(['node', 'unused-deps', './myproj', '--json']);
    assert.equal(args.dir, './myproj');
    assert.equal(args.format, 'json');
  });

  it('parses markdown and verbose', () => {
    const args = parseArgs(['node', 'unused-deps', '--md', '-v']);
    assert.equal(args.format, 'markdown');
    assert.equal(args.verbose, true);
  });

  it('parses --ignore', () => {
    const args = parseArgs(['node', 'unused-deps', '--ignore', 'src/gen,src/vendor']);
    assert.deepEqual(args.ignore, ['src/gen', 'src/vendor']);
  });

  it('parses --help', () => {
    const args = parseArgs(['node', 'unused-deps', '-h']);
    assert.equal(args.help, true);
  });
});

// --- NODE_BUILTINS ---
describe('NODE_BUILTINS', () => {
  it('contains common builtins', () => {
    assert(NODE_BUILTINS.has('fs'));
    assert(NODE_BUILTINS.has('path'));
    assert(NODE_BUILTINS.has('node:fs'));
    assert(NODE_BUILTINS.has('node:test'));
  });
});
