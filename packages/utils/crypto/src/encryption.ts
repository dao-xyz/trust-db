export * from "./errors.js";

import {
	AbstractType,
	deserialize,
	field,
	serialize,
	variant,
	vec,
	fixedArray
} from "@dao-xyz/borsh";
import { equals } from "@peerbit/uint8arrays";
import { AccessError } from "./errors.js";
import sodium from "libsodium-wrappers";
import { X25519Keypair, X25519PublicKey, X25519SecretKey } from "./x25519.js";
import { Ed25519PublicKey } from "./ed25519.js";
import { randomBytes } from "./random.js";
import { sha256 } from "./hash.js";

export type PublicKeyEncryptionParameters = {
	type?: "publicKey";
	receiverPublicKeys: (X25519PublicKey | Ed25519PublicKey)[];
};

export type SymmetricKeyEncryptionParameters = {
	type?: "hash";
};
/* 
export type NoExchange = {
	type: 'none'
};
 */

export type KeyExchangeOptions =
	| PublicKeyEncryptionParameters
	| SymmetricKeyEncryptionParameters;

type EncryptReturnValue<
	T,
	Parameters extends KeyExchangeOptions
> = EncryptedThing<T, EnvelopeFromParameter<Parameters>>;

type CipherWithEnvelope<E = PublicKeyEnvelope | HashedKeyEnvelope> = {
	cipher: Uint8Array;
	nonce: Uint8Array;
	envelope: E;
};

type SymmetricKeys = Uint8Array;
type PublicKeyEncryptionKeys = X25519Keypair;

function isAsymmetriEncryptionParameters(
	parameters: KeyExchangeOptions
): parameters is PublicKeyEncryptionParameters {
	return (
		(parameters as PublicKeyEncryptionParameters).receiverPublicKeys != null
	);
}
function isAsymmetricEncryptionKeys(
	parameters: PublicKeyEncryptionKeys | SymmetricKeys
): parameters is PublicKeyEncryptionKeys {
	return (parameters as PublicKeyEncryptionKeys) instanceof X25519Keypair;
}

type EnvelopeFromParameter<Parameters extends KeyExchangeOptions> =
	Parameters extends PublicKeyEncryptionParameters
		? PublicKeyEnvelope
		: HashedKeyEnvelope;

export type EncryptProvide<Parameters extends KeyExchangeOptions> = (
	bytes: Uint8Array,
	parameters: Parameters
) => Promise<CipherWithEnvelope<EnvelopeFromParameter<Parameters>>>;

export const createLocalEncryptProvider = <
	K extends PublicKeyEncryptionKeys | SymmetricKeys,
	Parameters extends KeyExchangeOptions = K extends PublicKeyEncryptionKeys
		? PublicKeyEncryptionParameters
		: SymmetricKeyEncryptionParameters
>(
	keys: K
) => {
	return async (
		bytes: Uint8Array,
		parameters: Parameters
	): Promise<CipherWithEnvelope<EnvelopeFromParameter<Parameters>>> => {
		const nonce = randomBytes(NONCE_LENGTH); // crypto random is faster than sodim random
		if (
			isAsymmetriEncryptionParameters(parameters) &&
			isAsymmetricEncryptionKeys(keys)
		) {
			const epheremalKey = sodium.crypto_secretbox_keygen();
			const cipher = sodium.crypto_secretbox_easy(bytes, nonce, epheremalKey);
			const { receiverPublicKeys } = parameters;
			const receiverX25519PublicKeys = await Promise.all(
				receiverPublicKeys.map((key) => {
					if (key instanceof Ed25519PublicKey) {
						return X25519PublicKey.from(key);
					}
					return key;
				})
			);

			const ks = receiverX25519PublicKeys.map((receiverPublicKey) => {
				const kNonce = randomBytes(NONCE_LENGTH); // crypto random is faster than sodium random
				return new K({
					encryptedKey: new CipherWithNonce({
						cipher: sodium.crypto_box_easy(
							epheremalKey,
							kNonce,
							receiverPublicKey.publicKey,
							keys.secretKey.secretKey
						),
						nonce: kNonce
					}),
					receiverPublicKey
				});
			});

			return {
				cipher: new Uint8Array(cipher), // TODO do we need this clone?
				nonce,
				envelope: new PublicKeyEnvelope({
					senderPublicKey: keys.publicKey,
					ks
				}) as EnvelopeFromParameter<Parameters>
			};
		} else if (
			!isAsymmetriEncryptionParameters(parameters) &&
			!isAsymmetricEncryptionKeys(keys)
		) {
			const cipher = sodium.crypto_secretbox_easy(bytes, nonce, keys);
			return {
				cipher: new Uint8Array(cipher), // TODO do we need this clone?
				nonce,
				envelope: new HashedKeyEnvelope({
					hash: await sha256(keys)
				}) as EnvelopeFromParameter<Parameters>
			};
		}

		throw new Error("Unexpected encryption parameters");
	};
};

