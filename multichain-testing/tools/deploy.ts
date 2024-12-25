/** @file run a builder and deploy it onto the Agoric chain in local Starship cluster */
import { createRequire } from 'module';
import type { AgdTools } from './agd-tools.js';
import type { CoreEvalPlan } from '@agoric/deploy-script-support/src/writeCoreEvalParts.js';
import { flags } from './agd-lib.js';

const nodeRequire = createRequire(import.meta.url);

export const makeDeployBuilder = (
  tools: AgdTools,
  readJSON: typeof import('fs-extra').readJSON,
  execa: typeof import('execa').execa,
) =>
  async function deployBuilder(
    builder: string,
    builderOpts?: Record<string, string | string[]>,
  ) {
    console.log(`building plan: ${builder}`);
    const args = ['run', builder];
    if (builderOpts) {
      args.push(...flags(builderOpts));
    }
    const { stdout } = await execa('agoric', args);
    const match = stdout.match(/ (?<name>[-\w]+)-permit.json/);
    if (!(match && match.groups)) {
      throw Error('no permit found');
    }
    const plan = await readJSON(`./${match.groups.name}-plan.json`);
    console.log(plan);

    console.log('copying files to container');
    tools.copyFiles([
      nodeRequire.resolve(`../${plan.script}`),
      nodeRequire.resolve(`../${plan.permit}`),
      ...plan.bundles.map((b: CoreEvalPlan['bundles'][0]) => b.fileName),
    ]);

    console.log('installing bundles');
    await tools.installBundles(
      plan.bundles.map(
        (b: CoreEvalPlan['bundles'][0]) => `/tmp/contracts/${b.bundleID}.json`,
      ),
      console.log,
    );

    console.log('executing proposal');
    await tools.runCoreEval({
      name: plan.name,
      description: `${plan.name} proposal`,
    });
  };
