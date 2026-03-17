import { describe, it, expect } from 'vitest';
import { exportSRT } from './srt.js';
import type { CaptionSegment } from '$lib/types/index.js';

describe('exportSRT', () => {
	it('should return empty string for empty segments', () => {
		expect(exportSRT([])).toBe('');
	});

	it('should format a single segment correctly', () => {
		const segments: CaptionSegment[] = [
			{ id: '1', text: 'Hello world', startTime: 0, endTime: 2.5 },
		];
		const result = exportSRT(segments);
		expect(result).toBe('1\n00:00:00,000 --> 00:00:02,500\nHello world\n');
	});

	it('should format multiple segments with sequential indices', () => {
		const segments: CaptionSegment[] = [
			{ id: 'a', text: 'First', startTime: 0, endTime: 1 },
			{ id: 'b', text: 'Second', startTime: 1.5, endTime: 3 },
			{ id: 'c', text: 'Third', startTime: 3.5, endTime: 5 },
		];
		const result = exportSRT(segments);
		const blocks = result.split('\n\n');
		expect(blocks.length).toBe(3);
		expect(blocks[0]).toContain('1\n');
		expect(blocks[1]).toContain('2\n');
		expect(blocks[2]).toContain('3\n');
	});

	it('should format hours correctly', () => {
		const segments: CaptionSegment[] = [
			{ id: '1', text: 'Late segment', startTime: 3661.5, endTime: 3665.25 },
		];
		const result = exportSRT(segments);
		// 3661.5s = 1h 1m 1s 500ms
		expect(result).toContain('01:01:01,500');
		// 3665.25s = 1h 1m 5s 250ms
		expect(result).toContain('01:01:05,250');
	});

	it('should pad time components with leading zeros', () => {
		const segments: CaptionSegment[] = [
			{ id: '1', text: 'Test', startTime: 0.001, endTime: 0.1 },
		];
		const result = exportSRT(segments);
		expect(result).toContain('00:00:00,001');
		expect(result).toContain('00:00:00,100');
	});

	it('should handle exact second boundaries', () => {
		const segments: CaptionSegment[] = [
			{ id: '1', text: 'Test', startTime: 60, endTime: 120 },
		];
		const result = exportSRT(segments);
		expect(result).toContain('00:01:00,000');
		expect(result).toContain('00:02:00,000');
	});

	it('should use SRT arrow separator (-->)', () => {
		const segments: CaptionSegment[] = [
			{ id: '1', text: 'Test', startTime: 0, endTime: 1 },
		];
		const result = exportSRT(segments);
		expect(result).toContain(' --> ');
	});

	it('should preserve the text content as-is', () => {
		const segments: CaptionSegment[] = [
			{ id: '1', text: 'Line with special chars: <b>bold</b> & "quotes"', startTime: 0, endTime: 1 },
		];
		const result = exportSRT(segments);
		expect(result).toContain('Line with special chars: <b>bold</b> & "quotes"');
	});

	it('should separate segments with blank lines', () => {
		const segments: CaptionSegment[] = [
			{ id: '1', text: 'First', startTime: 0, endTime: 1 },
			{ id: '2', text: 'Second', startTime: 1, endTime: 2 },
		];
		const result = exportSRT(segments);
		// Each block ends with \n, then \n joins them, so there's \n\n between blocks
		expect(result).toContain('First\n\n2\n');
	});

	it('should handle zero duration segments', () => {
		const segments: CaptionSegment[] = [
			{ id: '1', text: 'Instant', startTime: 5, endTime: 5 },
		];
		const result = exportSRT(segments);
		expect(result).toContain('00:00:05,000 --> 00:00:05,000');
	});
});