export type DecryptProvider = (
	encrypted: Uint8Array,
	nonce: Uint8Array,
	exchange: Envelope
) => Promise<Uint8Array>;

export type KeyResolverReturnType<
	PublicKey extends X25519PublicKey | Uint8Array
> =
	| (PublicKey extends X25519PublicKey ? X25519Keypair : Uint8Array)
	| undefined;

export type KeyResolver = <PublicKey extends X25519PublicKey | Uint8Array>(
	key: PublicKey
) => Promise<KeyResolverReturnType<PublicKey>>;

export const createDecrypterFromKeyResolver = (
	keyResolver: KeyResolver
): DecryptProvider => {
	return async (
		encrypted: Uint8Array,
		nonce: Uint8Array,
		exchange: Envelope
	): Promise<Uint8Array> => {
		// We only need to open with one of the keys

		let epheremalKey: Uint8Array | undefined;

		if (exchange instanceof PublicKeyEnvelope) {
			let key: { index: number; keypair: X25519Keypair } | undefined;
			for (const [i, k] of exchange._ks.entries()) {
				const exported = keyResolver(k._receiverPublicKey);
				if (exported) {
					key = {
						index: i,
						keypair: await exported
					};
					break;
				}
			}

			if (key) {
				const k = exchange[key.index];
				let secretKey: X25519SecretKey = undefined as any;
				if (key.keypair instanceof X25519Keypair) {
					secretKey = key.keypair.secretKey;
				} else {
					secretKey = await X25519SecretKey.from(key.keypair);
				}
				let epheremalKey: Uint8Array;
				try {
					epheremalKey = sodium.crypto_box_open_easy(
						k._encryptedKey.cipher,
						k._encryptedKey.nonce,
						exchange._senderPublicKey.publicKey,
						secretKey.secretKey
					);
				} catch (error) {
					throw new AccessError("Failed to decrypt");
				}
			} else {
				throw new AccessError("Failed to resolve decryption key");
			}
		} else if (exchange instanceof HashedKeyEnvelope) {
			epheremalKey = await keyResolver(exchange.hash);
		}

		if (!epheremalKey) {
			throw new Error("Failed to resolve ephemeral key");
		}

		return sodium.crypto_secretbox_open_easy(encrypted, nonce, epheremalKey);
	};
};

const NONCE_LENGTH = 24;

@variant(0)
export abstract class MaybeEncrypted<T> {
	/**
	 * Will throw error if not decrypted
	 */
	get decrypted(): DecryptedThing<T> {
		throw new Error("Not implented");
	}

	decrypt(
		provider?: DecryptProvider
	): Promise<DecryptedThing<T>> | DecryptedThing<T> {
		throw new Error("Not implemented");
	}
	equals(other: MaybeEncrypted<T>): boolean {
		throw new Error("Not implemented");
	}

	/**
	 * Clear cached data
	 */
	clear() {
		throw new Error("Not implemented");
	}

	abstract get byteLength(): number;
}

@variant(0)
export class DecryptedThing<T> extends MaybeEncrypted<T> {
	@field({ type: Uint8Array })
	_data?: Uint8Array;

	constructor(props?: { data?: Uint8Array; value?: T }) {
		super();
		if (props) {
			this._data = props.data;
			this._value = props.value;
		}
	}

	_value?: T;
	getValue(clazz: AbstractType<T>): T {
		if (this._value) {
			return this._value;
		}
		if (!this._data) {
			throw new Error("Missing data");
		}
		return deserialize(this._data, clazz);
	}

	async encrypt<Parameters extends KeyExchangeOptions>(
		provider: EncryptProvide<Parameters>,
		parameters: Parameters
	): Promise<EncryptReturnValue<T, Parameters>> {
		const bytes = serialize(this);
		const { cipher, envelope, nonce } = await provider(bytes, parameters);
		const enc = new EncryptedThing<T, EnvelopeFromParameter<Parameters>>({
			encrypted: cipher,
			envelope,
			nonce
		});
		enc._decrypted = this;
		return enc;
	}

	get decrypted(): DecryptedThing<T> {
		return this;
	}

	decrypt(): DecryptedThing<T> {
		return this;
	}

	equals(other: MaybeEncrypted<T>) {
		if (other instanceof DecryptedThing) {
			return equals(this._data, other._data);
		} else {
			return false;
		}
	}

	clear() {
		this._value = undefined;
	}

	get byteLength() {
		return this._data!.byteLength;
	}
}

@variant(0)
export class CipherWithNonce {
	@field({ type: Uint8Array })
	nonce: Uint8Array;

	@field({ type: Uint8Array })
	cipher: Uint8Array;

