#! /usr/bin/env node

const esmRequire = require('esm')(module);

// import node-lmdb early to work around SES incompatibility
require('node-lmdb');

const agcc = require('bindings')('agcosmosdaemon.node');

// we need to enable Math.random as a workaround for 'brace-expansion' module
// (dep chain: temp->glob->minimatch->brace-expansion)
esmRequire('@agoric/install-metering-and-ses');

const path = require('path');

esmRequire('./anylogger-agoric');
const anylogger = require('anylogger');

const log = anylogger('ag-chain-cosmos');

const main = esmRequire('./chain-main.js').default;

main(process.argv[1], process.argv.splice(2), {
  path,
  env: process.env,
  agcc,
}).then(
  _res => 0,
  rej => {
    log.error(`error running ag-chain-cosmos:`, rej);
    process.exit(1);
  },
);
