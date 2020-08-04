/* global harden */
// @ts-check

import {
  rethrowUnlessMissing,
  dataToBase64,
  base64ToBytes,
} from '@agoric/swingset-vat/src/vats/network';
import makeStore from '@agoric/store';
import { makePromiseKit } from '@agoric/promise-kit';
import { generateSparseInts } from '@agoric/sparse-ints';

import '@agoric/swingset-vat/src/vats/network/types';

import { makeWithQueue } from './queue';

const DEFAULT_PACKET_TIMEOUT = 1000;

// FIXME: IBC acks cannot be empty, as that deserialises to nil in Golang.
const DEFAULT_ACKNOWLEDGEMENT = '\x00';

// FIXME: this constitutes a security flaw, but is currently the
// only way to create channels.
const FIXME_ALLOW_NAIVE_RELAYS = true;

/**
 * @typedef {import('./bridge').BridgeHandler} BridgeHandler
 */

/**
 * @template U,V
 * @typedef {import('@agoric/promise-kit').PromiseRecord<U>} PromiseRecord
 */

/**
 * @template K,V
 * @typedef {import('@agoric/store').Store<K, V>} Store
 */

/**
 * @typedef {string} IBCPortID
 * @typedef {string} IBCChannelID
 * @typedef {string} IBCConnectionID
 */

/**
 * @typedef {Object} IBCPacket
 * @property {Bytes} [data]
 * @property {IBCChannelID} source_channel
 * @property {IBCPortID} source_port
 * @property {IBCChannelID} destination_channel
 * @property {IBCPortID} destination_port
 */

const goodLetters = 'abcdefghijklmnopqrstuvwxyz';
/**
 * Get a sequence of letters chosen from `goodLetters`.
 * @param {number} n
 */
function getGoodLetters(n) {
  let gl = '';
  do {
    gl += goodLetters[n % goodLetters.length];
    n = Math.floor(n / goodLetters.length);
  } while (n > 0);
  return gl;
}

let seed = 0;

/**
 * Create a handler for the IBC protocol, both from the network
 * and from the bridge.
 *
 * @param {import('@agoric/eventual-send').EProxy} E
 * @param {(method: string, params: any) => Promise<any>} callIBCDevice
 * @returns {ProtocolHandler & BridgeHandler} Protocol/Bridge handler
 */
