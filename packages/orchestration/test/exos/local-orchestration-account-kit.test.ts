import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';

import { AmountMath } from '@agoric/ertp';
import { eventLoopIteration } from '@agoric/internal/src/testing-utils.js';
import { heapVowE as VE } from '@agoric/vow/vat.js';
import { TargetApp } from '@agoric/vats/src/bridge-target.js';
import { SIMULATED_ERRORS } from '@agoric/vats/tools/fake-bridge.js';
import { ChainAddress, type AmountArg } from '../../src/orchestration-api.js';
import { NANOSECONDS_PER_SECOND } from '../../src/utils/time.js';
import { commonSetup } from '../supports.js';
import { UNBOND_PERIOD_SECONDS } from '../ibc-mocks.js';
import { maxClockSkew } from '../../src/utils/cosmos.js';
import { prepareMakeTestLOAKit } from './make-test-loa-kit.js';
import { buildVTransferEvent } from '../../tools/ibc-mocks.js';

test('deposit, withdraw', async t => {
  const common = await commonSetup(t);
  const makeTestLOAKit = prepareMakeTestLOAKit(t, common.bootstrap);
  const account = await makeTestLOAKit();

  const {
    brands: { bld: stake },
    utils,
  } = common;

  const oneHundredStakePmt = await utils.pourPayment(stake.units(100));

  t.log('deposit 100 bld to account');
  await VE(account).deposit(oneHundredStakePmt);
  // FIXME #9211
  // t.deepEqual(await E(account).getBalance('ubld'), stake.units(100));

  // XXX races in the bridge
  await eventLoopIteration();
  const withdrawal1 = await VE(account).withdraw(stake.units(50));
  t.true(
    AmountMath.isEqual(
      await stake.issuer.getAmountOf(withdrawal1),
      stake.units(50),
    ),
  );

  await t.throwsAsync(
    VE(account).withdraw(stake.units(51)),
    undefined,
    'fails to overwithdraw',
  );
  await t.notThrowsAsync(
    VE(account).withdraw(stake.units(50)),
    'succeeeds at exactly empty',
  );
  await t.throwsAsync(
    VE(account).withdraw(stake.make(1n)),
    undefined,
    'fails to overwithdraw',
  );
});

test('delegate, undelegate', async t => {
  const common = await commonSetup(t);
  const makeTestLOAKit = prepareMakeTestLOAKit(t, common.bootstrap);
  const account = await makeTestLOAKit();

  const {
    bootstrap: { timer },
    brands: { bld },
    utils,
  } = common;

  await VE(account).deposit(await utils.pourPayment(bld.units(100)));

  const validatorAddress = 'agoric1validator1';

  // Because the bridge is fake,
  // 1. these succeed even if funds aren't available
  // 2. there are no return values
  // 3. there are no side-effects such as assets being locked
  await VE(account).delegate(validatorAddress, bld.units(999));
  const undelegateP = VE(account).undelegate(validatorAddress, bld.units(999));
  const completionTime = UNBOND_PERIOD_SECONDS + maxClockSkew;

  const notTooSoon = Promise.race([
    timer.wakeAt(completionTime - 1n).then(() => true),
    undelegateP,
  ]);
  timer.advanceTo(completionTime, 'end of unbonding period');
  t.true(await notTooSoon, "undelegate doesn't resolve before completion_time");
  t.is(
    await undelegateP,
    undefined,
    'undelegate returns void after completion_time',
  );
});

