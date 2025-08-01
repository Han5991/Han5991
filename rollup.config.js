import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
  input: 'scripts/fetch-contributions.mjs',
  output: {
    file: 'dist/fetch-contributions.js',
    format: 'es',
    banner: '#!/usr/bin/env node'
  },
  plugins: [
    resolve({
      preferBuiltins: true
    }),
    commonjs(),
    json()
  ],
  external: ['fs', 'path', 'url']
};