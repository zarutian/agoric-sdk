import path from 'path';
import chalk from 'chalk';

export default async function installMain(progname, rawArgs, powers, opts) {
  const { anylogger, fs, spawn } = powers;
  const log = anylogger('agoric:install');

  // Notify the preinstall guard that we are running.
  process.env.AGORIC_INSTALL = 'true';

  const pspawn = (...args) =>
    new Promise((resolve, _reject) => {
      const cp = spawn(...args);
      cp.on('exit', resolve);
      cp.on('error', () => resolve(-1));
    });

  const rimraf = file => pspawn('rm', ['-rf', file]);
  const subdirs = ['.', '_agstate/agoric-servers', 'contract', 'api'].sort();

  const linkFolder = path.resolve(`_agstate/yarn-links`);
  const linkFlags = [`--link-folder=${linkFolder}`, 'link'];

  if (opts.sdk) {
    const sdkPackagesDir = path.resolve(__dirname, '../../../packages');
    const allPackages = await fs.readdir(sdkPackagesDir);
    const packages = new Map();
    const versions = new Map();
    log('removing', linkFolder);
    await rimraf(linkFolder);
    for (const pkg of allPackages) {
      const dir = `${sdkPackagesDir}/${pkg}`;
      let packageJSON;
      try {
        // eslint-disable-next-line no-await-in-loop
        packageJSON = await fs.readFile(`${dir}/package.json`);
      } catch (e) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (packageJSON) {
        const pj = JSON.parse(packageJSON);
        if (!pj.private) {
          if (
            // eslint-disable-next-line no-await-in-loop
            await pspawn('yarn', linkFlags, {
              stdio: 'inherit',
              cwd: dir,
            })
          ) {
            log.error('Cannot yarn link', dir);
            return 1;
          }
          packages.set(pkg, pj.name);
          versions.set(pj.name, pj.version);
        }
      }
    }
    await Promise.all(
      subdirs.map(async subdir => {
        const nm = `${subdir}/node_modules`;
        log(chalk.bold.green(`removing ${nm} link`));
        await fs.unlink(nm).catch(_ => {});

        // Update all the package dependencies according to the SDK.
        const pjson = `${subdir}/package.json`;
        const packageJSON = await fs.readFile(pjson);
        const pj = JSON.parse(packageJSON);
        for (const section of ['dependencies', 'devDependencies']) {
          const deps = pj[section];
          if (deps) {
            for (const pkg of Object.keys(deps)) {
              const latest = versions.get(pkg);
              if (latest) {
                deps[pkg] = `^${latest}`;
              }
            }
          }
        }
        log.info(`updating ${pjson}`);
        await fs.writeFile(pjson, `${JSON.stringify(pj, null, 2)}\n`);
      }),
    );
    const sdkPackages = [...packages.values()].sort();
    for (const subdir of subdirs) {
      if (
        // eslint-disable-next-line no-await-in-loop
        await pspawn('yarn', [...linkFlags, ...sdkPackages], {
          stdio: 'inherit',
          cwd: subdir,
        })
      ) {
        log.error('Cannot yarn link', ...sdkPackages);
        return 1;
      }
    }
  } else {
    // Delete all old node_modules.
    await Promise.all(
      subdirs.map(subdir => {
        const nm = `${subdir}/node_modules`;
        log(chalk.bold.green(`removing ${nm}`));
        return rimraf(nm);
      }),
    );
  }

  if (await pspawn('yarn', [linkFlags[0], 'install'], { stdio: 'inherit' })) {
    // Try to install via Yarn.
    log.error('Cannot yarn install');
    return 1;
  }

  if (
    await pspawn('yarn', [linkFlags[0], 'install'], {
      stdio: 'inherit',
      cwd: 'ui',
    })
  ) {
    // Try to install via Yarn.
    log.warn('Cannot yarn install in ui directory');
    return 1;
  }

  log.info(chalk.bold.green('Done installing'));
  return 0;
}
