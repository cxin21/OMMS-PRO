import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(projectRoot, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(projectRoot, 'dist/index.js'),
  external: [
    'node:fs',
    'node:path',
    'node:os',
    'node:crypto',
    'node:module',
    'node:worker_threads',
    'node:async_hooks',
    'node:events',
    'node:net',
    'node:http',
    'node:https',
    'node:url',
    'node:zlib',
    'node:stream',
    'node:buffer',
    'node:util',
    'node:querystring',
    'node:tty',
    'node:os',
    '@lancedb/lancedb',
    'better-sqlite3',
  ],
  loader: {
    '.node': 'copy',
  },
  sourcemap: true,
  minify: false,
  logLevel: 'info',
});

console.log('Bundle created successfully!');
