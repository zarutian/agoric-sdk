/* global harden */
import { makeNotifierKit } from '@agoric/notifier';
import { E } from '@agoric/eventual-send';
import { getReplHandler } from './repl';
import { getCapTPHandler } from './captp';

// This vat contains the HTTP request handler.
export function buildRootObject(vatPowers) {
  const { D } = vatPowers;
  let commandDevice;
  const channelIdToHandle = new Map();
  const channelHandleToId = new WeakMap();
  let LOADING = harden(['agoric', 'wallet', 'local']);
  const {
    notifier: loadingNotifier,
    updater: loadingUpdater,
  } = makeNotifierKit(LOADING);

  const replObjects = {
    home: { LOADING },
    agoric: {},
    local: {},
  };

  let exportedToCapTP = {
    loadingNotifier,
  };
  function doneLoading(subsystems) {
    LOADING = LOADING.filter(subsys => !subsystems.includes(subsys));
    loadingUpdater.updateState(LOADING);
    if (LOADING.length) {
      replObjects.home.LOADING = LOADING;
    } else {
      delete replObjects.home.LOADING;
    }
  }

  const send = (obj, channelHandles) => {
    // TODO: Make this sane by adding support for multicast to the commandDevice.
    for (const channelHandle of channelHandles) {
      const channelID = channelHandleToId.get(channelHandle);
      if (channelID) {
        const o = { ...obj, meta: { channelID } };
        D(commandDevice).sendBroadcast(o);
      }
    }
  };

  const handler = {};
  const registeredURLHandlers = new Map();

  // TODO: Don't leak memory.
  async function registerURLHandler(newHandler, url) {
    const commandHandler = await E(newHandler).getCommandHandler();
    let reg = registeredURLHandlers.get(url);
    if (!reg) {
      reg = [];
      registeredURLHandlers.set(url, reg);
    }
    reg.push(commandHandler);
  }

  return harden({
    setCommandDevice(d) {
      commandDevice = d;

      const replHandler = getReplHandler(replObjects, send, vatPowers);
      registerURLHandler(replHandler, '/private/repl');

      // Assign the captp handler.
      // TODO: Break this out into a separate vat.
      const captpHandler = getCapTPHandler(
        send,
        // Harden only our exported objects, and fetch them afresh each time.
        () => harden(exportedToCapTP),
      );
      registerURLHandler(captpHandler, '/private/captp');
    },

    registerURLHandler,
    registerAPIHandler: h => registerURLHandler(h, '/api'),
    send,
    doneLoading,

    setWallet(wallet) {
      exportedToCapTP = {
        ...exportedToCapTP,
        local: { ...exportedToCapTP.local, wallet },
        wallet,
      };
      replObjects.local.wallet = wallet;
      replObjects.home.wallet = wallet;
    },

    setPresences(
      privateObjects,
      decentralObjects = undefined,
      handyObjects = undefined,
    ) {
      exportedToCapTP = {
        ...exportedToCapTP,
        ...decentralObjects, // TODO: Remove; replaced by .agoric
        ...privateObjects, // TODO: Remove; replaced by .local
        ...handyObjects,
        agoric: { ...decentralObjects },
        local: { ...privateObjects },
      };

      // We need to mutate the repl subobjects instead of replacing them.
      if (privateObjects) {
        Object.assign(replObjects.local, privateObjects);
        doneLoading(['local']);
      }

      if (decentralObjects) {
        Object.assign(replObjects.agoric, decentralObjects);
        doneLoading(['agoric']);
      }

      // TODO: Remove; home object is deprecated.
      if (decentralObjects) {
        Object.assign(
          replObjects.home,
          decentralObjects,
          privateObjects,
          handyObjects,
        );
      }
    },

    // devices.command invokes our inbound() because we passed to
    // registerInboundHandler()
    async inbound(count, rawObj) {
      console.debug(
        `vat-http.inbound (from browser) ${count}`,
        JSON.stringify(rawObj, undefined, 2),
      );

      const { type, meta: rawMeta = {} } = rawObj || {};
      const {
        url = '/private/repl',
        channelID: rawChannelID,
        dispatcher = 'onMessage',
      } = rawMeta;

      try {
        let channelHandle = channelIdToHandle.get(rawChannelID);
        if (dispatcher === 'onOpen') {
          channelHandle = harden({});
          channelIdToHandle.set(rawChannelID, channelHandle);
          channelHandleToId.set(channelHandle, rawChannelID);
        } else if (dispatcher === 'onClose') {
          channelIdToHandle.delete(rawChannelID);
          channelHandleToId.delete(channelHandle);
        }

        const obj = {
          ...rawObj,
        };
        delete obj.meta;

        const meta = {
          ...rawMeta,
          channelHandle,
        };
        delete meta.channelID;

        if (url === '/private/repl') {
          // Use our local handler object (compatibility).
          // TODO: standardise
          if (handler[type]) {
            D(commandDevice).sendResponse(
              count,
              false,
              await handler[type](obj, meta),
            );
            return;
          }
        }

        const urlHandlers = registeredURLHandlers.get(url);
        if (urlHandlers) {
          // todo fixme avoid the loop
          // For now, go from the end to beginning so that handlers
          // override.
          for (let i = urlHandlers.length - 1; i >= 0; i -= 1) {
            // eslint-disable-next-line no-await-in-loop
            const res = await E(urlHandlers[i])[dispatcher](obj, meta);

            if (res) {
              D(commandDevice).sendResponse(count, false, harden(res));
              return;
            }
          }
        }

        if (dispatcher === 'onMessage') {
          D(commandDevice).sendResponse(
            count,
            false,
            harden({ type: 'doesNotUnderstand', obj }),
          );
          throw Error(`No handler for ${url} ${type}`);
        }
        D(commandDevice).sendResponse(count, false, harden(true));
      } catch (rej) {
        console.debug(`Error ${dispatcher}:`, rej);
        const jsonable = (rej && rej.message) || rej;
        D(commandDevice).sendResponse(count, true, harden(jsonable));
      }
    },
  });
}
