/** @file Localchain Facade exo */
import { E } from '@endo/far';
// eslint-disable-next-line no-restricted-syntax -- just the import
import { heapVowE } from '@agoric/vow/vat.js';
import { M } from '@endo/patterns';
import { pickFacet } from '@agoric/vat-data';
import { VowShape } from '@agoric/vow';

import { Fail } from '@endo/errors';
import { chainFacadeMethods } from '../typeGuards.js';

/**
 * @import {HostOf} from '@agoric/async-flow';
 * @import {Zone} from '@agoric/base-zone';
 * @import {TimerService} from '@agoric/time';
 * @import {Remote} from '@agoric/internal';
 * @import {LocalChain, LocalChainAccount} from '@agoric/vats/src/localchain.js';
 * @import {AssetInfo} from '@agoric/vats/src/vat-bank.js';
 * @import {NameHub} from '@agoric/vats';
 * @import {Vow, VowTools} from '@agoric/vow';
 * @import {CosmosInterchainService} from './cosmos-interchain-service.js';
 * @import {LocalOrchestrationAccountKit, MakeLocalOrchestrationAccountKit} from './local-orchestration-account.js';
 * @import {ChainAddress, ChainInfo, CosmosChainInfo, IBCConnectionInfo, OrchestrationAccount} from '../types.js';
 */

/**
 * @typedef {object} AgoricChainMethods
 * @property {() => Promise<AssetInfo[]>} getVBankAssetInfo Get asset info from
 *   agoricNames.vbankAsset.
 *
 *   Caches the query to agoricNames in the first call.
 */

/**
 * @typedef {{
 *   makeLocalOrchestrationAccountKit: MakeLocalOrchestrationAccountKit;
 *   orchestration: Remote<CosmosInterchainService>;
 *   storageNode: Remote<StorageNode>;
 *   agoricNames: Remote<NameHub>;
 *   timer: Remote<TimerService>;
 *   localchain: Remote<LocalChain>;
 *   vowTools: VowTools;
 * }} LocalChainFacadePowers
 */

/**
 * @param {Zone} zone
 * @param {LocalChainFacadePowers} powers
 */
const prepareLocalChainFacadeKit = (
  zone,
  {
    makeLocalOrchestrationAccountKit,
    agoricNames,
    localchain,
    // TODO vstorage design https://github.com/Agoric/agoric-sdk/issues/9066
    // consider making an `accounts` childNode
    storageNode,
    vowTools: { allVows, watch, asVow },
  },
) =>
  zone.exoClassKit(
    'LocalChainFacade',
    {
      public: M.interface('LocalChainFacade', {
        ...chainFacadeMethods,
        getVBankAssetInfo: M.call().optional(M.boolean()).returns(VowShape),
      }),
      vbankAssetValuesWatcher: M.interface('vbankAssetValuesWatcher', {
        onFulfilled: M.call(M.arrayOf(M.record()))
          .optional(M.arrayOf(M.undefined())) // empty context
          .returns(VowShape),
      }),
      makeAccountWatcher: M.interface('makeAccountWatcher', {
        onFulfilled: M.call([M.remotable('LCA Account'), M.string()])
          .optional(M.arrayOf(M.undefined())) // empty context
          .returns(VowShape),
      }),
      makeChildNodeWatcher: M.interface('makeChildNodeWatcher', {
        onFulfilled: M.call(M.remotable())
          .optional({ account: M.remotable(), address: M.string() }) // empty context
          .returns(M.remotable()),
      }),
    },
    /**
     * @param {CosmosChainInfo} localChainInfo
     */
    localChainInfo => {
      return {
        localChainInfo,
        vbankAssets: /** @type {AssetInfo[] | undefined} */ (undefined),
      };
    },
    {
      public: {
        getChainInfo() {
          return watch(this.state.localChainInfo);
        },

        /** @returns {Vow<LocalOrchestrationAccountKit['holder']>} */
        makeAccount() {
          const lcaP = E(localchain).makeAccount();
          return watch(
            // XXX makeAccount returns a Promise for an exo but reserves being able to return a vow
            // so we use heapVowE to shorten the promise path
            // eslint-disable-next-line no-restricted-syntax -- will run in one turn
            allVows([lcaP, heapVowE(lcaP).getAddress()]),
            this.facets.makeAccountWatcher,
          );
        },
        query() {
          // TODO https://github.com/Agoric/agoric-sdk/pull/9935
          return asVow(() => Fail`not yet implemented`);
        },
        /** @type {HostOf<AgoricChainMethods['getVBankAssetInfo']>} */
        getVBankAssetInfo() {
          return asVow(() => {
            const { vbankAssets } = this.state;
            if (vbankAssets) {
              return vbankAssets;
            }
            const vbankAssetNameHubP = E(agoricNames).lookup('vbankAsset');
            const vbankAssetValuesP = E(vbankAssetNameHubP).values();
            const { vbankAssetValuesWatcher } = this.facets;
            return watch(vbankAssetValuesP, vbankAssetValuesWatcher);
          });
        },
      },
      vbankAssetValuesWatcher: {
        /**
         * @param {AssetInfo[]} assets
         */
        onFulfilled(assets) {
          const { state } = this;
          return asVow(() => {
            state.vbankAssets = assets;
            return assets;
          });
        },
      },
      makeAccountWatcher: {
        /**
         * @param {[LocalChainAccount, ChainAddress['value']]} results
         */
        onFulfilled([account, address]) {
          return watch(
            E(storageNode).makeChildNode(address),
            this.facets.makeChildNodeWatcher,
            { account, address },
          );
        },
      },
      makeChildNodeWatcher: {
        /**
         * @param {Remote<StorageNode>} childNode
         * @param {{
         *   account: LocalChainAccount;
         *   address: ChainAddress['value'];
         * }} ctx
         */
        onFulfilled(childNode, { account, address }) {
          const { localChainInfo } = this.state;
          const { holder } = makeLocalOrchestrationAccountKit({
            account,
            address: harden({
              value: address,
              encoding: 'bech32',
              chainId: localChainInfo.chainId,
            }),
            // FIXME storage path https://github.com/Agoric/agoric-sdk/issues/9066
            storageNode: childNode,
          });
          return holder;
        },
      },
    },
  );
harden(prepareLocalChainFacadeKit);

/**
 * @param {Zone} zone
 * @param {LocalChainFacadePowers} powers
 */
export const prepareLocalChainFacade = (zone, powers) => {
  const makeLocalChainFacadeKit = prepareLocalChainFacadeKit(zone, powers);
  return pickFacet(makeLocalChainFacadeKit, 'public');
};
harden(prepareLocalChainFacade);

/** @typedef {ReturnType<typeof prepareLocalChainFacade>} MakeLocalChainFacade */
/** @typedef {ReturnType<MakeLocalChainFacade>} LocalChainFacade */