test('transfer', async t => {
  const common = await commonSetup(t);
  const makeTestLOAKit = prepareMakeTestLOAKit(t, common.bootstrap);
  const account = await makeTestLOAKit();

  const { value: sender } = await VE(account).getAddress();

  const {
    brands: { bld: stake },
    mocks: { transferBridge },
    utils,
  } = common;

  t.truthy(account, 'account is returned');

  const oneHundredStakePmt = await utils.pourPayment(stake.units(100));

  t.log('deposit 100 bld to account');
  await VE(account).deposit(oneHundredStakePmt);
  // FIXME #9211
  // t.deepEqual(await E(account).getBalance('ubld'), stake.units(100));

  const destination: ChainAddress = {
    chainId: 'cosmoshub-4',
    value: 'cosmos1pleab',
    encoding: 'bech32',
  };
  const sourceChannel = 'channel-1'; // observed in toBridge VLOCALCHAIN_EXECUTE_TX sourceChannel

  // TODO rename to lastSequence
  /** The running tally of transfer messages that were sent over the bridge */
  let sequence = 0n;
  /**
   * Helper to start the transfer without awaiting the result. It await the
   * event loop so the promise starts and increments sequence for use in the
   * acknowledgementPacket bridge message and wants
   * @param amount
   * @param dest
   * @param opts
   */
  const startTransfer = async (
    amount: AmountArg,
    dest: ChainAddress,
    opts = {},
  ) => {
    const transferP = VE(account).transfer(amount, dest, opts);
    sequence += 1n;
    // Ensure the toBridge of the transferP happens before the fromBridge is awaited after this function returns
    await eventLoopIteration();
    return { transferP };
  };

  // TODO #9211, support ERTP amounts
  t.log('ERTP Amounts not yet supported for AmountArg');
  await t.throwsAsync(() => VE(account).transfer(stake.units(1), destination), {
    message: 'ERTP Amounts not yet supported',
  });

  t.log('.transfer() 1 bld to cosmos using DenomAmount');
  const { transferP } = await startTransfer(
    { denom: 'ubld', value: 1_000_000n },
    destination,
  );
  t.is(await Promise.race([transferP, 'not yet']), 'not yet');

  // simulate incoming message so that the transfer promise resolves
  await VE(transferBridge).fromBridge(
    buildVTransferEvent({
      receiver: destination.value,
      sender,
      sourceChannel,
      sequence,
    }),
  );

  const transferRes = await transferP;
  t.true(
    transferRes === undefined,
    'Successful transfer returns Promise<void>.',
  );

  await t.throwsAsync(
    (
      await startTransfer(
        { denom: 'ubld', value: SIMULATED_ERRORS.TIMEOUT },
        destination,
      )
    ).transferP,
    {
      message: 'simulated unexpected MsgTransfer packet timeout',
    },
  );

  const unknownDestination: ChainAddress = {
    chainId: 'fakenet',
    value: 'fakenet1pleab',
    encoding: 'bech32',
  };
  // XXX dev has to know not to startTransfer here
  await t.throwsAsync(
    VE(account).transfer({ denom: 'ubld', value: 1n }, unknownDestination),
    { message: /connection not found: agoriclocal<->fakenet/ },
    'cannot create transfer msg with unknown chainId',
  );

  /**
   * Helper to start the transfer AND send the ack packet so this promise can be awaited
   * @param amount
   * @param dest
   * @param opts
   */
  const doTransfer = async (
    amount: AmountArg,
    dest: ChainAddress,
    opts = {},
  ) => {
    const { transferP: promise } = await startTransfer(amount, dest, opts);
    // simulate incoming message so that promise resolves
    await VE(transferBridge).fromBridge(
      buildVTransferEvent({
        receiver: dest.value,
        sender,
        sourceChannel,
        sequence,
      }),
    );
    return promise;
  };

  await t.notThrowsAsync(
    doTransfer({ denom: 'ubld', value: 10n }, destination, {
      memo: 'hello',
    }),
    'can create transfer msg with memo',
  );
  // TODO, intercept/spy the bridge message to see that it has a memo

  await t.notThrowsAsync(
    doTransfer({ denom: 'ubld', value: 10n }, destination, {
      // sets to current time, which shouldn't work in a real env
      timeoutTimestamp: BigInt(new Date().getTime()) * NANOSECONDS_PER_SECOND,
    }),
    'accepts custom timeoutTimestamp',
  );

  await t.notThrowsAsync(
    doTransfer({ denom: 'ubld', value: 10n }, destination, {
      timeoutHeight: { revisionHeight: 100n, revisionNumber: 1n },
    }),
    'accepts custom timeoutHeight',
  );
});

