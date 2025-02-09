import { test as anyTest } from '@agoric/zoe/tools/prepare-test-env-ava.js';

import { Fail } from '@endo/errors';
import { documentStorageSchema } from '@agoric/internal/src/storage-test-utils.js';
import type { CosmosValidatorAddress } from '@agoric/orchestration';
import type { start as startStakeIca } from '@agoric/orchestration/src/examples/stakeIca.contract.js';
import type { Instance } from '@agoric/zoe/src/zoeService/utils.js';
import type { TestFn } from 'ava';
import { SIMULATED_ERRORS } from '@agoric/vats/tools/fake-bridge.js';
import {
  makeWalletFactoryContext,
  type WalletFactoryTestContext,
} from './walletFactory.js';

const test: TestFn<WalletFactoryTestContext> = anyTest;

const validatorAddress: CosmosValidatorAddress = {
  value: 'cosmosvaloper1test',
  chainId: 'gaiatest',
  encoding: 'bech32',
};

const ATOM_DENOM = 'uatom';

test.before(async t => {
  t.context = await makeWalletFactoryContext(
    t,
    '@agoric/vm-config/decentral-itest-orchestration-config.json',
  );
});
test.after.always(t => t.context.shutdown?.());

/**
 * Test the config itself. Part of this suite so we don't have to start up another swingset.
 */
test.serial('config', async t => {
  const {
    storage,
    readLatest,
    runUtils: { EV },
  } = t.context;

  const agoricNames = await EV.vat('bootstrap').consumeItem('agoricNames');

  {
    const cosmosChainInfo = await EV(agoricNames).lookup('chain', 'cosmoshub');
    t.like(cosmosChainInfo, {
      chainId: 'cosmoshub-4',
      stakingTokens: [{ denom: ATOM_DENOM }],
    });
    t.deepEqual(
      readLatest(`published.agoricNames.chain.cosmoshub`),
      cosmosChainInfo,
    );
    await documentStorageSchema(t, storage, {
      note: 'Chain info for Orchestration',
      node: 'agoricNames.chain',
    });
  }

  {
    const connection = await EV(agoricNames).lookup(
      'chainConnection',
      'cosmoshub-4_juno-1',
    );
    t.like(connection, {
      state: 3,
      transferChannel: { portId: 'transfer', state: 3 },
    });

    t.deepEqual(
      readLatest(`published.agoricNames.chainConnection.cosmoshub-4_juno-1`),
      connection,
    );

    await documentStorageSchema(t, storage, {
      note: 'Chain connections for Orchestration',
      node: 'agoricNames.chainConnection',
    });
  }
  {
    const connection = await EV(agoricNames).lookup(
      'chainConnection',
      'agoric-3_osmosis-1',
    );
    t.like(connection, {
      id: 'connection-1',
      client_id: '07-tendermint-1',
      counterparty: {
        client_id: '07-tendermint-2109',
        connection_id: 'connection-1649',
      },
      transferChannel: {
        counterPartyChannelId: 'channel-320',
        channelId: 'channel-1',
      },
    });
  }
});

test.skip('stakeOsmo - queries', async t => {
  const {
    buildProposal,
    evalProposal,
    runUtils: { EV },
  } = t.context;
  await evalProposal(
    buildProposal('@agoric/builders/scripts/orchestration/init-stakeOsmo.js'),
  );

  const agoricNames = await EV.vat('bootstrap').consumeItem('agoricNames');
  const instance: Instance<typeof startStakeIca> = await EV(agoricNames).lookup(
    'instance',
    'stakeOsmo',
  );
  t.truthy(instance, 'stakeOsmo instance is available');

  const zoe: ZoeService = await EV.vat('bootstrap').consumeItem('zoe');
  const publicFacet = await EV(zoe).getPublicFacet(instance);
  t.truthy(publicFacet, 'stakeOsmo publicFacet is available');

  const account = await EV(publicFacet).makeAccount();
  t.log('account', account);
  t.truthy(account, 'makeAccount returns an account on OSMO connection');

  const queryRes = await EV(account).getBalance(ATOM_DENOM);
  t.deepEqual(queryRes, { value: 0n, denom: ATOM_DENOM });

  const queryUnknownDenom = await EV(account).getBalance('some-invalid-denom');
  t.deepEqual(
    queryUnknownDenom,
    { value: 0n, denom: 'some-invalid-denom' },
    'getBalance for unknown denom returns value: 0n',
  );
});

