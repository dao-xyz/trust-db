
import assert from 'assert'
import rmrf from 'rimraf'
import { delay, waitFor } from '@dao-xyz/time'

import { OrbitDB, StoreWithConfig } from '../orbit-db'

import { EventStore, Operation } from './utils/stores/event-store'
import { jest } from '@jest/globals';
import { Controller } from "ipfsd-ctl";
import { IPFS } from "ipfs-core-types";
// @ts-ignore 
import { v4 as uuid } from 'uuid';

// Include test utilities
import {
    nodeConfig as config,
    startIpfs,
    stopIpfs,
    testAPIs,
    connectPeers,
    waitForPeers,
} from '@dao-xyz/peerbit-test-utils'
import { Store } from '@dao-xyz/peerbit-dstore'

const orbitdbPath1 = './orbitdb/tests/write-only/1'
const orbitdbPath2 = './orbitdb/tests/write-only/2'
const dbPath1 = './orbitdb/tests/write-only/1/db1'
const dbPath2 = './orbitdb/tests/write-only/2/db2'


Object.keys(testAPIs).forEach(API => {
    describe(`orbit-db - Write-only (${API})`, function () {
        jest.setTimeout(config.timeout * 2)

        let ipfsd1: Controller, ipfsd2: Controller, ipfs1: IPFS, ipfs2: IPFS
        let orbitdb1: OrbitDB, orbitdb2: OrbitDB, db1: EventStore<string>, db2: EventStore<string>
        let replicationTopic: string;
        let timer: any

        beforeAll(async () => {
            ipfsd1 = await startIpfs(API, config.daemon1)
            ipfsd2 = await startIpfs(API, config.daemon2)
            ipfs1 = ipfsd1.api
            ipfs2 = ipfsd2.api
            replicationTopic = uuid();
            // Connect the peers manually to speed up test times
            const isLocalhostAddress = (addr: string) => addr.toString().includes('127.0.0.1')
            await connectPeers(ipfs1, ipfs2, { filter: isLocalhostAddress })
            console.log("Peers connected")
        })

        afterAll(async () => {
            if (ipfsd1)
                await stopIpfs(ipfsd1)

            if (ipfsd2)
                await stopIpfs(ipfsd2)
        })

        beforeEach(async () => {
            clearInterval(timer)

            rmrf.sync(orbitdbPath1)
            rmrf.sync(orbitdbPath2)
            rmrf.sync(dbPath1)
            rmrf.sync(dbPath2)

            orbitdb1 = await OrbitDB.createInstance(ipfs1, {
                directory: orbitdbPath1,/*  canAccessKeys: async (requester, _keyToAccess) => {
                    return requester.equals(orbitdb2.identity.publicKey); // allow orbitdb1 to share keys with orbitdb2
                },  */waitForKeysTimout: 1000
            })
            orbitdb2 = await OrbitDB.createInstance(ipfs2, { directory: orbitdbPath2 })
            db1 = await orbitdb1.open(new EventStore<string>({
                name: 'abc',

            }), replicationTopic, { directory: dbPath1 })
        })

        afterEach(async () => {
            clearInterval(timer)

            if (db1)
                await db1.store.drop()

            if (db2)
                await db2.store.drop()

            if (orbitdb1)
                await orbitdb1.stop()

            if (orbitdb2)
                await orbitdb2.stop()
        })

        it('write 1 entry replicate false', async () => {

            await waitForPeers(ipfs2, [orbitdb1.id], replicationTopic)
            db2 = await orbitdb2.open<EventStore<string>>(await EventStore.load<EventStore<string>>(orbitdb2._ipfs, db1.address), replicationTopic, { directory: dbPath2, replicate: false })

            await db1.add('hello');
            /*   await waitFor(() => db2._oplog.clock.time > 0); */
            await db2.add('world');

            await waitFor(() => db1.store.oplog.values.length === 2);
            expect(db1.store.oplog.values.map(x => x.payload.getValue().value)).toContainAllValues(['hello', 'world'])
            expect(db2.store.oplog.values.length).toEqual(1);

        })

        it('encrypted clock sync write 1 entry replicate false', async () => {

            await waitForPeers(ipfs2, [orbitdb1.id], replicationTopic)
            const encryptionKey = await orbitdb1.keystore.createEd25519Key({ id: 'encryption key', group: replicationTopic });
            db2 = await orbitdb2.open<EventStore<string>>(await EventStore.load<EventStore<string>>(orbitdb2._ipfs, db1.address), replicationTopic, { directory: dbPath2, replicate: false })

            await db1.add('hello', {
                reciever: {
                    clock: encryptionKey.keypair.publicKey,
                    payload: encryptionKey.keypair.publicKey,
                    signature: encryptionKey.keypair.publicKey
                }
            });

            /*   await waitFor(() => db2._oplog.clock.time > 0); */

            // Now the db2 will request sync clocks even though it does not replicate any content
            await db2.add('world');

            await waitFor(() => db1.store.oplog.values.length === 2);
            expect(db1.store.oplog.values.map(x => x.payload.getValue().value)).toContainAllValues(['hello', 'world'])
            expect(db2.store.oplog.values.length).toEqual(1);
        })

        it('will open store on exchange heads message', async () => {

            const replicationTopic = 'x';
            const store = new EventStore<string>({ name: 'replication-tests' });
            await orbitdb2.subscribeToReplicationTopic(replicationTopic);
            await orbitdb1.open(store, replicationTopic, { replicate: false }); // this would be a "light" client, write -only

            const hello = await store.add('hello', { nexts: [] });
            const world = await store.add('world', { nexts: [hello] });

            expect(store.store.oplog.heads).toHaveLength(1);

            await waitFor(() => Object.values(orbitdb2.programs[replicationTopic]).length > 0, { timeout: 20 * 1000, delayInterval: 50 });

            const replicatedProgramAndStores = Object.values(orbitdb2.programs[replicationTopic])[0];
            const replicatedStore: StoreWithConfig = replicatedProgramAndStores.stores.values().next().value
            await waitFor(() => replicatedStore.store.oplog.values.length == 2);
            expect(replicatedStore).toBeDefined();
            expect(replicatedStore.store.oplog.heads).toHaveLength(1);
            expect(replicatedStore.store.oplog.heads[0].hash).toEqual(world.hash);

        })
    })
})
