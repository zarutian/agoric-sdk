/* global harden */

import { assert, details } from '@agoric/assert';
import { E } from '@agoric/eventual-send';

// See ../../docs/delivery.md for a description of the architecture of the
// comms system.

// In order for a mailbox-using machine to glue together the three comms pieces
// (mailbox device, VatTP vat, comms vat) code like the following must be added
// to the bootstrap vat.
//
//   D(devices.mailbox).registerInboundHandler(vats.vattp);
//   E(vats.vattp).registerMailboxDevice(devices.mailbox);
//   const name = 'remote1';
//   const { transmitter, setReceiver } = await E(vats.vattp).addRemote(name);
//   const receiver = await E(vats.comms).addRemote(name, transmitter);
//   await E(setReceiver).setReceiver(receiver);
//   const receiver = await E(vats.comms).addRemote(name, transmitter);
//   await E(setReceiver).setReceiver(receiver);

export function buildRootObject(vatPowers) {
  const { D } = vatPowers;
  let mailbox; // mailbox device
  const remotes = new Map();
  // { outbound: { highestRemoved, highestAdded },
  //   inbound: { highestDelivered, receiver } }

  function getRemote(name) {
    if (!remotes.has(name)) {
      remotes.set(name, {
        outbound: { highestRemoved: 0, highestAdded: 0 },
        inbound: { highestDelivered: 0, receiver: null },
      });
    }
    return remotes.get(name);
  }

  const handler = harden({
    registerMailboxDevice(mailboxDevnode) {
      mailbox = mailboxDevnode;
    },

    addRemote(name) {
      assert(!remotes.has(name), details`already have remote ${name}`);
      const r = getRemote(name);
      const transmitter = harden({
        transmit(msg) {
          const o = r.outbound;
          const num = o.highestAdded + 1;
          // console.debug(`transmit to ${name}[${num}]: ${msg}`);
          D(mailbox).add(name, num, msg);
          o.highestAdded = num;
        },
      });
      const setReceiver = harden({
        setReceiver(newReceiver) {
          if (r.inbound.receiver) {
            throw new Error(`setReceiver is call-once`);
          }
          r.inbound.receiver = newReceiver;
        },
      });
      return harden({ transmitter, setReceiver });
    },

    deliverInboundMessages(name, newMessages) {
      const i = getRemote(name).inbound;
      newMessages.forEach(m => {
        const [num, body] = m;
        if (num > i.highestDelivered) {
          // TODO: SO() / sendOnly()
          // console.debug(`receive from ${name}[${num}]: ${body}`);
          E(i.receiver).receive(body);
          i.highestDelivered = num;
          D(mailbox).ackInbound(name, num);
        }
      });
    },

    deliverInboundAck(name, ack) {
      const o = getRemote(name).outbound;
      let num = o.highestRemoved + 1;
      while (num <= o.highestAdded && num <= ack) {
        D(mailbox).remove(name, num);
        o.highestRemoved = num;
        num += 1;
      }
    },
  });

  return handler;
}
