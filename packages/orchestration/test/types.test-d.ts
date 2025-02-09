/**
 * @file pure types types, no runtime, ignored by Ava
 */

import { expectNotType, expectType } from 'tsd';
import { typedJson } from '@agoric/cosmic-proto';
import type { MsgDelegateResponse } from '@agoric/cosmic-proto/cosmos/staking/v1beta1/tx.js';
import type { QueryAllBalancesResponse } from '@agoric/cosmic-proto/cosmos/bank/v1beta1/query.js';
import type { Vow, VowTools } from '@agoric/vow';
import type { GuestAsyncFunc, HostInterface, HostOf } from '@agoric/async-flow';
import type { ResolvedPublicTopic } from '@agoric/zoe/src/contractSupport/topics.js';
import type {
  ChainAddress,
  CosmosValidatorAddress,
  StakingAccountActions,
  OrchestrationAccount,
  Orchestrator,
  Chain,
  ChainInfo,
} from '../src/types.js';
import type { LocalOrchestrationAccountKit } from '../src/exos/local-orchestration-account.js';
import { prepareCosmosOrchestrationAccount } from '../src/exos/cosmos-orchestration-account.js';
import type { OrchestrationFacade } from '../src/facade.js';
import type { ResolvedContinuingOfferResult } from '../src/utils/zoe-tools.js';

const anyVal = null as any;

const vt: VowTools = null as any;

const validatorAddr = {
  chainId: 'agoric3',
  value: 'agoric1valoperhello',
  encoding: 'bech32',
} as const;
expectType<CosmosValidatorAddress>(validatorAddr);

const chainAddr = {
  chainId: 'agoric-3',
  value: 'agoric1pleab',
  encoding: 'bech32',
} as const;
expectType<ChainAddress>(chainAddr);
expectNotType<CosmosValidatorAddress>(chainAddr);

{
  // @ts-expect-error
  const notVa: CosmosValidatorAddress = chainAddr;
}

{
  const lcak: LocalOrchestrationAccountKit = null as any;
  const results = await lcak.holder.executeTx([
    typedJson('/cosmos.staking.v1beta1.MsgDelegate', {
      amount: {
        amount: '1',
        denom: 'ubld',
      },
      validatorAddress: 'agoric1valoperhello',
      delegatorAddress: 'agoric1pleab',
    }),
    typedJson('/cosmos.bank.v1beta1.QueryAllBalancesRequest', {
      address: 'agoric1pleab',
    }),
  ] as const);
  expectType<MsgDelegateResponse>(results[0]);
  expectType<QueryAllBalancesResponse>(results[1]);
}

// CosmosOrchestrationAccount interfaces
{
  const makeCosmosOrchestrationAccount = prepareCosmosOrchestrationAccount(
    anyVal,
    anyVal,
  );
  makeCosmosOrchestrationAccount(
    anyVal,
    anyVal,
    anyVal,
  ) satisfies HostInterface<StakingAccountActions>;
}

// HostOf
{
  type PromiseFn = () => Promise<number>;
  type SyncFn = () => number;

  type VowFn = HostOf<PromiseFn>;
  type StillSyncFn = HostOf<SyncFn>;

  // Use type assertion instead of casting
  const vowFn: VowFn = (() => ({}) as Vow<number>) as VowFn;
  expectType<() => Vow<number>>(vowFn);

  const syncFn: StillSyncFn = (() => 42) as StillSyncFn;
  expectType<() => number>(syncFn);

  // Negative test
  expectNotType<() => Promise<number>>(vowFn);

  const getBrandInfo: HostOf<Orchestrator['getBrandInfo']> = null as any;
  const chainHostOf = getBrandInfo('uatom').chain;
  expectType<Vow<any>>(chainHostOf.getChainInfo());
}

{
  // HostInterface

  const chain: Chain<ChainInfo> = null as any;
  expectType<Promise<ChainInfo>>(chain.getChainInfo());
  const chainHostInterface: HostInterface<Chain<ChainInfo>> = null as any;
  expectType<Vow<ChainInfo>>(chainHostInterface.getChainInfo());

  const publicTopicRecord: HostInterface<
    Record<string, ResolvedPublicTopic<unknown>>
  > = {
    someTopic: {
      subscriber: null as any,
      storagePath: 'published.somewhere',
    },
  };
  // @ts-expect-error the promise from `subscriber.getUpdateSince` can't be used in a flow
  expectType<Record<string, ResolvedPublicTopic<unknown>>>(publicTopicRecord);
}

// HostOf with TransferSteps
{
  type TransferStepsVow = HostOf<OrchestrationAccount<any>['transferSteps']>;

  const transferStepsVow: TransferStepsVow = (...args: any[]): Vow<any> =>
    ({}) as any;
  expectType<(...args: any[]) => Vow<any>>(transferStepsVow);
}

// VowifyAll
{
  type PromiseObject = {
    foo: () => Promise<number>;
    bar: (x: string) => Promise<boolean>;
    bizz: () => Record<string, number>;
  };

  type VowObject = HostInterface<PromiseObject>;

  const vowObject: VowObject = {
    foo: () => ({}) as Vow<number>,
    bar: (x: string) => ({}) as Vow<boolean>,
    bizz: () => ({ foo: 1 }),
  };

  expectType<{
    foo: () => Vow<number>;
    bar: (x: string) => Vow<boolean>;
    bizz: () => Record<string, number>;
  }>(vowObject);
}

{
  // orchestrate()

  const facade: OrchestrationFacade = null as any;
  const echo = <T extends number>(orc: Orchestrator, ctx: undefined, num: T) =>
    num;
  // @ts-expect-error requires an async function
  facade.orchestrate('name', undefined, echo);

  const slowEcho = <T extends number>(
    orc: Orchestrator,
    ctx: undefined,
    num: T,
  ) => Promise.resolve(num);
  {
    const h = facade.orchestrate('name', undefined, slowEcho);
    // TODO keep the return type as Vow<T>
    expectType<(num: number) => Vow<number>>(h);
    expectType<Vow<number>>(h(42));
    // @ts-expect-error literal not carried, widened to number
    expectType<Vow<42>>(h(42));
  }

  const makeOfferResult = () =>
    Promise.resolve({} as ResolvedContinuingOfferResult);
  {
    const h = facade.orchestrate('name', undefined, makeOfferResult);
    expectType<Vow<ResolvedContinuingOfferResult>>(h());
  }
}
