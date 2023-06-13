import { PublicSignKey } from "./key.js";
import { PreHash } from "./prehash.js";
import { SignatureWithKey } from "./signature.js";

export interface Signer {
	sign: (
		bytes: Uint8Array,
		prehash?: PreHash
	) => Promise<SignatureWithKey> | SignatureWithKey;
}

export type SignWithKey = (
	bytes: Uint8Array
) => Promise<SignatureWithKey> | SignatureWithKey;

export type Identity<T extends PublicSignKey = PublicSignKey> = Signer & {
	publicKey: T;
};
