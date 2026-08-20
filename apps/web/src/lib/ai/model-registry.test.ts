import { describe, it, expect } from 'vitest';
import {
	AI_MODELS,
	defaultModelForPurpose,
	estimateFrameBudgetSeconds,
	formatDurationEstimate,
	formatModelSize,
	getModelSpec,
	modelsForPurpose,
	allModelsForPurpose,
	type ModelPurpose,
} from './model-registry.js';

const PURPOSES: ModelPurpose[] = ['background-removal', 'upscale', 'colorize'];

/**
 * Purposes that currently have a model anyone can actually download.
 *
 * Colorize is absent: its upstream repository answers 401 and no replacement
 * was found. That is a fact about the world rather than a gap in the code, so
 * it is stated here instead of quietly weakening the checks below.
 */
const DOWNLOADABLE_PURPOSES: ModelPurpose[] = ['background-removal', 'upscale'];

describe('AI_MODELS', () => {
	it('should have unique ids', () => {
		const ids = AI_MODELS.map((model) => model.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('should only reference https URLs', () => {
		for (const model of AI_MODELS) {
			expect(model.url.startsWith('https://')).toBe(true);
		}
	});

	it('should declare a plausible download size for every model', () => {
		for (const model of AI_MODELS) {
			expect(model.bytes).toBeGreaterThan(1024 * 1024);
		}
	});

	it('should have either a null digest or 64 lowercase hex characters', () => {
		for (const model of AI_MODELS) {
			if (model.sha256 === null) continue;
			expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it('should carry three-element normalisation statistics with non-zero std', () => {
		for (const model of AI_MODELS) {
			expect(model.mean).toHaveLength(3);
			expect(model.std).toHaveLength(3);
			for (const std of model.std) expect(std).not.toBe(0);
		}
	});

	it('should only use a scale above 1 for upscalers', () => {
		for (const model of AI_MODELS) {
			expect(model.scale).toBeGreaterThanOrEqual(1);
			if (model.scale > 1) expect(model.purpose).toBe('upscale');
		}
	});

	it('should size upscaler outputs to input times scale', () => {
		for (const model of modelsForPurpose('upscale')) {
			expect(model.output.width).toBe(model.input.width * model.scale);
			expect(model.output.height).toBe(model.input.height * model.scale);
		}
	});

	it('should give every model a licence and a licence URL', () => {
		for (const model of AI_MODELS) {
			expect(model.licence.length).toBeGreaterThan(0);
			expect(model.licenceUrl.startsWith('https://')).toBe(true);
		}
	});

	it('should flag at least one model as non-commercial so the UI can warn', () => {
		expect(AI_MODELS.some((model) => !model.commercialUse)).toBe(true);
	});
});

describe('modelsForPurpose', () => {
	it('should return at least one model for every purpose that has one', () => {
		for (const purpose of DOWNLOADABLE_PURPOSES) {
			expect(modelsForPurpose(purpose).length).toBeGreaterThan(0);
		}
	});

	it('should offer nothing for colorize, whose weights cannot be fetched', () => {
		// Checked live: the SIGGRAPH-17 repository answers 401, and the only
		// ONNX colorizer on the hub is manga-specific. Offering a download that
		// cannot succeed is worse than offering nothing, so the tool has no
		// model until a working one is found.
		expect(modelsForPurpose('colorize')).toEqual([]);
		expect(allModelsForPurpose('colorize').length).toBeGreaterThan(0);
	});

	it('should hide every model whose weights cannot be fetched', () => {
		for (const purpose of PURPOSES) {
			for (const model of modelsForPurpose(purpose)) {
				expect(model.available, `${model.id} is offered but unavailable`).not.toBe(false);
			}
		}
	});

	it('should only return models of the requested purpose', () => {
		for (const purpose of PURPOSES) {
			for (const model of modelsForPurpose(purpose)) {
				expect(model.purpose).toBe(purpose);
			}
		}
	});
});

describe('defaultModelForPurpose', () => {
	it('should resolve exactly one recommended model per usable purpose', () => {
		for (const purpose of DOWNLOADABLE_PURPOSES) {
			const recommended = modelsForPurpose(purpose).filter((model) => model.recommended);
			expect(recommended).toHaveLength(1);
			expect(defaultModelForPurpose(purpose).id).toBe(recommended[0].id);
		}
	});

	it('should throw for an unregistered purpose', () => {
		expect(() => defaultModelForPurpose('nonsense' as ModelPurpose)).toThrow();
	});
});

describe('getModelSpec', () => {
	it('should find a registered model', () => {
		expect(getModelSpec('u2netp')?.purpose).toBe('background-removal');
	});

	it('should return null for an unknown id', () => {
		expect(getModelSpec('does-not-exist')).toBeNull();
	});
});

describe('formatModelSize', () => {
	it('should report bytes below a kilobyte', () => {
		expect(formatModelSize(512)).toBe('512 B');
	});

	it('should report kilobytes', () => {
		expect(formatModelSize(2048)).toBe('2 KB');
	});

	it('should keep one decimal for small megabyte sizes', () => {
		expect(formatModelSize(4_574_861)).toBe('4.4 MB');
	});

	it('should round larger megabyte sizes to whole numbers', () => {
		expect(formatModelSize(176_268_465)).toBe('168 MB');
	});

	it('should switch to gigabytes past 1024 MB', () => {
		expect(formatModelSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
	});
});

describe('estimateFrameBudgetSeconds', () => {
	it('should scale linearly with the frame count', () => {
		const spec = getModelSpec('u2netp')!;
		expect(estimateFrameBudgetSeconds(spec, 100)).toBeCloseTo((spec.wasmFrameMs * 100) / 1000);
	});

	it('should treat a negative frame count as zero', () => {
		expect(estimateFrameBudgetSeconds(getModelSpec('u2netp')!, -5)).toBe(0);
	});
});

describe('formatDurationEstimate', () => {
	it('should describe sub-second work', () => {
		expect(formatDurationEstimate(0.2)).toBe('under a second');
	});

	it('should describe seconds', () => {
		expect(formatDurationEstimate(30)).toBe('about 30 seconds');
	});

	it('should describe minutes', () => {
		expect(formatDurationEstimate(600)).toBe('about 10 minutes');
	});

	it('should describe hours', () => {
		expect(formatDurationEstimate(7200)).toBe('about 2.0 hours');
	});
});
