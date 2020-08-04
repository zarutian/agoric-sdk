/* global harden */

import Nat from '@agoric/nat';

export function buildRootDeviceNode(tools) {
  const { SO, getDeviceState, setDeviceState, endowments } = tools;
  const {
    registerInboundCallback,
    deliverResponse,
    sendBroadcast,
  } = endowments;
  let { inboundHandler } = getDeviceState() || {};

  registerInboundCallback((count, bodyString) => {
    if (!inboundHandler) {
      throw new Error(
        `CMD inboundHandler not set before registerInboundHandler`,
      );
    }
    try {
      const body = JSON.parse(`${bodyString}`);
      SO(inboundHandler).inbound(Nat(count), body);
    } catch (e) {
      console.error(`error during inboundCallback:`, e);
      throw new Error(`error during inboundCallback: ${e}`);
    }
  });

  return harden({
    registerInboundHandler(handler) {
      inboundHandler = handler;
      setDeviceState(harden({ inboundHandler }));
    },

    sendResponse(count, isReject, obj) {
      try {
        deliverResponse(count, isReject, JSON.stringify(obj));
      } catch (e) {
        console.error(`error during sendResponse:`, e);
      }
    },

    sendBroadcast(obj) {
      try {
        sendBroadcast(JSON.stringify(obj));
      } catch (e) {
        console.error(`error during sendBroadcast:`, e);
      }
    },
  });
}
