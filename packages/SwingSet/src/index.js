export { loadBasedir, buildVatController } from './controller.js';
export { buildMailboxStateMap, buildMailbox } from './devices/mailbox.js';
export { buildTimer } from './devices/timer.js';

export { buildStorageInMemory } from './hostStorage.js';
export { default as buildCommand } from './devices/command.js';

export function getVatTPSourcePath() {
  return require.resolve('./vats/vat-tp');
}

export function getCommsSourcePath() {
  return require.resolve('./vats/comms');
}

export function getTimerWrapperSourcePath() {
  return require.resolve('./vats/vat-timerWrapper');
}
