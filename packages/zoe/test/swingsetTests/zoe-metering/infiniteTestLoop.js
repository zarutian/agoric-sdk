import harden from '@agoric/harden';

export const makeContract = zcf => {
  const invite = zcf.makeInvitation(() => {}, 'tester');
  zcf.updatePublicAPI(
    harden({
      doTest: () => {
        for (;;) {
          // Nothing
        }
      },
    }),
  );
  return harden(invite);
};
