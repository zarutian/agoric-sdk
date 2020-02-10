// we'd prefer to do this, but node's ESM support has problems:
//import { rollup as rollup0 } from 'rollup';
import rollupNS from 'rollup';
const { rollup: rollup0 } = rollupNS;
import path from 'path';
import resolve0 from 'rollup-plugin-node-resolve';
import eventualSend from '@agoric/acorn-eventual-send';
import * as acorn from 'acorn';

const DEFAULT_MODULE_FORMAT = 'getExport';

export default async function bundleSource(
  startFilename,
  moduleFormat = DEFAULT_MODULE_FORMAT,
  access,
) {
  const { rollup, resolvePlugin, pathResolve } = access || {
    rollup: rollup0,
    resolvePlugin: resolve0,
    pathResolve: path.resolve,
  };
  const resolvedPath = pathResolve(startFilename);
  const bundle = await rollup({
    input: resolvedPath,
    treeshake: false,
    //inlineDynamicImports: true, // prevent use of Math.random
    //preserveModules: true, // avoid units.sort and Math.random

    // SES provides `harden()` as a global, but it's not easy to code against
    // that. Swingset makes `@agoric/harden` importable as a module (by
    // putting a minimal `require()` in the environment), so when we bundle
    // source for a Swingset environment mark `@agoric/harden` as an
    // external/exit/"hole" in the module graph. Note that we cannot allow
    // the real NPM-published `@agoric/harden` to appear in our source graph,
    // because it imports `@agoric/make-hardener` which has a comment that
    // SES rejects for looking too much like a direct eval.
    external: ['@agoric/harden'],

    plugins: [resolvePlugin({ preferBuiltins: true })],
    // the eventualSend(acorn) call causes a "TokenType is not a constructor"
    // error in acorn-eventual-send/index.js makeCurryOptions() that I don't
    // understand
    //acornInjectPlugins: [eventualSend(acorn)],
  });
  const { output } = await bundle.generate({
    exports: 'named',
    format: moduleFormat === 'getExport' ? 'cjs' : moduleFormat,
  });
  if (output.length !== 1) {
    throw Error('unprepared for more than one chunk/asset');
  }
  if (output[0].isAsset) {
    throw Error(`unprepared for assets: ${output[0].fileName}`);
  }
  let { code: source } = output[0];

  // 'source' is now a string that contains a program, which references
  // require() and sets module.exports . This is close, but we need a single
  // stringifiable function, so we must wrap it in an outer function that
  // returns the exports.
  //
  // build-kernel.js will prefix this with 'export default' so it becomes an
  // ES6 module. The Vat controller will wrap it with parenthesis so it can
  // be evaluated and invoked to get at the exports.

  const sourceMap = `//# sourceURL=${resolvedPath}\n`;
  if (moduleFormat === 'getExport')
    source = `\
function getExport() { 'use strict'; \
let exports = {}; \
const module = { exports }; \
\
${source}

return module.exports;
}
`;

  return { source, sourceMap, moduleFormat };
}
