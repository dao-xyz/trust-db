import hrtime from "./hrtime.js";

export class MovingAverageTracker {
	private lastTS: bigint;

	value = 0;

	constructor(readonly tau = 10) {
		this.lastTS = hrtime.bigint();
	}
	add(number: number) {
		const now = hrtime.bigint();
		const diff = Number(now - this.lastTS) || 1;
		const dt = diff / 1e9;
		this.lastTS = now;
		const alpha_t = 1 - Math.exp(-dt / this.tau);
		this.value = (1 - alpha_t) * this.value + (alpha_t * number) / dt;
	}
}
