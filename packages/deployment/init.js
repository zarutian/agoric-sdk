/* global process */
import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { assert, details as X } from '@agoric/assert';
import { SETUP_HOME, PLAYBOOK_WRAPPER, SETUP_DIR, SSH_TYPE } from './setup';
import {
  basename,
  chmod,
  createFile,
  exists,
  mkdir,
  readFile,
  resolve,
} from './files';
import { chdir, needDoRun, shellEscape } from './run';

const calculateTotal = placement =>
  (placement ? Object.values(placement) : []).reduce(
    (prior, cur) => prior + cur,
    0,
  );

const nodeCount = (count, force) => {
  if (count === 1) {
    return ` (${count} node)`;
  }
  if (count || force) {
    return ` (${count} nodes)`;
  }
  return '';
};

const tfStringify = obj => {
  let ret = '';
  if (Array.isArray(obj)) {
    let sep = '[';
    for (const el of obj) {
      ret += sep + tfStringify(el);
      sep = ',';
    }
    ret += ']';
  } else if (Object(obj) === obj) {
    let sep = '{';
    for (const key of Object.keys(obj).sort()) {
      ret += `${sep}${JSON.stringify(key)}=${tfStringify(obj[key])}`;
      sep = ',';
    }
    ret += '}';
  } else {
    ret = JSON.stringify(obj);
  }
  return ret;
};

const genericAskApiKey = async (provider, myDetails) => {
  const questions = [
    {
      name: 'API_KEYS',
      type: 'input',
      message: `API Key for ${provider.name}?`,
      default: myDetails.API_KEYS || process.env.DO_API_TOKEN,
      filter: key => key.trim(),
    },
  ];
  const ret = await inquirer.prompt(questions);
  if (!ret.API_KEYS) {
    return { CANCEL: true };
  }
  return ret;
};

const genericAskDatacenter = async (provider, PLACEMENT, dcs, placement) => {
  const questions = [];
  const count = nodeCount(calculateTotal(placement), true);
  const DONE = { name: `Done with ${PLACEMENT} placement${count}`, value: '' };
  if (dcs) {
    questions.push({
      name: 'DATACENTER',
      type: 'list',
      message: `Which ${PLACEMENT} datacenter${count}?`,
      choices: [DONE, ...dcs],
    });
  } else {
    questions.push({
      name: 'DATACENTER',
      type: 'input',
      message: `Which ${PLACEMENT} datacenter${count}?`,
      filter: dc => dc.trim(),
    });
  }

  const { DATACENTER } = await inquirer.prompt(questions);
  if (!DATACENTER) {
    return { MORE: false };
  }

  const { NUM_NODES } = await inquirer.prompt([
    {
      name: 'NUM_NODES',
      type: 'number',
      message: `Number of nodes for ${PLACEMENT} ${DATACENTER} (0 or more)?`,
      default: placement[DATACENTER] || 0,
      validate: num => Math.floor(num) === num && num >= 0,
    },
  ]);
  return { DATACENTER, NUM_NODES, MORE: true };
};

const DOCKER_DATACENTER = 'default';

