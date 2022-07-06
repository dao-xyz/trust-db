const assert = require('assert')
const rmrf = require('rimraf')
const fs = require('fs-extra')
import { LamportClock as Clock } from '../lamport-clock'
import { Entry } from '../signable'
import { Log } from '../log'
const IdentityProvider = require('orbit-db-identity-provider')
const Keystore = require('orbit-db-keystore')

// Test utils
const {
  config,
  testAPIs,
  startIpfs,
  stopIpfs
} = require('orbit-db-test-utils')

let ipfsd, ipfs, testIdentity, testIdentity2, testIdentity3, testIdentity4

const last = (arr) => {
  return arr[arr.length - 1]
}

Object.keys(testAPIs).forEach((IPFS) => {
  describe('Log - Join (' + IPFS + ')', function () {
    jest.setTimeout(config.timeout)

    const { identityKeyFixtures, signingKeyFixtures, identityKeysPath, signingKeysPath } = config

    let keystore, signingKeystore

    beforeAll(async () => {
      rmrf.sync(identityKeysPath)
      rmrf.sync(signingKeysPath)
      await fs.copy(identityKeyFixtures(__dirname), identityKeysPath)
      await fs.copy(signingKeyFixtures(__dirname), signingKeysPath)

      keystore = new Keystore(identityKeysPath)
      signingKeystore = new Keystore(signingKeysPath)

      testIdentity = await IdentityProvider.createIdentity({ id: 'userC', keystore, signingKeystore })
      testIdentity2 = await IdentityProvider.createIdentity({ id: 'userB', keystore, signingKeystore })
      testIdentity3 = await IdentityProvider.createIdentity({ id: 'userD', keystore, signingKeystore })
      testIdentity4 = await IdentityProvider.createIdentity({ id: 'userA', keystore, signingKeystore })

      ipfsd = await startIpfs(IPFS, config.defaultIpfsConfig)
      ipfs = ipfsd.api
    })

    afterAll(async () => {
      await stopIpfs(ipfsd)
      rmrf.sync(identityKeysPath)
      rmrf.sync(signingKeysPath)

      await keystore?.close()
      await signingKeystore?.close()
    })

    describe('join', () => {
      let log1, log2, log3, log4

      beforeEach(async () => {
        log1 = new Log(ipfs, testIdentity, { logId: 'X' })
        log2 = new Log(ipfs, testIdentity2, { logId: 'X' })
        log3 = new Log(ipfs, testIdentity3, { logId: 'X' })
        log4 = new Log(ipfs, testIdentity4, { logId: 'X' })
      })

      test('joins logs', async () => {
        const items1: Entry[] = []
        const items2: Entry[] = []
        const items3: Entry[] = []
        const amount = 100
        for (let i = 1; i <= amount; i++) {
          const prev1 = last(items1)
          const prev2 = last(items2)
          const prev3 = last(items3)
          const n1 = await Entry.create(ipfs, testIdentity, 'X', 'entryA' + i, [prev1])
          const n2 = await Entry.create(ipfs, testIdentity2, 'X', 'entryB' + i, [prev2, n1])
          const n3 = await Entry.create(ipfs, testIdentity3, 'X', 'entryC' + i, [prev3, n1, n2])
          items1.push(n1)
          items2.push(n2)
          items3.push(n3)
        }

        // Here we're creating a log from entries signed by A and B
        // but we accept entries from C too
        const logA = await Log.fromEntry(ipfs, testIdentity3, last(items2), { length: -1 })
        // Here we're creating a log from entries signed by peer A, B and C
        // "logA" accepts entries from peer C so we can join logs A and B
        const logB = await Log.fromEntry(ipfs, testIdentity3, last(items3), { length: -1 })
        assert.strictEqual(logA.length, items2.length + items1.length)
        assert.strictEqual(logB.length, items3.length + items2.length + items1.length)

        await logA.join(logB)

        assert.strictEqual(logA.length, items3.length + items2.length + items1.length)
        // The last entry, 'entryC100', should be the only head
        // (it points to entryB100, entryB100 and entryC99)
        assert.strictEqual(logA.heads.length, 1)
      })

      test('throws an error if first log is not defined', async () => {
        let err
        try {
          await log1.join()
        } catch (e) {
          err = e
        }
        assert.notStrictEqual(err, null)
        assert.strictEqual(err.message, 'Log instance not defined')
      })

      test('throws an error if passed argument is not an instance of Log', async () => {
        let err
        try {
          await log1.join({})
        } catch (e) {
          err = e
        }
        assert.notStrictEqual(err, null)
        assert.strictEqual(err.message, 'Given argument is not an instance of Log')
      })

      test('joins only unique items', async () => {
        await log1.append('helloA1')
        await log1.append('helloA2')
        await log2.append('helloB1')
        await log2.append('helloB2')
        await log1.join(log2)
        await log1.join(log2)

        const expectedData = [
          'helloA1', 'helloB1', 'helloA2', 'helloB2'
        ]

        assert.strictEqual(log1.length, 4)
        assert.deepStrictEqual(log1.values.map((e) => e.payload), expectedData)

        const item = last(log1.values)
        assert.strictEqual(item.next.length, 1)
      })

      test('joins logs two ways', async () => {
        await log1.append('helloA1')
        await log1.append('helloA2')
        await log2.append('helloB1')
        await log2.append('helloB2')
        await log1.join(log2)
        await log2.join(log1)

        const expectedData = [
          'helloA1', 'helloB1', 'helloA2', 'helloB2'
        ]

        assert.deepStrictEqual(log1.values.map((e) => e.hash), log2.values.map((e) => e.hash))
        assert.deepStrictEqual(log1.values.map((e) => e.payload), expectedData)
        assert.deepStrictEqual(log2.values.map((e) => e.payload), expectedData)
      })

      test('joins logs twice', async () => {
        await log1.append('helloA1')
        await log2.append('helloB1')
        await log2.join(log1)

        await log1.append('helloA2')
        await log2.append('helloB2')
        await log2.join(log1)

        const expectedData = [
          'helloA1', 'helloB1', 'helloA2', 'helloB2'
        ]

        assert.strictEqual(log2.length, 4)
        assert.deepStrictEqual(log2.values.map((e) => e.payload), expectedData)
      })

      test('joins 2 logs two ways', async () => {
        await log1.append('helloA1')
        await log2.append('helloB1')
        await log2.join(log1)
        await log1.join(log2)
        await log1.append('helloA2')
        await log2.append('helloB2')
        await log2.join(log1)

        const expectedData = [
          'helloA1', 'helloB1', 'helloA2', 'helloB2'
        ]

        assert.strictEqual(log2.length, 4)
        assert.deepStrictEqual(log2.values.map((e) => e.payload), expectedData)
      })

      test('joins 2 logs two ways and has the right heads at every step', async () => {
        await log1.append('helloA1')
        assert.strictEqual(log1.heads.length, 1)
        assert.strictEqual(log1.heads[0].payload, 'helloA1')

        await log2.append('helloB1')
        assert.strictEqual(log2.heads.length, 1)
        assert.strictEqual(log2.heads[0].payload, 'helloB1')

        await log2.join(log1)
        assert.strictEqual(log2.heads.length, 2)
        assert.strictEqual(log2.heads[0].payload, 'helloB1')
        assert.strictEqual(log2.heads[1].payload, 'helloA1')

        await log1.join(log2)
        assert.strictEqual(log1.heads.length, 2)
        assert.strictEqual(log1.heads[0].payload, 'helloB1')
        assert.strictEqual(log1.heads[1].payload, 'helloA1')

        await log1.append('helloA2')
        assert.strictEqual(log1.heads.length, 1)
        assert.strictEqual(log1.heads[0].payload, 'helloA2')

        await log2.append('helloB2')
        assert.strictEqual(log2.heads.length, 1)
        assert.strictEqual(log2.heads[0].payload, 'helloB2')

        await log2.join(log1)
        assert.strictEqual(log2.heads.length, 2)
        assert.strictEqual(log2.heads[0].payload, 'helloB2')
        assert.strictEqual(log2.heads[1].payload, 'helloA2')
      })

      test('joins 4 logs to one', async () => {
        // order determined by identity's publicKey
        await log1.append('helloA1')
        await log1.append('helloA2')

        await log3.append('helloB1')
        await log3.append('helloB2')

        await log2.append('helloC1')
        await log2.append('helloC2')

        await log4.append('helloD1')
        await log4.append('helloD2')
        await log1.join(log2)
        await log1.join(log3)
        await log1.join(log4)

        const expectedData = [
          'helloA1',
          'helloB1',
          'helloC1',
          'helloD1',
          'helloA2',
          'helloB2',
          'helloC2',
          'helloD2'
        ]

        assert.strictEqual(log1.length, 8)
        assert.deepStrictEqual(log1.values.map(e => e.payload), expectedData)
      })

      test('joins 4 logs to one is commutative', async () => {
        await log1.append('helloA1')
        await log1.append('helloA2')
        await log2.append('helloB1')
        await log2.append('helloB2')
        await log3.append('helloC1')
        await log3.append('helloC2')
        await log4.append('helloD1')
        await log4.append('helloD2')
        await log1.join(log2)
        await log1.join(log3)
        await log1.join(log4)
        await log2.join(log1)
        await log2.join(log3)
        await log2.join(log4)

        assert.strictEqual(log1.length, 8)
        assert.deepStrictEqual(log1.values.map(e => e.payload), log2.values.map(e => e.payload))
      })

      test('joins logs and updates clocks', async () => {
        await log1.append('helloA1')
        await log2.append('helloB1')
        await log2.join(log1)
        await log1.append('helloA2')
        await log2.append('helloB2')

        assert.strictEqual(log1.clock.id, testIdentity.publicKey)
        assert.strictEqual(log2.clock.id, testIdentity2.publicKey)
        assert.strictEqual(log1.clock.time, 2)
        assert.strictEqual(log2.clock.time, 2)

        await log3.join(log1)
        assert.strictEqual(log3.id, 'X')
        assert.strictEqual(log3.clock.id, testIdentity3.publicKey)
        assert.strictEqual(log3.clock.time, 2)

        await log3.append('helloC1')
        await log3.append('helloC2')
        await log1.join(log3)
        await log1.join(log2)
        await log4.append('helloD1')
        await log4.append('helloD2')
        await log4.join(log2)
        await log4.join(log1)
        await log4.join(log3)
        await log4.append('helloD3')
        await log4.append('helloD4')

        await log1.join(log4)
        await log4.join(log1)
        await log4.append('helloD5')
        await log1.append('helloA5')
        await log4.join(log1)
        assert.deepStrictEqual(log4.clock.id, testIdentity4.publicKey)
        assert.deepStrictEqual(log4.clock.time, 7)

        await log4.append('helloD6')
        assert.deepStrictEqual(log4.clock.time, 8)

        const expectedData = [
          { payload: 'helloA1', id: 'X', clock: new Clock({ id: testIdentity.publicKey, time: 1 }) },
          { payload: 'helloB1', id: 'X', clock: new Clock({ id: testIdentity2.publicKey, time: 1 }) },
          { payload: 'helloD1', id: 'X', clock: new Clock({ id: testIdentity4.publicKey, time: 1 }) },
          { payload: 'helloA2', id: 'X', clock: new Clock({ id: testIdentity.publicKey, time: 2 }) },
          { payload: 'helloB2', id: 'X', clock: new Clock({ id: testIdentity2.publicKey, time: 2 }) },
          { payload: 'helloD2', id: 'X', clock: new Clock({ id: testIdentity4.publicKey, time: 2 }) },
          { payload: 'helloC1', id: 'X', clock: new Clock({ id: testIdentity3.publicKey, time: 3 }) },
          { payload: 'helloC2', id: 'X', clock: new Clock({ id: testIdentity3.publicKey, time: 4 }) },
          { payload: 'helloD3', id: 'X', clock: new Clock({ id: testIdentity4.publicKey, time: 5 }) },
          { payload: 'helloD4', id: 'X', clock: new Clock({ id: testIdentity4.publicKey, time: 6 }) },
          { payload: 'helloA5', id: 'X', clock: new Clock({ id: testIdentity.publicKey, time: 7 }) },
          { payload: 'helloD5', id: 'X', clock: new Clock({ id: testIdentity4.publicKey, time: 7 }) },
          { payload: 'helloD6', id: 'X', clock: new Clock({ id: testIdentity4.publicKey, time: 8 }) }
        ]

        const transformed = log4.values.map((e) => {
          return { payload: e.payload, id: e.id, clock: e.clock }
        })

        assert.strictEqual(log4.length, 13)
        assert.deepStrictEqual(transformed, expectedData)
      })

      test('joins logs from 4 logs', async () => {
        await log1.append('helloA1')
        await log1.join(log2)
        await log2.append('helloB1')
        await log2.join(log1)
        await log1.append('helloA2')
        await log2.append('helloB2')

        await log1.join(log3)
        assert.strictEqual(log1.id, 'X')
        assert.strictEqual(log1.clock.id, testIdentity.publicKey)
        assert.strictEqual(log1.clock.time, 2)

        await log3.join(log1)
        assert.strictEqual(log3.id, 'X')
        assert.strictEqual(log3.clock.id, testIdentity3.publicKey)
        assert.strictEqual(log3.clock.time, 2)

        await log3.append('helloC1')
        await log3.append('helloC2')
        await log1.join(log3)
        await log1.join(log2)
        await log4.append('helloD1')
        await log4.append('helloD2')
        await log4.join(log2)
        await log4.join(log1)
        await log4.join(log3)
        await log4.append('helloD3')
        await log4.append('helloD4')

        assert.strictEqual(log4.clock.id, testIdentity4.publicKey)
        assert.strictEqual(log4.clock.time, 6)

        const expectedData = [
          'helloA1',
          'helloB1',
          'helloD1',
          'helloA2',
          'helloB2',
          'helloD2',
          'helloC1',
          'helloC2',
          'helloD3',
          'helloD4'
        ]

        assert.strictEqual(log4.length, 10)
        assert.deepStrictEqual(log4.values.map((e) => e.payload), expectedData)
      })

      describe('takes length as an argument', () => {
        beforeEach(async () => {
          await log1.append('helloA1')
          await log1.append('helloA2')
          await log2.append('helloB1')
          await log2.append('helloB2')
        })

        test('joins only specified amount of entries - one entry', async () => {
          await log1.join(log2, 1)

          const expectedData = [
            'helloB2'
          ]
          const lastEntry = last(log1.values)

          assert.strictEqual(log1.length, 1)
          assert.deepStrictEqual(log1.values.map((e) => e.payload), expectedData)
          assert.strictEqual(lastEntry.next.length, 1)
        })

        test('joins only specified amount of entries - two entries', async () => {
          await log1.join(log2, 2)

          const expectedData = [
            'helloA2', 'helloB2'
          ]
          const lastEntry = last(log1.values)

          assert.strictEqual(log1.length, 2)
          assert.deepStrictEqual(log1.values.map((e) => e.payload), expectedData)
          assert.strictEqual(lastEntry.next.length, 1)
        })

        test('joins only specified amount of entries - three entries', async () => {
          await log1.join(log2, 3)

          const expectedData = [
            'helloB1', 'helloA2', 'helloB2'
          ]
          const lastEntry = last(log1.values)

          assert.strictEqual(log1.length, 3)
          assert.deepStrictEqual(log1.values.map((e) => e.payload), expectedData)
          assert.strictEqual(lastEntry.next.length, 1)
        })

        test('joins only specified amount of entries - (all) four entries', async () => {
          await log1.join(log2, 4)

          const expectedData = [
            'helloA1', 'helloB1', 'helloA2', 'helloB2'
          ]
          const lastEntry = last(log1.values)

          assert.strictEqual(log1.length, 4)
          assert.deepStrictEqual(log1.values.map((e) => e.payload), expectedData)
          assert.strictEqual(lastEntry.next.length, 1)
        })
      })
    })
  })
})
