/* global harden */

// This javascript source file uses the "tildot" syntax (foo~.bar()) for
// eventual sends.
// https://agoric.com/documentation/ertp/guide/other-concepts.html
//  Tildot is standards track with TC39, the JavaScript standards committee.
// https://github.com/tc39/proposal-wavy-dot

console.log(`=> loading bootstrap.js`);

export function buildRootObject(vatPowers) {
  const { D } = vatPowers;
  console.log(`=> setup called`);
  return harden({
    async bootstrap(argv, vats, devices) {
      console.log('=> bootstrap() called');

      const BOT = 'bot';
      const USER = 'user';
      const BOT_CLIST_INDEX = 0;

      D(devices.loopbox).registerInboundHandler(USER, vats.uservattp);
      const usersender = D(devices.loopbox).makeSender(USER);
      await vats.uservattp~.registerMailboxDevice(usersender);
      await vats.usercomms~.init(vats.uservattp);

      D(devices.loopbox).registerInboundHandler(BOT, vats.botvattp);
      const botsender = D(devices.loopbox).makeSender(BOT);
      await vats.botvattp~.registerMailboxDevice(botsender);
      await vats.botcomms~.init(vats.botvattp);

      await vats.botcomms~.addEgress(
        USER,
        BOT_CLIST_INDEX, // this would normally be autogenerated
        vats.bot,
      );

      const pPBot = vats.usercomms~.addIngress(BOT, BOT_CLIST_INDEX);
      vats.user
        ~.talkToBot(pPBot, 'bot')
        .then(
          r =>
            console.log(
              `=> the promise given by the call to user.talkToBot resolved to '${r}'`,
            ),
          err =>
            console.log(
              `=> the promise given by the call to user.talkToBot was rejected '${err}''`,
            ),
        );
    },
  });
}
