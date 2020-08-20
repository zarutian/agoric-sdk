import { assert, details, q } from '@agoric/assert';
import { E } from '@agoric/eventual-send';

/**
 * Makes the appropriate exitObj, which runs in ZCF and allows the seat's owner
 * to request the position be exited.
 */

/** @type MakeExitObj */
export const makeExitObj = (proposal, zoeSeatAdmin, zcfSeatAdmin) => {
  const [exitKind] = Object.getOwnPropertyNames(proposal.exit);

  /** @type {ExitObj} */
  let exitObj = harden({
    exit: () => {
      throw new Error(
        `Only seats with the exitKind "onDemand" can exit at will`,
      );
    },
  });

  const exitFn = () => {
    zcfSeatAdmin.updateHasExited();
    return E(zoeSeatAdmin).exit();
  };

  if (exitKind === 'afterDeadline') {
    // Automatically exit the seat after deadline.
    E(proposal.exit.afterDeadline.timer).setWakeup(
      proposal.exit.afterDeadline.deadline,
      harden({
        wake: exitFn,
      }),
    );
  } else if (exitKind === 'onDemand') {
    // Allow the user to exit their seat on demand. Note: we must wrap
    // it in an object to send it back to Zoe because our marshalling layer
    // only allows two kinds of objects: records (no methods and only
    // data) and presences (local proxies for objects that may have
    // methods).
    exitObj = {
      exit: exitFn,
    };
  } else {
    // if exitKind is 'waived' the user has no ability to exit their seat
    // on demand
    assert(
      exitKind === 'waived',
      details`exit kind was not recognized: ${q(exitKind)}`,
    );
  }
  return exitObj;
};
