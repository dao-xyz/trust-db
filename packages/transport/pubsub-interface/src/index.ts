import { PublicSignKey } from "@peerbit/crypto";
import { PubSubData } from "./messages.js";
import {
	Message,
	DataMessage,
	WaitForPeer,
	PeerEvents,
	DeliveryMode
} from "@peerbit/stream-interface";
import { EventHandler } from "@libp2p/interface/events";
import { PeerId as Libp2pPeerId } from "@libp2p/interface/peer-id";
import { field, vec } from "@dao-xyz/borsh";

export class SubscriptionEvent {
	@field({ type: PublicSignKey })
	from: PublicSignKey;

	@field({ type: vec("string") })
	subscriptions: string[];

	constructor(from: PublicSignKey, subscriptions: string[]) {
		this.from = from;
		this.subscriptions = subscriptions;
	}
}

export class UnsubcriptionEvent {
	@field({ type: PublicSignKey })
	from: PublicSignKey;

	@field({ type: vec("string") })
	unsubscriptions: string[];

	constructor(from: PublicSignKey, unsubscriptions: string[]) {
		this.from = from;
		this.unsubscriptions = unsubscriptions;
	}
}

export class PublishEvent {
	@field({ type: PubSubData })
	data: PubSubData;

	@field({ type: DataMessage })
	message: DataMessage;

	client?: string;

	constructor(properties: {
		client?: string;
		data: PubSubData;
		message: DataMessage;
	}) {
		this.client = properties.client;
		this.data = properties.data;
		this.message = properties.message;
	}
}

export class DataEvent {
	@field({ type: PubSubData })
	data: PubSubData;

	@field({ type: DataMessage })
	message: DataMessage;

	constructor(properties: { data: PubSubData; message: DataMessage }) {
		this.data = properties.data;
		this.message = properties.message;
	}
}

export class SubscriptionData {
	@field({ type: PublicSignKey })
	publicKey: PublicSignKey;

	@field({ type: "u64" })
	timestamp: bigint;

	constructor(properties: { publicKey: PublicSignKey; timestamp: bigint }) {
		this.publicKey = properties.publicKey;
		this.timestamp = properties.timestamp;
	}
}

export interface PubSubEvents extends PeerEvents {
	publish: CustomEvent<DataEvent>;
	data: CustomEvent<DataEvent>;
	subscribe: CustomEvent<SubscriptionEvent>;
	unsubscribe: CustomEvent<UnsubcriptionEvent>;
	message: CustomEvent<Message>;
}
export interface IEventEmitter<EventMap extends Record<string, any>> {
	addEventListener<K extends keyof EventMap>(
		type: K,
		listener: EventHandler<EventMap[K]> | null,
		options?: boolean | AddEventListenerOptions
	): MaybePromise<void>;
	removeEventListener<K extends keyof EventMap>(
		type: K,
		listener?: EventHandler<EventMap[K]> | null,
		options?: boolean | EventListenerOptions
	): MaybePromise<void>;
	dispatchEvent(event: Event): MaybePromise<boolean>;
}

type MaybePromise<T> = Promise<T> | T;
export type PublishOptions = (
	| {
			topics?: string[];
			to?: (string | PublicSignKey | Libp2pPeerId)[];
			mode?: DeliveryMode | undefined;
	  }
	| {
			topics: string[];
			to: (string | PublicSignKey | Libp2pPeerId)[];
			mode?: DeliveryMode | undefined;
	  }
) & { client?: string };

export interface PubSub extends IEventEmitter<PubSubEvents>, WaitForPeer {
	getSubscribers(topic: string): MaybePromise<PublicSignKey[] | undefined>;

	requestSubscribers(topic: string, from?: PublicSignKey): MaybePromise<void>;

	subscribe(topic: string): MaybePromise<void>;

	unsubscribe(
		topic: string,
		options?: {
			force?: boolean;
			data?: Uint8Array;
		}
	): MaybePromise<boolean>;

	publish(data: Uint8Array, options?: PublishOptions): MaybePromise<Uint8Array>;
}

export * from "./messages.js";
