import { test } from 'tape-promise/tape';
import { buildVatController } from '../src/index';

async function requireHarden(t, withSES) {
  const config = { bootstrapIndexJS: require.resolve('./vat-imports-1.js') };
  const c = await buildVatController(config, withSES, ['harden']);
  await c.step();
  t.deepEqual(c.dump().log, ['harden-1', 'true', 'true']);
}

test('vat can require harden with SES', async t => {
  await requireHarden(t, true);
  t.end();
});

async function requireSES(t, withSES) {
  const config = { bootstrapIndexJS: require.resolve('./vat-imports-1.js') };
  const c = await buildVatController(config, withSES, ['ses']);
  await c.step();
  t.deepEqual(c.dump().log, ['ses-1', 'lockdown-is-function']);
}

test('vat can require SES', async t => {
  await requireSES(t, true);
  t.end();
});
