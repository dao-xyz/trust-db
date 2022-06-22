
import { StringResultSource, StringStore, STRING_STORE_TYPE } from '../string-store';
import { QueryRequestV0, QueryResponseV0, ResultWithSource, StringQueryRequest, StringMatchQuery, RangeCoordinate, RangeCoordinates } from '@dao-xyz/bquery';
import { query } from '@dao-xyz/bquery';
import { disconnectPeers, getConnectedPeers, Peer } from '@dao-xyz/peer-test-utils';
import { waitFor } from '@dao-xyz/time';
import { IStoreOptions } from '@dao-xyz/orbit-db-store';

const storeTestSetup = async (): Promise<{
    creator: Peer,
    observer: Peer,
    storeCreator: StringStore
    storeObserver: StringStore
}> => {


    let [peer, observer] = await getConnectedPeers(2);

    // Create store
    let storeCreator = await peer.orbitDB.open<StringStore>('store', { ...{ create: true, type: STRING_STORE_TYPE, subscribeToQueries: true } })
    await storeCreator.load();
    let storeObserver = await observer.orbitDB.open<StringStore>(storeCreator.address.toString(), { ...{ create: true, type: STRING_STORE_TYPE, subscribeToQueries: false, replicate: false } })

    expect(await peer.node.pubsub.ls()).toHaveLength(2); // replication and query topic
    expect(await observer.node.pubsub.ls()).toHaveLength(0);

    return {
        creator: peer,
        observer,
        storeCreator,
        storeObserver
    }
}



describe('query', () => {

    test('match all', async () => {
        let {
            creator,
            observer,
            storeCreator
        } = await storeTestSetup();

        let blocks = storeCreator;
        await blocks.add('hello', { offset: 0 });
        await blocks.add('world', { offset: 'hello '.length });

        let response: QueryResponseV0 = undefined;

        await query(observer.node.pubsub, blocks.queryTopic, new QueryRequestV0({
            type: new StringQueryRequest({
                queries: []
            })
        }), (r: QueryResponseV0) => {
            response = r;
        })
        await waitFor(() => !!response);
        expect(response.results).toHaveLength(1);
        expect(((response.results[0]) as ResultWithSource)).toMatchObject(new ResultWithSource({
            source: new StringResultSource({
                string: 'hello world'
            }),
            coordinates: undefined //  because we are matching without any specific query
        }));
        await disconnectPeers([creator, observer]);

    });

    test('match part', async () => {
        let {
            creator,
            observer,
            storeCreator
        } = await storeTestSetup();

        let blocks = storeCreator;
        await blocks.add('hello', { offset: 0 });
        await blocks.add('world', { offset: 'hello '.length });

        let response: QueryResponseV0 = undefined;

        await query(observer.node.pubsub, blocks.queryTopic, new QueryRequestV0({
            type: new StringQueryRequest({
                queries: [new StringMatchQuery({
                    exactMatch: true,
                    value: 'o w'
                }),
                new StringMatchQuery({
                    exactMatch: true,
                    value: 'orld'
                })]
            })
        }), (r: QueryResponseV0) => {
            response = r;
        })
        await waitFor(() => !!response);
        expect(response.results).toHaveLength(1);
        let result = ((response.results[0]) as ResultWithSource);
        expect(result.source).toMatchObject(new StringResultSource({
            string: 'hello world'
        }));
        expect((result.coordinates as RangeCoordinates).coordinates).toHaveLength(2);
        expect((result.coordinates as RangeCoordinates).coordinates[0].offset.toNumber()).toEqual('hell'.length);
        expect((result.coordinates as RangeCoordinates).coordinates[0].length.toNumber()).toEqual('w o'.length);
        expect((result.coordinates as RangeCoordinates).coordinates[1].offset.toNumber()).toEqual('hello w'.length);
        expect((result.coordinates as RangeCoordinates).coordinates[1].length.toNumber()).toEqual('orld'.length);
        await disconnectPeers([creator, observer]);

    });



}) 