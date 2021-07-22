import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';

export function buildRootObject(vatPowers) {
  const log = vatPowers.testLog;
  let service;
  let control;

  return Far('root', {
    async bootstrap(vats, devices) {
      service = await E(vats.vatAdmin).createVatAdminService(devices.vatAdmin);
    },

    async createVat(bundle, dynamicOptions) {
      control = await E(service).createVat(bundle, dynamicOptions);
      const done = E(control.adminNode).done();
      // the caller checks this later, but doesn't wait for it
      return ['created', done];
    },

    getNever() {
      // grab a Promise which won't resolve until the vat dies
      const neverP = E(control.root).never();
      neverP.catch(() => 'hush');
      return [neverP];
    },

    run() {
      return E(control.root).run();
    },

    explode(how) {
      return E(control.root).explode(how);
    },

    async bundleRun() {
      try {
        await E(control.root).meterThem('no');
        log('did run');
      } catch (err) {
        log(`run exploded: ${err}`);
      }
    },

    async bundleExplode(how) {
      try {
        await E(control.root).meterThem(how);
        log('failed to explode');
      } catch (err) {
        log(`did explode: ${err}`);
      }
    },
  });
}
