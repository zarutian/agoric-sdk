
/* global harden */
import { E } from "@agoric/eventual-send";

const makeConditionor = (timerService, zoeService) => {
  const onTrue   = (condition, callback) => {};
  const onChange = (condition, callback) => {};
  return harden({ onTrue, onChange });
}

export default makeConditionor;
