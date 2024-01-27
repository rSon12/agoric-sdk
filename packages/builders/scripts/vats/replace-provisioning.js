// @ts-check

import { makeHelpers } from '@agoric/deploy-script-support';
import { getManifestForProvisioning } from '@agoric/vats/src/proposals/namesByAddress-fix-proposal.js';

/** @type {import('@agoric/deploy-script-support/src/externalTypes.js').ProposalBuilder} */
export const defaultProposalBuilder = async ({ publishRef, install }) =>
  harden({
    sourceSpec: '@agoric/vats/src/proposals/namesByAddress-fix-proposal.js',
    getManifestCall: [
      getManifestForProvisioning.name,
      {
        provisioningRef: publishRef(
          install('@agoric/vats/src/vat-provisioning.js'),
        ),
      },
    ],
  });

export default async (homeP, endowments) => {
  const { writeCoreProposal } = await makeHelpers(homeP, endowments);
  await writeCoreProposal('gov-provisioning', defaultProposalBuilder);
};