	constructor(props?: { nonce: Uint8Array; cipher: Uint8Array }) {
		if (props) {
			this.nonce = props.nonce;
			this.cipher = props.cipher;
		}
	}

	equals(other: CipherWithNonce): boolean {
		if (other instanceof CipherWithNonce) {
			return (
				equals(this.nonce, other.nonce) && equals(this.cipher, other.cipher)
			);
		} else {
			return false;
		}
	}
}

@variant(0)
export class K {
	@field({ type: CipherWithNonce })
	_encryptedKey: CipherWithNonce;

	@field({ type: X25519PublicKey })
	_receiverPublicKey: X25519PublicKey;

	constructor(props?: {
		encryptedKey: CipherWithNonce;
		receiverPublicKey: X25519PublicKey;
	}) {
		if (props) {
			this._encryptedKey = props.encryptedKey;
			this._receiverPublicKey = props.receiverPublicKey;
		}
	}

	equals(other: K): boolean {
		if (other instanceof K) {
			return (
				this._encryptedKey.equals(other._encryptedKey) &&
				this._receiverPublicKey.equals(other._receiverPublicKey)
			);
		} else {
			return false;
		}
	}
}

abstract class Envelope {
	abstract equals(other: Envelope): boolean;
}

@variant(0)
class PublicKeyEnvelope extends Envelope {
	@field({ type: X25519PublicKey })
	_senderPublicKey: X25519PublicKey;

	@field({ type: vec(K) })
	_ks: K[];

	constructor(props?: { senderPublicKey: X25519PublicKey; ks: K[] }) {
		super();
		if (props) {
			this._senderPublicKey = props.senderPublicKey;
			this._ks = props.ks;
		}
	}

	// TODO: should this be comparable to AbstractEnvelope?
	equals(other: PublicKeyEnvelope): boolean {
		if (other instanceof PublicKeyEnvelope) {
			if (!this._senderPublicKey.equals(other._senderPublicKey)) {
				return false;
			}

			if (this._ks.length !== other._ks.length) {
				return false;
			}
			for (let i = 0; i < this._ks.length; i++) {
				if (!this._ks[i].equals(other._ks[i])) {
					return false;
				}
			}
			return true;
		} else {
			return false;
		}
	}
}

@variant(1)
class HashedKeyEnvelope extends Envelope {
	@field({ type: fixedArray("u8", 32) })
	hash: Uint8Array;
	// TODO: Do we need a salt here?
	constructor(props?: { hash: Uint8Array }) {
		super();
		if (props) {
			this.hash = props.hash;
		}
	}

	// TODO: should this be comparable to AbstractEnvelope?
	equals(other: HashedKeyEnvelope): boolean {
		if (other instanceof HashedKeyEnvelope) {
			if (!equals(this.hash, other.hash)) {
				return false;
			}
			return true;
		} else {
			return false;
		}
	}
}

@variant(1)
export class EncryptedThing<
	T,
	E extends Envelope = PublicKeyEnvelope | HashedKeyEnvelope
> extends MaybeEncrypted<T> {
	@field({ type: Uint8Array })
	_encrypted: Uint8Array;

	@field({ type: Uint8Array })
	_nonce: Uint8Array;

	@field({ type: Envelope })
	_keyexchange: E;

	constructor(props?: {
		encrypted: Uint8Array;
		nonce: Uint8Array;
		envelope: E;
	}) {
		super();
		if (props) {
			this._encrypted = props.encrypted;
			this._nonce = props.nonce;
			this._keyexchange = props.envelope;
		}
	}

	_decrypted?: DecryptedThing<T>;
	get decrypted(): DecryptedThing<T> {
		if (!this._decrypted) {
			throw new Error(
				"Entry has not been decrypted, invoke decrypt method before"
			);
		}
		return this._decrypted;
	}

	async decrypt(provider?: DecryptProvider): Promise<DecryptedThing<T>> {
		if (this._decrypted) {
			return this._decrypted;
		}

		if (!provider) {
			throw new AccessError("Expecting decryption provider");
		}

		const decrypted = await provider(
			this._encrypted,
			this._nonce,
			this._keyexchange
		);
		if (decrypted) {
			const der = deserialize(decrypted, DecryptedThing);

			this._decrypted = der as DecryptedThing<T>;
			return this._decrypted;
		}

		throw new AccessError("Failed to resolve decryption key");
	}

	equals(other: MaybeEncrypted<T>): boolean {
		if (other instanceof EncryptedThing) {
			if (!equals(this._encrypted, other._encrypted)) {
				return false;
			}
			if (!equals(this._nonce, other._nonce)) {
				return false;
			}

			if (!this._keyexchange.equals(other._keyexchange)) {
				return false;
			}
			return true;
		} else {
			return false;
		}
	}

	clear() {
		this._decrypted = undefined;
	}

	get byteLength() {
		return this._encrypted.byteLength; // ignore other metdata for now in the size calculation
	}
}