test('monitor transfers', async t => {
  const common = await commonSetup(t);
  const makeTestLOAKit = prepareMakeTestLOAKit(t, common.bootstrap);
  const account = await makeTestLOAKit();
  const {
    mocks: { transferBridge },
    bootstrap: { rootZone },
  } = common;

  let upcallCount = 0;
  const zone = rootZone.subZone('tap');
  const tap: TargetApp = zone.exo('tap', undefined, {
    receiveUpcall: (obj: unknown) => {
      upcallCount += 1;
      t.log('receiveUpcall', obj);
      return Promise.resolve();
    },
  });

  const { value: target } = await VE(account).getAddress();
  // XXX let the PacketTools subscribeToTransfers complete before triggering it
  // again with monitorTransfers
  await eventLoopIteration();

  const appRegistration = await VE(account).monitorTransfers(tap);

  // simulate upcall from golang to VM
  const simulateIncomingTransfer = async () =>
    VE(transferBridge).fromBridge(
      buildVTransferEvent({
        receiver: target,
      }),
    );

  await simulateIncomingTransfer();
  t.is(upcallCount, 1, 'first upcall received');
  await simulateIncomingTransfer();
  t.is(upcallCount, 2, 'second upcall received');

  await appRegistration.revoke();
  await simulateIncomingTransfer();
  t.is(upcallCount, 2, 'no more events after app is revoked');
});

test('send', async t => {
  const {
    bootstrap,
    brands: { bld: stake, ist: stable },
    utils: { pourPayment, inspectLocalBridge },
  } = await commonSetup(t);
  const makeTestLOAKit = prepareMakeTestLOAKit(t, bootstrap);
  const account = await makeTestLOAKit();
  t.truthy(account, 'account is returned');

  const oneHundredStakePmt = await pourPayment(stake.units(100));
  const oneHundredStablePmt = await pourPayment(stable.units(100));
  t.log('deposit 100 bld to account');
  await VE(account).deposit(oneHundredStakePmt);
  t.log('deposit 100 ist to account');
  await VE(account).deposit(oneHundredStablePmt);

  const toAddress = {
    value: 'agoric1EOAAccAddress',
    chainId: 'agoriclocal',
    encoding: 'bech32' as const,
  };

  t.log(`send 10 bld to ${toAddress.value}`);
  await t.throwsAsync(VE(account).send(toAddress, stake.units(10)), {
    message: 'Brands not currently supported.',
  });
  await VE(account).send(toAddress, { denom: 'ubld', value: 10_000_000n });

  // this would normally fail since we do not have ibc/1234 in our wallet,
  // but the mocked localchain bridge doesn't currently know about balances
  t.log(`send 10 ibc/1234 (not in vbank) to ${toAddress.value}`);
  await VE(account).send(toAddress, { denom: 'ibc/1234', value: 10n });

  await t.throwsAsync(
    VE(account).send(toAddress, {
      denom: 'ibc/400',
      value: SIMULATED_ERRORS.BAD_REQUEST,
    }),
    {
      message: 'simulated error',
    },
  );

  t.log(`send 10 bld and 10 ist to ${toAddress.value} via sendAll`);
  await VE(account).sendAll(toAddress, [
    { denom: 'ubld', value: 10_000_000n },
    { denom: 'uist', value: 10_000_000n },
  ]);

  const messages = await inspectLocalBridge();
  const executedBankSends = messages.filter(
    m =>
      m.type === 'VLOCALCHAIN_EXECUTE_TX' &&
      m.messages?.[0]?.['@type'] === '/cosmos.bank.v1beta1.MsgSend',
  );
  t.is(
    executedBankSends.length,
    4,
    'sent 2 successful txs and 1 failed. 1 rejected before sending',
  );
});