test.serial('stakeAtom - smart wallet', async t => {
  const {
    buildProposal,
    evalProposal,
    agoricNamesRemotes,
    bridgeUtils: { flushInboundQueue },
    readLatest,
  } = t.context;

  await evalProposal(
    buildProposal('@agoric/builders/scripts/orchestration/init-stakeAtom.js'),
  );

  const wd = await t.context.walletFactoryDriver.provideSmartWallet(
    'agoric1testStakAtom',
  );

  await wd.sendOffer({
    id: 'request-account',
    invitationSpec: {
      source: 'agoricContract',
      instancePath: ['stakeAtom'],
      callPipe: [['makeAccountInvitationMaker']],
    },
    proposal: {},
  });
  await flushInboundQueue();
  t.like(wd.getCurrentWalletRecord(), {
    offerToPublicSubscriberPaths: [
      [
        'request-account',
        {
          account: 'published.stakeAtom.accounts.cosmos1test',
        },
      ],
    ],
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: { id: 'request-account', numWantsSatisfied: 1 },
  });
  t.is(readLatest('published.stakeAtom.accounts.cosmos1test'), '');

  const { ATOM } = agoricNamesRemotes.brand;
  ATOM || Fail`ATOM missing from agoricNames`;

  // Cannot await executeOffer because the offer won't resolve until after the bridge's inbound queue is flushed.
  // But this test doesn't require that.
  await wd.sendOffer({
    id: 'request-delegate-success',
    invitationSpec: {
      source: 'continuing',
      previousOffer: 'request-account',
      invitationMakerName: 'Delegate',
      invitationArgs: [validatorAddress, { denom: ATOM_DENOM, value: 10n }],
    },
    proposal: {},
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: { id: 'request-delegate-success', numWantsSatisfied: 1 },
  });

  const validatorAddressFail: CosmosValidatorAddress = {
    value: 'cosmosvaloper1fail',
    chainId: 'gaiatest',
    encoding: 'bech32',
  };

  // This will trigger the immediate ack of the mock bridge
  await t.throwsAsync(
    wd.executeOffer({
      id: 'request-delegate-fail',
      invitationSpec: {
        source: 'continuing',
        previousOffer: 'request-account',
        invitationMakerName: 'Delegate',
        invitationArgs: [
          validatorAddressFail,
          { denom: ATOM_DENOM, value: 10n },
        ],
      },
      proposal: {},
    }),
    {
      message: 'ABCI code: 5: error handling packet: see events for details',
    },
    'delegate fails with invalid validator',
  );

  // This will trigger the immediate ack of the mock bridge
  await t.throwsAsync(
    wd.executeOffer({
      id: 'request-delegate-brand',
      invitationSpec: {
        source: 'continuing',
        previousOffer: 'request-account',
        invitationMakerName: 'Delegate',
        invitationArgs: [validatorAddress, { brand: ATOM, value: 10n }],
      },
      proposal: {},
    }),
    {
      message: 'Brands not currently supported.',
    },
    'brands not currently supported',
  );
});

test.todo('undelegate wallet offer');
test.todo('undelegate with multiple undelegations wallet offer');
test.todo('redelegate wallet offer');
test.todo('withdraw reward wallet offer');

// XXX rely on .serial to be in sequence, and keep this one last
test.serial('revise chain info', async t => {
  const {
    buildProposal,
    evalProposal,
    runUtils: { EV },
  } = t.context;

  const agoricNames = await EV.vat('bootstrap').consumeItem('agoricNames');

  await t.throwsAsync(EV(agoricNames).lookup('chain', 'hot'), {
    message: '"nameKey" not found: "hot"',
  });

  // Revise chain info in agoricNames with the fixture in this script
  await evalProposal(
    buildProposal('@agoric/builders/scripts/testing/append-chain-info.js'),
  );

  const hotchain = await EV(agoricNames).lookup('chain', 'hot');
  t.deepEqual(hotchain, { allegedName: 'Hot New Chain', chainId: 'hot-1' });

  const connection = await EV(agoricNames).lookup(
    'chainConnection',
    'cosmoshub-4_hot-1',
  );
  t.like(connection, {
    id: 'connection-1',
    client_id: '07-tendermint-2',
  });
});