const PROVIDERS = {
  docker: {
    name: 'Docker instances',
    value: 'docker',
    askDetails: async (_provider, _myDetails) => {
      let vspec = '/sys/fs/cgroup:/sys/fs/cgroup';
      if (process.env.DOCKER_VOLUMES) {
        vspec += `,${process.env.DOCKER_VOLUMES}`;
      }
      return {
        VOLUMES: vspec
          .split(',')
          .map(vol => vol.split(':'))
          // eslint-disable-next-line camelcase
          .map(([host_path, container_path]) => ({
            host_path,
            container_path,
          })),
      };
    },
    askDatacenter: async (provider, PLACEMENT, dcs, placement) => {
      const { NUM_NODES } = await inquirer.prompt([
        {
          name: 'NUM_NODES',
          type: 'number',
          message: `Number of nodes for ${PLACEMENT} (0 or more)?`,
          default: placement[DOCKER_DATACENTER] || 0,
          validate: num => Math.floor(num) === num && num >= 0,
        },
      ]);
      return {
        DATACENTER: DOCKER_DATACENTER,
        NUM_NODES,
        MORE: false,
      };
    },
    createPlacementFiles: (provider, PLACEMENT, PREFIX) =>
      createFile(
        `placement-${PLACEMENT}.tf`,
        `\
module "${PLACEMENT}" {
    source           = "${SETUP_DIR}/terraform/${provider.value}"
    CLUSTER_NAME     = "${PREFIX}\${var.NETWORK_NAME}-${PLACEMENT}"
    OFFSET           = "\${var.OFFSETS["${PLACEMENT}"]}"
    SSH_KEY_FILE     = "\${var.SSH_KEY_FILE}"
    SERVERS          = "\${length(var.DATACENTERS["${PLACEMENT}"])}"
    VOLUMES          = "\${var.VOLUMES["${PLACEMENT}"]}"
}
`,
      ),
  },
  digitalocean: {
    name: 'DigitalOcean https://cloud.digitalocean.com/',
    value: 'digitalocean',
    askDetails: genericAskApiKey,
    askDatacenter: genericAskDatacenter,
    datacenters: async (provider, PLACEMENT, DETAILS) => {
      const { API_KEYS: apikey } = DETAILS;
      const res = await fetch('https://api.digitalocean.com/v2/regions', {
        headers: { Authorization: `Bearer ${apikey}` },
      });
      const json = await res.json();
      if (!json.regions) {
        console.error(`Cannot retrieve digitalocean regions:`, json);
        return [];
      }
      return json.regions.map(r => ({
        name: `${r.slug} - ${r.name}`,
        value: r.slug,
      }));
    },
    createPlacementFiles: (provider, PLACEMENT, PREFIX) =>
      createFile(
        `placement-${PLACEMENT}.tf`,
        `\
module "${PLACEMENT}" {
    source           = "${SETUP_DIR}/terraform/${provider.value}"
    CLUSTER_NAME     = "${PREFIX}\${var.NETWORK_NAME}-${PLACEMENT}"
    OFFSET           = "\${var.OFFSETS["${PLACEMENT}"]}"
    REGIONS          = "\${var.DATACENTERS["${PLACEMENT}"]}"
    SSH_KEY_FILE     = "\${var.SSH_KEY_FILE}"
    DO_API_TOKEN     = "\${var.API_KEYS["${PLACEMENT}"]}"
    SERVERS          = "\${length(var.DATACENTERS["${PLACEMENT}"])}"
}
`,
      ),
  },
};

const askPlacement = PLACEMENTS => {
  let total = 0;
  PLACEMENTS.forEach(
    ([_PLACEMENT, placement]) => (total += calculateTotal(placement)),
  );
  const count = nodeCount(total, true);
  const DONE = { name: `Done with allocation${count}`, value: '' };
  const NEW = { name: `Initialize new placement`, value: 'NEW' };

  const questions = [
    {
      name: 'PLACEMENT',
      type: 'list',
      message: `Where would you like to allocate nodes${count}?`,
      choices: [
        DONE,
        NEW,
        ...PLACEMENTS.map(([place, placement]) => ({
          name: `${place}${nodeCount(calculateTotal(placement))}`,
          value: place,
        })),
      ],
    },
  ];
  return inquirer.prompt(questions);
};

const askProvider = () => {
  const DONE = { name: `Return to allocation menu`, value: '' };
  const questions = [
    {
      name: 'PROVIDER',
      type: 'list',
      message: `For what provider would you like to create a new placement?`,
      choices: [
        DONE,
        ...Object.values(PROVIDERS).sort((nva, nvb) => {
          if (nva.name < nvb.name) {
            return -1;
          }
          if (nva.name === nvb.name) {
            return 0;
          }
          return 1;
        }),
      ],
    },
  ];
  return inquirer.prompt(questions);
};

