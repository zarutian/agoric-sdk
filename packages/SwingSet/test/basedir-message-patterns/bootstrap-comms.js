/* global harden */
import { E } from '@agoric/eventual-send';

export function buildRootObject(vatPowers) {
  const { D } = vatPowers;
  return harden({
    async bootstrap(argv, vats, devices) {
      // setup
      const LEFT = 'left'; // for vat A
      const RIGHT = 'right'; // for vat B

      D(devices.loopbox).registerInboundHandler(LEFT, vats.leftvattp);
      const leftsender = D(devices.loopbox).makeSender(LEFT);
      await E(vats.leftvattp).registerMailboxDevice(leftsender);

      const {
        transmitter: txToRightForLeft,
        setReceiver: setRxFromRightForLeft,
      } = await E(vats.leftvattp).addRemote(RIGHT);
      await E(vats.leftcomms).addRemote(
        RIGHT,
        txToRightForLeft,
        setRxFromRightForLeft,
      );

      D(devices.loopbox).registerInboundHandler(RIGHT, vats.rightvattp);
      const rightsender = D(devices.loopbox).makeSender(RIGHT);
      await E(vats.rightvattp).registerMailboxDevice(rightsender);

      const {
        transmitter: txToLeftForRight,
        setReceiver: setRxFromLeftForRight,
      } = await E(vats.rightvattp).addRemote(LEFT);
      await E(vats.rightcomms).addRemote(
        LEFT,
        txToLeftForRight,
        setRxFromLeftForRight,
      );

      // get B set up
      const { bob, bert } = await E(vats.b).init();

      const BOB_INDEX = 12;
      const BERT_INDEX = 13;

      await E(vats.rightcomms).addEgress(LEFT, BOB_INDEX, bob);
      const aBob = await E(vats.leftcomms).addIngress(RIGHT, BOB_INDEX);

      await E(vats.rightcomms).addEgress(LEFT, BERT_INDEX, bert);
      const aBert = await E(vats.leftcomms).addIngress(RIGHT, BERT_INDEX);

      // eslint-disable-next-line no-unused-vars
      const a = await E(vats.a).init(aBob, aBert);
      const which = argv[0];
      await E(vats.a).run(which);
    },
  });
}
