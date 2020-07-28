import '@agoric/install-ses';
// eslint-disable-next-line import/no-extraneous-dependencies
import { test } from 'tape-promise/tape';
// eslint-disable-next-line import/no-extraneous-dependencies
import bundleSource from '@agoric/bundle-source';

// noinspection ES6PreferShortImport
import { makeZoe } from '../../../src/zoe';
import { setup } from '../setupBasicMints';
import fakeVatAdmin from './fakeVatAdmin';

const contractRoot = `${__dirname}/zcfTesterContract`;

test('zoe - test zcf', async t => {
  t.plan(1);
  const { moolaIssuer, simoleanIssuer } = setup();
  const zoe = makeZoe(fakeVatAdmin);

  // pack the contract
  const bundle = await bundleSource(contractRoot);
  // install the contract
  const installationHandle = await zoe.install(bundle);

  // Alice creates an instance
  const issuerKeywordRecord = harden({
    Pixels: moolaIssuer,
    Money: simoleanIssuer,
  });
  t.doesNotReject(() =>
    zoe.makeInstance(installationHandle, issuerKeywordRecord),
  );
});
