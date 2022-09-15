import { Address, Addressable } from "./io";
import { IPFS } from 'ipfs-core-types/src/'
import { IInitializationOptions } from "./store";
import EventEmitter from "events";
import { Log } from "@dao-xyz/ipfs-log";
import Cache from '@dao-xyz/orbit-db-cache';
import { Entry } from "@dao-xyz/ipfs-log-entry";
import { PublicKey } from "@dao-xyz/identity";

export interface StoreLike<T> extends Addressable {
    init(ipfs: IPFS, key: PublicKey, sign: (data: Uint8Array) => Promise<Uint8Array>, options: IInitializationOptions<any>): Promise<void>;
    close?(): Promise<void>;
    drop?(): Promise<void>;
    load?(): Promise<void>;
    close?(): Promise<void>;
    save?(ipfs: any, options?: {
        format?: string;
        pin?: boolean;
        timeout?: number;
    })
    sync(heads: Entry<T>[]): Promise<void>

    get replicationTopic(): string;
    get events(): EventEmitter;
    get address(): Address
    get oplog(): Log<T>
    get cache(): Cache
    get id(): string;
    get replicate(): boolean;
    getHeads(): Promise<Entry<T>[]>;

}

