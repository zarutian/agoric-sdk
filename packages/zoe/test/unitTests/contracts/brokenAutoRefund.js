// @ts-check

/**
 * This is a a broken contact to test zoe's error handling
 * @type {ContractStartFn}
 */
const start = zcf => {
  const refund = seat => {
    seat.exit();
    return `The offer was accepted`;
  };
  const makeRefundInvitation = () => zcf.makeInvitation(refund, 'getRefund');
  // should be makeRefundInvitation(). Intentionally wrong to provoke an error.
  return { creatorInvitation: makeRefundInvitation };
};

harden(start);
export { start };
