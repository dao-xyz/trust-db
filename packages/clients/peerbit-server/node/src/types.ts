export interface StartByVariant {
	variant: string;
}
export interface StartByBase64 {
	base64: string;
}
export type StartProgram = StartByVariant | StartByBase64;

export interface InstallWithTGZ {
	type: "tgz";
	name: string;
	base64: string;
}

export interface InstallWithNPM {
	type: "npm";
	name: string;
}

export type InstallDependency = InstallWithTGZ | InstallWithNPM;
