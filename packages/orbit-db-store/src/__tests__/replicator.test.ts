import assert from 'assert'
import { Log } from '@dao-xyz/ipfs-log'
import { default as Cache } from '@dao-xyz/orbit-db-cache'
import { Keystore, SignKeyWithMeta } from "@dao-xyz/orbit-db-keystore"

import {
  config,
  testAPIs,
  startIpfs,
  stopIpfs
} from 'orbit-db-test-utils'
import { DefaultOptions, Store } from '../store'
import { createStore } from './storage'
import { SimpleAccessController, SimpleIndex } from './utils'

// Tests timeout
const timeout = 30000

Object.keys(testAPIs).forEach((IPFS) => {
  describe(`Replicator, ${IPFS}`, () => {

    jest.setTimeout(timeout);

    let ipfsd, ipfs, signKey: SignKeyWithMeta, store: Store<any>, keystore: Keystore, signingKeystore: Keystore, cacheStore
    let index: SimpleIndex<string>
    const { identityKeysPath } = config

    beforeAll(async () => {
      keystore = new Keystore(identityKeysPath)

      ipfsd = await startIpfs(IPFS, config.daemon1)
      ipfs = ipfsd.api
      /*       const id = (await ipfsd.api.id()).id
       */
      signKey = await keystore.createKey(new Uint8Array([0]), SignKeyWithMeta, undefined, { overwrite: true });
      cacheStore = await createStore('cache')
      const cache = new Cache(cacheStore)
      index = new SimpleIndex();

      const options = Object.assign({}, DefaultOptions, { replicationConcurrency: 123, resolveCache: () => Promise.resolve(cache), onUpdate: index.updateIndex.bind(index) })
      store = new Store({ name: 'name', accessController: new SimpleAccessController() })
      await store.init(ipfs, signKey.publicKey, (data) => Keystore.sign(data, signKey), options);


    })

    afterAll(async () => {
      await store._replicator?.stop()
      ipfsd && await stopIpfs(ipfsd)
      await keystore?.close()
    })

    it('default options', async () => {
      assert.deepStrictEqual(store._replicator._logs, [])
    })

    describe('concurrency = 123', function () {
      let log2: Log<string>

      jest.setTimeout(timeout)

      const logLength = 100

      beforeAll(async () => {

        log2 = new Log(ipfs, signKey.publicKey, (data) => Keystore.sign(data, signKey), { logId: store._oplog.id })
        console.log(`writing ${logLength} entries to the log`)
        for (let i = 0; i < logLength; i++) {
          await log2.append(`entry${i}`, { pointerCount: 123 })
        }
        expect(log2.values.length).toEqual(logLength)
      })

      it('replicates all entries in the log', (done) => {
        let replicated = 0
        assert.strictEqual(store._oplog.id, log2.id)

        assert.strictEqual(store._replicator._logs.length, 0)
        assert.strictEqual(store._replicator.tasksQueued, 0)
        store._replicator.onReplicationProgress = () => replicated++
        store._replicator.onReplicationComplete = async (replicatedLogs) => {
          assert.strictEqual(store._replicator.tasksRunning, 0)
          assert.strictEqual(store._replicator.tasksQueued, 0)
          assert.strictEqual(store._replicator.unfinished.length, 0)
          for (const replicatedLog of replicatedLogs) {
            await store._oplog.join(replicatedLog)
          }
          assert.strictEqual(store._oplog.values.length, logLength)
          assert.strictEqual(store._oplog.values.length, log2.values.length)
          for (let i = 0; i < store._oplog.values.length; i++) {
            assert(store._oplog.values[i].equals(log2.values[i]))
          }
          done();
        }

        store._replicator.load(log2.heads)
      })
    })
  })
})