const doInit = async (progname, args) => {
  let [dir, overrideNetworkName] = args.slice(1);
  if (!dir) {
    dir = SETUP_HOME;
  }
  assert(dir, X`Need: [dir] [[network name]]`);

  const adir = resolve(process.cwd(), dir);
  const networkTxt = `${adir}/network.txt`;
  if (await exists(networkTxt)) {
    overrideNetworkName = (await readFile(networkTxt, 'utf-8')).trimEnd();
  }

  if (!overrideNetworkName) {
    overrideNetworkName = process.env.NETWORK_NAME;
  }
  if (!overrideNetworkName) {
    overrideNetworkName = basename(dir);
  }

  // Gather saved information.
  const deploymentJson = `${adir}/deployment.json`;
  const config = (await exists(deploymentJson))
    ? JSON.parse(await readFile(deploymentJson, 'utf-8'))
    : {
        PLACEMENTS: [],
        PLACEMENT_PROVIDER: {},
        SSH_PRIVATE_KEY_FILE: `id_${SSH_TYPE}`,
        DETAILS: {},
        OFFSETS: {},
        DATACENTERS: {},
        PROVIDER_NEXT_INDEX: {},
      };
  config.NETWORK_NAME = overrideNetworkName;

  let instance = 0;
  try {
    await mkdir(dir);
  } catch (e) {
    // ignore
  }
  await chdir(dir);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    let { PLACEMENT } = await askPlacement(config.PLACEMENTS);
    if (!PLACEMENT) {
      break;
    }
    let provider;
    let myDetails = {};
    if (PLACEMENT !== 'NEW') {
      const PROVIDER = config.PLACEMENT_PROVIDER[PLACEMENT];
      provider = PROVIDERS[PROVIDER];
    } else {
      // eslint-disable-next-line no-await-in-loop
      const { PROVIDER } = await askProvider();
      if (!PROVIDER) {
        // eslint-disable-next-line no-continue
        continue;
      }
      provider = PROVIDERS[PROVIDER];

      const setPlacement = () => {
        const idx = config.PROVIDER_NEXT_INDEX;
        if (!idx[PROVIDER]) {
          idx[PROVIDER] = 0;
        }
        idx[PROVIDER] += 1;
        PLACEMENT = `${PROVIDER}${idx[PROVIDER]}`;
        config.PLACEMENT_PROVIDER[PLACEMENT] = PROVIDER;
      };

      if (provider.askDetails) {
        // eslint-disable-next-line no-await-in-loop
        const { CANCEL, ...PLACEMENT_DETAILS } = await provider.askDetails(
          provider,
          myDetails,
        );
        if (CANCEL) {
          // eslint-disable-next-line no-continue
          continue;
        }
        // Out with the old, in with the new.
        setPlacement();
        for (const vname of Object.keys(myDetails)) {
          delete config.DETAILS[vname][PLACEMENT];
        }
        myDetails = PLACEMENT_DETAILS;
        for (const vname of Object.keys(myDetails)) {
          if (!config.DETAILS[vname]) {
            config.DETAILS[vname] = {};
          }
          config.DETAILS[vname][PLACEMENT] = PLACEMENT_DETAILS[vname];
        }
      } else {
        setPlacement();
      }
    }

    const dcs =
      provider.datacenters &&
      // eslint-disable-next-line no-await-in-loop
      (await provider.datacenters(provider, PLACEMENT, myDetails));
    const [_p, placement] = config.PLACEMENTS.find(
      ([p]) => p === PLACEMENT,
    ) || [PLACEMENT, {}];
    if (dcs) {
      // Add our choices to the list.
      const already = { ...placement };
      dcs.forEach(nv => delete already[nv.value]);
      Object.entries(already).forEach(([dc]) => {
        dcs.push({ name: dc, value: dc });
      });
      dcs.sort((nva, nvb) => {
        if (nva.name < nvb.name) {
          return -1;
        }
        if (nva.name === nvb.name) {
          return 0;
        }
        return 1;
      });
    }

    // Allocate the datacenters.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const dcsWithNodeCount =
        dcs &&
        dcs.map(nv => {
          const ret = { ...nv };
          const num = placement[nv.value] || 0;
          if (num === 1) {
            ret.name += ` (${num} node)`;
          } else if (num) {
            ret.name += ` (${num} nodes)`;
          }
          return ret;
        });
      // eslint-disable-next-line no-await-in-loop
      const { DATACENTER, NUM_NODES, MORE } = await provider.askDatacenter(
        provider,
        PLACEMENT,
        dcsWithNodeCount,
        placement,
      );
      if (NUM_NODES) {
        placement[DATACENTER] = NUM_NODES;
      } else {
        delete placement[DATACENTER];
      }
      if (!MORE) {
        break;
      }
    }
    config.PLACEMENTS.push([PLACEMENT, placement]);
  }

  // Collate the placement information.
  for (const [PLACEMENT, placement] of config.PLACEMENTS) {
    const offset = instance;
    config.DATACENTERS[PLACEMENT] = [];
    for (const dc of Object.keys(placement).sort()) {
      const nodes = [];
      for (let i = 0; i < placement[dc]; i += 1) {
        instance += 1;
        nodes.push(dc);
      }
      if (nodes.length !== 0) {
        config.DATACENTERS[PLACEMENT].push(...nodes);
      }
    }

    if (instance === offset) {
      // No nodes added.
      // eslint-disable-next-line no-continue
      continue;
    }

    // Commit the final details.
    config.OFFSETS[PLACEMENT] = offset;
  }

  assert(instance !== 0, X`Aborting due to no nodes configured!`);

  await createFile(
    `vars.tf`,
    `\
# Terraform configuration generated by "${progname} init"

variable "NETWORK_NAME" {
  default = "${config.NETWORK_NAME}"
}

variable "SSH_KEY_FILE" {
  default = "${config.SSH_PRIVATE_KEY_FILE}.pub"
}

variable "DATACENTERS" {
  default = ${tfStringify(config.DATACENTERS)}
}

variable "OFFSETS" {
  default = ${tfStringify(config.OFFSETS)}
}

${Object.keys(config.DETAILS)
  .sort()
  .map(
    vname => `\
variable ${JSON.stringify(vname)} {
  default = ${tfStringify(config.DETAILS[vname])}
}
`,
  )
  .join('\n')}
`,
  );

  // Go and create the specific files.
  const clusterPrefix = 'ag-chain-cosmos-';
  for (const PLACEMENT of Object.keys(config.PLACEMENT_PROVIDER).sort()) {
    const PROVIDER = config.PLACEMENT_PROVIDER[PLACEMENT];
    const provider = PROVIDERS[PROVIDER];
    // eslint-disable-next-line no-await-in-loop
    await provider.createPlacementFiles(provider, PLACEMENT, clusterPrefix);
  }

  await createFile(
    `outputs.tf`,
    `\
output "public_ips" {
  value = {
${Object.keys(config.DATACENTERS)
  .sort()
  .map(p => `    ${p} = "\${module.${p}.public_ips}"`)
  .join('\n')}
  }
}

output "offsets" {
  value = "\${var.OFFSETS}"
}
`,
  );

  const keyFile = resolve(adir, config.SSH_PRIVATE_KEY_FILE);
  if (!(await exists(keyFile))) {
    // Set empty password.
    await needDoRun(['ssh-keygen', '-N', '', '-t', SSH_TYPE, '-f', keyFile]);
  }

  await createFile(
    PLAYBOOK_WRAPPER,
    `\
#! /bin/sh
exec ansible-playbook -f10 \\
  -eSETUP_HOME=${shellEscape(process.cwd())} \\
  -eNETWORK_NAME=\`cat ${shellEscape(resolve('network.txt'))}\` \\
  \${1+"$@"}
`,
  );
  await chmod(PLAYBOOK_WRAPPER, '0755');

  await createFile(
    `ansible.cfg`,
    `\
[defaults]
inventory = ./provision/hosts
deprecation_warnings = False

[ssh_connection]
ssh_args = -oForwardAgent=yes -oUserKnownHostsFile=provision/ssh_known_hosts -oControlMaster=auto -oControlPersist=30m
pipelining = True
`,
  );

  // Persist data for later.
  await createFile(deploymentJson, JSON.stringify(config, undefined, 2));
  await createFile(networkTxt, config.NETWORK_NAME);
};

export default doInit;
