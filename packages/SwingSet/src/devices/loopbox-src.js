/* global harden */

export function buildRootDeviceNode(tools) {
  const { SO } = tools;
  const inboundHandlers = harden(new Map());

  return harden({
    registerInboundHandler(name, handler) {
      if (inboundHandlers.has(name)) {
        throw new Error(`already registered`);
      }
      inboundHandlers.set(name, handler);
    },

    makeSender(sender) {
      let count = 1;
      return harden({
        add(peer, msgnum, body) {
          if (!inboundHandlers.has(peer)) {
            throw new Error(`unregistered peer '${peer}'`);
          }
          const h = inboundHandlers.get(peer);
          SO(h).deliverInboundMessages(sender, harden([[count, body]]));
          count += 1;
        },
        remove(_peer, _msgnum) {},
        ackInbound(_peer, _msgnum) {},
      });
    },
  });
}