test('basic-flows', async t => {
  const {
    buildProposal,
    evalProposal,
    agoricNamesRemotes,
    readLatest,
    bridgeUtils: { flushInboundQueue },
  } = t.context;

  await evalProposal(
    buildProposal('@agoric/builders/scripts/orchestration/init-basic-flows.js'),
  );

  const wd =
    await t.context.walletFactoryDriver.provideSmartWallet('agoric1test');

  // create a cosmos orchestration account
  await wd.sendOffer({
    id: 'request-coa',
    invitationSpec: {
      source: 'agoricContract',
      instancePath: ['basicFlows'],
      callPipe: [['makeOrchAccountInvitation']],
    },
    offerArgs: {
      chainName: 'cosmoshub',
    },
    proposal: {},
  });
  await flushInboundQueue();
  t.like(wd.getCurrentWalletRecord(), {
    offerToPublicSubscriberPaths: [
      [
        'request-coa',
        {
          account: 'published.basicFlows.cosmos1test',
        },
      ],
    ],
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: { id: 'request-coa', numWantsSatisfied: 1 },
  });
  t.is(readLatest('published.basicFlows.cosmos1test'), '');

  // create a local orchestration account
  await wd.executeOffer({
    id: 'request-loa',
    invitationSpec: {
      source: 'agoricContract',
      instancePath: ['basicFlows'],
      callPipe: [['makeOrchAccountInvitation']],
    },
    offerArgs: {
      chainName: 'agoric',
    },
    proposal: {},
  });

  const publicSubscriberPaths = Object.fromEntries(
    wd.getCurrentWalletRecord().offerToPublicSubscriberPaths,
  );
  t.deepEqual(publicSubscriberPaths['request-loa'], {
    account: 'published.basicFlows.agoric1fakeLCAAddress1',
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: { id: 'request-loa', numWantsSatisfied: 1 },
  });
  t.is(readLatest('published.basicFlows.agoric1fakeLCAAddress'), '');

  await wd.sendOffer({
    id: 'transfer-to-noble-from-cosmos',
    invitationSpec: {
      source: 'continuing',
      previousOffer: 'request-coa',
      invitationMakerName: 'Transfer',
    },
    proposal: {},
    offerArgs: {
      amount: { denom: 'ibc/uusdchash', value: 10n },
      destination: {
        chainId: 'noble-1',
        value: 'noble1test',
        encoding: 'bech32,',
      },
    },
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: {
      id: 'transfer-to-noble-from-cosmos',
      error: undefined,
    },
  });

  await wd.sendOffer({
    id: 'transfer-to-noble-from-cosmos-timeout',
    invitationSpec: {
      source: 'continuing',
      previousOffer: 'request-coa',
      invitationMakerName: 'Transfer',
    },
    proposal: {},
    offerArgs: {
      amount: { denom: 'ibc/uusdchash', value: SIMULATED_ERRORS.TIMEOUT },
      destination: {
        chainId: 'noble-1',
        value: 'noble1test',
        encoding: 'bech32,',
      },
    },
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: {
      id: 'transfer-to-noble-from-cosmos-timeout',
      error:
        'Error: ABCI code: 5: error handling packet: see events for details',
    },
  });

  await wd.sendOffer({
    id: 'transfer-to-noble-from-agoric',
    invitationSpec: {
      source: 'continuing',
      previousOffer: 'request-loa',
      invitationMakerName: 'Transfer',
    },
    proposal: {},
    offerArgs: {
      amount: { denom: 'ibc/uusdchash', value: 10n },
      destination: {
        chainId: 'noble-1',
        value: 'noble1test',
        encoding: 'bech32,',
      },
    },
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: {
      id: 'transfer-to-noble-from-agoric',
      error: undefined,
    },
  });

  await t.throwsAsync(
    wd.executeOffer({
      id: 'transfer-to-noble-from-agoric-timeout',
      invitationSpec: {
        source: 'continuing',
        previousOffer: 'request-loa',
        invitationMakerName: 'Transfer',
      },
      proposal: {},
      offerArgs: {
        amount: { denom: 'ibc/uusdchash', value: SIMULATED_ERRORS.TIMEOUT },
        destination: {
          chainId: 'noble-1',
          value: 'noble1test',
          encoding: 'bech32,',
        },
      },
    }),
  );
});