export function makeIBCProtocolHandler(E, callIBCDevice) {
  /**
   * @type {Store<string, Promise<Connection>>}
   */
  const channelKeyToConnP = makeStore('CHANNEL:PORT');

  /**
   * @typedef {Object} Counterparty
   * @property {string} port_id
   * @property {string} channel_id
   *
   * @typedef {Object} ConnectingInfo
   * @property {'ORDERED'|'UNORDERED'} order
   * @property {string[]} connectionHops
   * @property {string} portID
   * @property {string} channelID
   * @property {Counterparty} counterparty
   * @property {string} version
   */

  /**
   * @type {Store<string, ConnectingInfo>}
   */
  const channelKeyToInfo = makeStore('CHANNEL:PORT');

  /**
   * @type {Store<string, PromiseRecord<[Endpoint, ConnectionHandler], any>>}
   */
  const channelKeyToOnConnectP = makeStore('CHANNEL:PORT');

  /**
   * @type {Store<string, Promise<InboundAttempt>>}
   */
  const channelKeyToAttemptP = makeStore('CHANNEL:PORT');

  /**
   * @type {Set<string>}
   */
  const usedChannels = new Set();

  seed += 1;
  const portSparseInts = generateSparseInts(seed);
  const channelSparseInts = generateSparseInts(seed * 2);

  function generateChannelID() {
    let channelID;
    for (;;) {
      const n = channelSparseInts.next().value;
      if (typeof n !== 'number') {
        throw Error(`internal: channelSparseInts is out of ints`);
      }

      // Need to begin with ten letters, or we get rejected.
      // FIXME: Onerous identifier constraints.
      channelID = `channelto${getGoodLetters(n)}`;
      if (!usedChannels.has(channelID)) {
        usedChannels.add(channelID);
        return channelID;
      }
    }
  }

  /**
   * @type {Store<string, Store<number, PromiseRecord<Bytes, any>>>}
   */
  const channelKeyToSeqAck = makeStore('CHANNEL:PORT');

  /**
   * Send a packet out via the IBC device.
   * @param {IBCPacket} packet
   * @param {Store<number, PromiseRecord<Bytes, any>>} seqToAck
   */
  async function ibcSendPacket(packet, seqToAck) {
    // Make a kernel call to do the send.
    const fullPacket = await callIBCDevice('sendPacket', {
      packet,
      relativeTimeout: DEFAULT_PACKET_TIMEOUT,
    });

    // Extract the actual sequence number from the return.
    const { sequence } = fullPacket;

    /**
     * @type {PromiseRecord<Bytes, any>}
     */
    const ackDeferred = makePromiseKit();

    // Register the ack resolver/rejector with this sequence number.
    seqToAck.init(sequence, ackDeferred);
    return ackDeferred.promise;
  }

  /**
   * @param {string} channelID
   * @param {string} portID
   * @param {string} rChannelID
   * @param {string} rPortID
   * @param {'ORDERED'|'UNORDERED'} order
   * @returns {ConnectionHandler}
   */
  function makeIBCConnectionHandler(
    channelID,
    portID,
    rChannelID,
    rPortID,
    order,
  ) {
    const channelKey = `${channelID}:${portID}`;
    const seqToAck = makeStore('SEQUENCE');
    channelKeyToSeqAck.init(channelKey, seqToAck);

    /**
     * @param {Connection} _conn
     * @param {Bytes} packetBytes
     * @param {ConnectionHandler} _handler
     * @returns {Promise<Bytes>} Acknowledgement data
     */
    let onReceive = async (_conn, packetBytes, _handler) => {
      // console.error(`Remote IBC Handler ${portID} ${channelID}`);
      const packet = {
        source_port: portID,
        source_channel: channelID,
        destination_port: rPortID,
        destination_channel: rChannelID,
        data: dataToBase64(packetBytes),
      };
      return ibcSendPacket(packet, seqToAck);
    };

    if (order === 'ORDERED') {
      // We set up a queue on the receiver to enforce ordering.
      const withChannelReceiveQueue = makeWithQueue();
      onReceive = withChannelReceiveQueue(onReceive);
    }

    return harden({
      async onOpen(conn, localAddr, remoteAddr, _handler) {
        console.debug(
          'onOpen Remote IBC Connection',
          channelID,
          portID,
          localAddr,
          remoteAddr,
        );
        const connP = E.when(conn);
        channelKeyToConnP.init(channelKey, connP);
      },
      onReceive,
      async onClose(_conn, _reason, _handler) {
        const packet = {
          source_port: portID,
          source_channel: channelID,
        };
        await callIBCDevice('channelCloseInit', { packet });
        const rejectReason = Error('Connection closed');
        for (const ackDeferred of seqToAck.values()) {
          ackDeferred.reject(rejectReason);
        }
        channelKeyToSeqAck.delete(channelKey);

        // TODO: Let's look carefully at this
        // There's a danger of the two sides disagreeing about whether
        // the channel is closed or not, and reusing channelIDs could
        // be a security hole.
        //
        // FIXME: Maybe check whether channelCloseConfirm is done.
        usedChannels.delete(channelID);
        usedChannels.delete(rChannelID);
      },
    });
  }

  /**
   * @param {string} localAddr
   */
  const localAddrToPortID = localAddr => {
    const m = localAddr.match(/^\/ibc-port\/(\w+)$/);
    if (!m) {
      throw TypeError(
        `Invalid port specification ${localAddr}; expected "/ibc-port/PORT"`,
      );
    }
    return m[1];
  };

  /**
   * @type {ProtocolImpl}
   */
  let protocolImpl;

  /**
   * @typedef {Object} ConnectedRecord
   * @property {string} channelID
   * @property {string} rChannelID
   * @property {typeof makeIBCConnectionHandler} connected
   */

  /**
   * @typedef {Object} OutboundCircuitRecord
   * @property {IBCConnectionID} dst
   * @property {'ORDERED'|'UNORDERED'} order
   * @property {string} version
   * @property {IBCPacket} packet
   * @property {PromiseRecord<ConnectionHandler, any>} deferredHandler
   */

  /**
   * @type {Store<Port, OutboundCircuitRecord[]>}
   */
  const portToCircuits = makeStore('Port');

  /**
   * @type {Store<Port, Set<PromiseRecord<ConnectionHandler,any>>>}
   */
  const portToPendingConns = makeStore('Port');

  /**
   * @type {ProtocolHandler}
   */
  const protocol = harden({
    async onCreate(impl, _protocolHandler) {
      console.debug('IBC onCreate');
      protocolImpl = impl;
    },
    async generatePortID(_localAddr, _protocolHandler) {
      const n = portSparseInts.next().value;
      if (!n) {
        throw Error(`internal: portSparseInts is out of ints`);
      }
      return `port${getGoodLetters(n)}`;
    },
    async onBind(port, localAddr, _protocolHandler) {
      const portID = localAddrToPortID(localAddr);
      portToCircuits.init(port, []);
      portToPendingConns.init(port, new Set());
      const packet = {
        source_port: portID,
      };
      return callIBCDevice('bindPort', { packet });
    },
    async onConnect(port, localAddr, remoteAddr, chandler, _protocolHandler) {
      console.debug('IBC onConnect', localAddr, remoteAddr);
      const portID = localAddrToPortID(localAddr);
      const pendingConns = portToPendingConns.get(port);

      const match = remoteAddr.match(
        /^(\/ibc-hop\/[^/]+)*\/ibc-port\/([^/]+)\/(ordered|unordered)\/([^/]+)$/s,
      );
      if (!match) {
        throw TypeError(
          `Remote address ${remoteAddr} must be '(/ibc-hop/CONNECTION)*/ibc-port/PORT/(ordered|unordered)/VERSION'`,
        );
      }

      const hops = [];
      let h = match[1];
      while (h) {
        const m = h.match(/^\/ibc-hop\/([^/]+)/);
        if (!m) {
          throw Error(
            `internal: ${JSON.stringify(h)} did not begin with "/ibc-hop/XXX"`,
          );
        }
        h = h.substr(m[0].length);
        hops.push(m[1]);
      }

      // Generate a circuit.
      const rPortID = match[2];
      const order = match[3] === 'ordered' ? 'ORDERED' : 'UNORDERED';
      const version = match[4];

      const channelID = generateChannelID();

      const onConnectP = makePromiseKit();

      // FIXME: The destination should be able to choose its own channelID.
      // (That would require sending it as part of channelOpenAck.)
      const rChannelID = generateChannelID();

      const channelKey = `${channelID}:${portID}`;
      pendingConns.add(onConnectP);
      channelKeyToOnConnectP.init(channelKey, onConnectP);
      channelKeyToInfo.init(channelKey, {
        channelID,
        portID,
        counterparty: { channel_id: rChannelID, port_id: rPortID },
        connectionHops: hops,
        order,
        version,
      });

      // Get any passive relayers to flow.
      const packet = {
        source_channel: channelID,
        source_port: portID,
        destination_channel: rChannelID,
        destination_port: rPortID,
      };

      await callIBCDevice('startChannelOpenInit', {
        packet,
        order,
        hops,
        version,
      });

      if (!FIXME_ALLOW_NAIVE_RELAYS || !chandler) {
        // Just wait until the connection handler resolves.
        return onConnectP.promise;
      }

      // We explain to the user how to configure a naive relayer.
      const q = JSON.stringify;
      E(
        /** @type {ConnectionHandler&{infoMessage?: (...args: any[]) => void}} */
        (chandler),
      )
        .infoMessage(
          `\
# Set up the relayer for this path:
ag-nchainz start-relayer <<'EOF'
{
  "src": {
    "connection-id": ${q(hops[0])},
    "channel-id": ${q(channelID)},
    "port-id": ${q(portID)},
    "order": ${q(order)},
    "version": ${q(version)}
  },
  "dst": {
    "channel-id": ${q(rChannelID)},
    "port-id": ${q(rPortID)},
    "order": ${q(order)}
  }
}
EOF
# then your connection will try to proceed.
`,
        )
        .catch(rethrowUnlessMissing);
      return onConnectP.promise;
    },
    async onListen(_port, localAddr, _listenHandler) {
      console.debug('IBC onListen', localAddr);
    },
    async onListenRemove(_port, localAddr, _listenHandler) {
      console.debug('IBC onListenRemove', localAddr);
    },
    async onRevoke(port, localAddr, _protocolHandler) {
      console.debug('IBC onRevoke', localAddr);
      const pendingConns = portToPendingConns.get(port);
      portToPendingConns.delete(port);
      portToCircuits.delete(port);
      const revoked = Error(`Port ${localAddr} revoked`);
      for (const onConnectP of pendingConns.values()) {
        onConnectP.reject(revoked);
      }
    },
  });

  return harden({
    ...protocol,
    async fromBridge(srcID, obj) {
      console.debug('IBC fromBridge', srcID, obj);
      switch (obj.event) {
        case 'channelOpenInit': {
          // This event is sent by a naive relayer that wants to initiate
          // a connection.  It is only honoured if we already have autonomously
          // attempted a connection.
          const {
            channelID,
            portID,
            counterparty: { port_id: rPortID },
            connectionHops: rHops,
          } = obj;

          const channelKey = `${channelID}:${portID}`;

          if (!channelKeyToOnConnectP.has(channelKey)) {
            // We're not waiting for an init, so throw.
            throw Error(`${channelKey}: did not expect channelOpenInit`);
          }

          // Continue the handshake.
          const chanInfo = channelKeyToInfo.get(channelKey);
          const {
            counterparty: { port_id: iPortID },
            connectionHops: iHops,
          } = chanInfo;
          if (iPortID !== rPortID) {
            throw Error(
              `${channelKey}: inbound port ${iPortID} is not ${rPortID}`,
            );
          }
          for (let i = 0; i < rHops.length; i += 1) {
            if (iHops[i] !== rHops[i]) {
              throw Error(
                `${channelKey}: inbound hops ${iHops.join(
                  ',',
                )} does not begin with ${rHops.join(',')}`,
              );
            }
          }

          // We have more specific information for the outbound connection.
          channelKeyToInfo.set(channelKey, { ...chanInfo, ...obj });
          break;
        }

        case 'attemptChannelOpenTry':
        case 'channelOpenTry': {
          // They're (more or less politely) asking if we are listening, so make an attempt.
          const {
            channelID,
            portID,
            counterparty: { port_id: rPortID, channel_id: rChannelID },
            connectionHops: hops,
            order,
            version,
            counterpartyVersion: rVersion,
          } = obj;

          const channelKey = `${channelID}:${portID}`;
          if (channelKeyToAttemptP.has(channelKey)) {
            // We have a pending attempt, so continue the handshake.
            break;
          }

          const versionSuffix = version ? `/${version}` : '';
          const localAddr = `/ibc-port/${portID}/${order.toLowerCase()}${versionSuffix}`;
          const ibcHops = hops.map(hop => `/ibc-hop/${hop}`).join('/');
          const remoteAddr = `${ibcHops}/ibc-port/${rPortID}/${order.toLowerCase()}/${rVersion}/ibc-channel/${rChannelID}`;

          // See if we allow an inbound attempt for this address pair (without rejecting).
          const attemptP = E(protocolImpl).inbound(localAddr, remoteAddr);

          // Tell what version string we negotiated.
          const attemptedLocal = await E(attemptP).getLocalAddress();
          const match = attemptedLocal.match(
            // Match:  ... /ORDER/VERSION ...
            new RegExp('^(/[^/]+/[^/]+)*/(ordered|unordered)/([^/]+)(/|$)'),
          );
          if (!match) {
            throw Error(
              `${channelKey}: cannot determine version from attempted local address ${attemptedLocal}`,
            );
          }
          const negotiatedVersion = match[3];

          channelKeyToAttemptP.init(channelKey, attemptP);
          channelKeyToInfo.init(channelKey, obj);

          try {
            if (obj.type === 'attemptChannelOpenTry') {
              // We can try to open with the version we wanted.
              const packet = {
                source_channel: channelID,
                source_port: portID,
                destination_channel: rChannelID,
                destination_port: rPortID,
              };

              await callIBCDevice('continueChannelOpenTry', {
                packet,
                order,
                hops,
                version: negotiatedVersion,
                counterpartyVersion: rVersion,
              });
            } else if (negotiatedVersion !== version) {
              // Too late; the relayer gave us a version we didn't like.
              throw Error(
                `${channelKey}: negotiated version was ${negotiatedVersion}; rejecting ${version}`,
              );
            }
          } catch (e) {
            // Clean up after our failed attempt.
            channelKeyToAttemptP.delete(channelKey);
            channelKeyToInfo.delete(channelKey);
            E(attemptP).close();
            throw e;
          }
          break;
        }

        case 'channelOpenAck': {
          // Complete the pending outbound connection.
          const { portID, channelID, counterpartyVersion: rVersion } = obj;
          const channelKey = `${channelID}:${portID}`;
          if (!channelKeyToOnConnectP.has(channelKey)) {
            throw Error(`${channelKey}: did not expect channelOpenAck`);
          }
          const onConnectP = channelKeyToOnConnectP.get(channelKey);
          channelKeyToOnConnectP.delete(channelKey);

          const {
            order,
            connectionHops: rHops,
            counterparty: { port_id: rPortID, channel_id: rChannelID },
          } = channelKeyToInfo.get(channelKey);
          channelKeyToInfo.delete(channelKey);

          // Finish the outbound connection.
          const ibcHops = rHops.map(hop => `/ibc-hop/${hop}`).join('/');
          const remoteAddr = `${ibcHops}/ibc-port/${rPortID}/${order.toLowerCase()}/${rVersion}`;
          const rchandler = makeIBCConnectionHandler(
            channelID,
            portID,
            rChannelID,
            rPortID,
            order,
          );
          onConnectP.resolve([remoteAddr, rchandler]);
          break;
        }

        case 'channelOpenConfirm': {
          const { portID, channelID } = obj;
          const channelKey = `${channelID}:${portID}`;
          if (!channelKeyToAttemptP.has(channelKey)) {
            throw Error(`${channelKey}: did not expect channelOpenConfirm`);
          }
          const attemptP = channelKeyToAttemptP.get(channelKey);
          channelKeyToAttemptP.delete(channelKey);

          // We have the information from our inbound connection, so complete it.
          const {
            order,
            counterparty: { port_id: rPortID, channel_id: rChannelID },
          } = channelKeyToInfo.get(channelKey);
          channelKeyToInfo.delete(channelKey);

          // Accept the attempt.
          const rchandler = makeIBCConnectionHandler(
            channelID,
            portID,
            rChannelID,
            rPortID,
            order,
          );
          E(attemptP).accept(rchandler);
          break;
        }

        case 'receivePacket': {
          const { packet } = obj;
          const {
            data: data64,
            destination_port: portID,
            destination_channel: channelID,
          } = packet;
          const channelKey = `${channelID}:${portID}`;
          const connP = channelKeyToConnP.get(channelKey);
          const data = base64ToBytes(data64);

          E(connP)
            .send(data)
            .then(ack => {
              const realAck = ack || DEFAULT_ACKNOWLEDGEMENT;
              const ack64 = dataToBase64(realAck);
              return callIBCDevice('packetExecuted', { packet, ack: ack64 });
            })
            .catch(e => console.error(e));
          break;
        }

        case 'acknowledgementPacket': {
          const { packet, acknowledgement } = obj;
          const {
            sequence,
            source_channel: channelID,
            source_port: portID,
          } = packet;
          const channelKey = `${channelID}:${portID}`;
          const seqToAck = channelKeyToSeqAck.get(channelKey);
          const ackDeferred = seqToAck.get(sequence);
          ackDeferred.resolve(base64ToBytes(acknowledgement));
          seqToAck.delete(sequence);
          break;
        }

        case 'timeoutPacket': {
          const { packet } = obj;
          const {
            sequence,
            source_channel: channelID,
            source_port: portID,
          } = packet;
          const channelKey = `${channelID}:${portID}`;
          const seqToAck = channelKeyToSeqAck.get(channelKey);
          const ackDeferred = seqToAck.get(sequence);
          ackDeferred.reject(Error(`Packet timed out`));
          seqToAck.delete(sequence);
          break;
        }

        case 'channelCloseInit':
        case 'channelCloseConfirm': {
          const { portID, channelID } = obj;
          const channelKey = `${channelID}:${portID}`;
          if (channelKeyToConnP.has(channelKey)) {
            const connP = channelKeyToConnP.get(channelKey);
            channelKeyToConnP.delete(channelKey);
            E(connP).close();
          }
          break;
        }

        case 'sendPacket': {
          const { packet } = obj;
          const { source_port: portID, source_channel: channelID } = packet;
          const channelKey = `${channelID}:${portID}`;
          const seqToAck = channelKeyToSeqAck.get(channelKey);
          ibcSendPacket(packet, seqToAck).then(
            ack => console.info('Manual packet', packet, 'acked:', ack),
            e => console.warn('Manual packet', packet, 'failed:', e),
          );
          break;
        }

        default:
          console.error('Unexpected IBC_EVENT', obj.event);
          // eslint-disable-next-line no-throw-literal
          throw TypeError(`unrecognized method ${obj.event}`);
      }
    },
  });
}
