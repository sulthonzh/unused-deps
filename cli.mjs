#!/usr/bin/env node
import { findUnused, formatText, formatJSON, formatMarkdown, parseArgs, HELP } from './index.mjs';

const args = parseArgs(process.argv);
if (args.help) { console.log(HELP); process.exit(0); }

const result = findUnused(args.dir, {
  ignorePatterns: args.ignore,
});

switch (args.format) {
  case 'json': console.log(formatJSON(result)); break;
  case 'markdown': console.log(formatMarkdown(result)); break;
  default: console.log(formatText(result, { verbose: args.verbose }));
}

process.exit(result.unused.length > 0 ? 1 : 0);