test.serial('auto-stake-it - proposal', async t => {
  const { buildProposal, evalProposal } = t.context;

  await t.notThrowsAsync(
    evalProposal(
      buildProposal('@agoric/builders/scripts/testing/start-auto-stake-it.js'),
    ),
  );
});

test.serial('basic-flows - portfolio holder', async t => {
  const {
    buildProposal,
    evalProposal,
    readLatest,
    agoricNamesRemotes,
    bridgeUtils: { flushInboundQueue },
  } = t.context;

  await evalProposal(
    buildProposal('@agoric/builders/scripts/orchestration/init-basic-flows.js'),
  );

  const wd =
    await t.context.walletFactoryDriver.provideSmartWallet('agoric1test2');

  // create a cosmos orchestration account
  await wd.sendOffer({
    id: 'request-portfolio-acct',
    invitationSpec: {
      source: 'agoricContract',
      instancePath: ['basicFlows'],
      callPipe: [['makePortfolioAccountInvitation']],
    },
    offerArgs: {
      chainNames: ['agoric', 'cosmoshub', 'osmosis'],
    },
    proposal: {},
  });
  t.like(
    wd.getLatestUpdateRecord(),
    {
      status: { id: 'request-portfolio-acct', numWantsSatisfied: 1 },
    },
    'trivially satisfied',
  );
  await flushInboundQueue();
  t.like(wd.getCurrentWalletRecord(), {
    offerToPublicSubscriberPaths: [
      [
        'request-portfolio-acct',
        {
          agoric: 'published.basicFlows.agoric1fakeLCAAddress',
          cosmoshub: 'published.basicFlows.cosmos1test',
          // XXX support multiple chain addresses in ibc mocks
          osmosis: 'published.basicFlows.cosmos1test',
        },
      ],
    ],
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: { id: 'request-portfolio-acct', numWantsSatisfied: 1 },
  });
  // XXX this overrides a previous account, since mocks only provide one address
  t.is(readLatest('published.basicFlows.cosmos1test'), '');
  // XXX this overrides a previous account, since mocks only provide one address
  t.is(readLatest('published.basicFlows.agoric1fakeLCAAddress'), '');

  const { BLD } = agoricNamesRemotes.brand;
  BLD || Fail`BLD missing from agoricNames`;

  await wd.sendOffer({
    id: 'delegate-cosmoshub',
    invitationSpec: {
      source: 'continuing',
      previousOffer: 'request-portfolio-acct',
      invitationMakerName: 'MakeInvitation',
      invitationArgs: [
        'cosmoshub',
        'Delegate',
        [validatorAddress, { denom: ATOM_DENOM, value: 10n }],
      ],
    },
    proposal: {},
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: { id: 'delegate-cosmoshub', numWantsSatisfied: 1 },
  });

  await wd.sendOffer({
    id: 'delegate-agoric',
    invitationSpec: {
      source: 'continuing',
      previousOffer: 'request-portfolio-acct',
      invitationMakerName: 'MakeInvitation',
      invitationArgs: [
        'agoric',
        'Delegate',
        // XXX use ChainAddress for LocalOrchAccount
        ['agoric1validator1', { brand: BLD, value: 10n }],
      ],
    },
    proposal: {},
  });
  t.like(wd.getLatestUpdateRecord(), {
    status: { id: 'delegate-agoric', numWantsSatisfied: 1 },
  });

  await t.throwsAsync(
    wd.executeOffer({
      id: 'delegate-2-cosmoshub',
      invitationSpec: {
        source: 'continuing',
        previousOffer: 'request-portfolio-acct',
        invitationMakerName: 'MakeInvitation',
        invitationArgs: [
          'cosmoshub',
          'Delegate',
          [
            validatorAddress,
            { denom: ATOM_DENOM, value: SIMULATED_ERRORS.TIMEOUT },
          ],
        ],
      },
      proposal: {},
    }),
  );

  await t.throwsAsync(
    wd.executeOffer({
      id: 'delegate-2-agoric',
      invitationSpec: {
        source: 'continuing',
        previousOffer: 'request-portfolio-acct',
        invitationMakerName: 'MakeInvitation',
        invitationArgs: [
          'agoric',
          'Delegate',
          [
            'agoric1validator1',
            { brand: BLD, value: SIMULATED_ERRORS.TIMEOUT },
          ],
        ],
      },
      proposal: {},
    }),
  );
});
