import { describe, it, expect } from 'vitest';
import {
	buildAuthHeader,
	normalizeServerUrl,
	generateUid,
	toICalDate,
	toDatetimeLocalString,
	foldICalLine,
} from '../src/utils';

// ─── buildAuthHeader ──────────────────────────────────────────────────────────

describe('buildAuthHeader', () => {
	it('returns a string starting with "Basic "', () => {
		expect(buildAuthHeader('user', 'pass')).toMatch(/^Basic /);
	});

	it('correctly base64-encodes username:password', () => {
		const header = buildAuthHeader('alice', 'secret');
		const expected = 'Basic ' + Buffer.from('alice:secret').toString('base64');
		expect(header).toBe(expected);
	});

	it('handles special characters in credentials', () => {
		const header = buildAuthHeader('user@domain.com', 'p@$$w0rd!');
		const expected = 'Basic ' + Buffer.from('user@domain.com:p@$$w0rd!').toString('base64');
		expect(header).toBe(expected);
	});

	it('handles empty username', () => {
		const header = buildAuthHeader('', 'pass');
		const expected = 'Basic ' + Buffer.from(':pass').toString('base64');
		expect(header).toBe(expected);
	});

	it('handles empty password', () => {
		const header = buildAuthHeader('user', '');
		const expected = 'Basic ' + Buffer.from('user:').toString('base64');
		expect(header).toBe(expected);
	});

	it('handles colons in the password', () => {
		const header = buildAuthHeader('user', 'pa:ss:word');
		const expected = 'Basic ' + Buffer.from('user:pa:ss:word').toString('base64');
		expect(header).toBe(expected);
	});
});

// ─── normalizeServerUrl ───────────────────────────────────────────────────────

describe('normalizeServerUrl', () => {
	it('strips a single trailing slash', () => {
		expect(normalizeServerUrl('https://cloud.example.com/')).toBe('https://cloud.example.com');
	});

	it('leaves a URL without trailing slash unchanged', () => {
		expect(normalizeServerUrl('https://cloud.example.com')).toBe('https://cloud.example.com');
	});

	it('strips only the last trailing slash when multiple are present', () => {
		// /\/$/ matches only one slash at the end
		expect(normalizeServerUrl('https://cloud.example.com//')).toBe('https://cloud.example.com/');
	});

	it('preserves path segments', () => {
		expect(normalizeServerUrl('https://cloud.example.com/nextcloud/')).toBe('https://cloud.example.com/nextcloud');
	});

	it('handles a bare URL with no path', () => {
		expect(normalizeServerUrl('https://cloud.example.com')).toBe('https://cloud.example.com');
	});

	it('handles localhost URLs', () => {
		expect(normalizeServerUrl('http://localhost:8080/')).toBe('http://localhost:8080');
	});
});

// ─── generateUid ─────────────────────────────────────────────────────────────

describe('generateUid', () => {
	it('returns a string containing "@obsidian-nextcloud"', () => {
		expect(generateUid()).toContain('@obsidian-nextcloud');
	});

	it('matches the expected format: {timestamp}-{random}@obsidian-nextcloud', () => {
		const uid = generateUid();
		expect(uid).toMatch(/^[a-z0-9]+-[a-z0-9]+@obsidian-nextcloud$/);
	});

	it('generates unique UIDs on consecutive calls', () => {
		const uids = new Set(Array.from({ length: 10 }, () => generateUid()));
		expect(uids.size).toBe(10);
	});

	it('has a non-empty timestamp segment', () => {
		const uid = generateUid();
		const [timestampPart] = uid.split('-');
		expect(timestampPart.length).toBeGreaterThan(0);
	});
});

// ─── toICalDate ───────────────────────────────────────────────────────────────

describe('toICalDate', () => {
	it('converts a UTC date to iCal format (no dashes, colons, or milliseconds)', () => {
		const date = new Date('2024-01-15T10:30:00.000Z');
		expect(toICalDate(date)).toBe('20240115T103000Z');
	});

	it('strips milliseconds from the output', () => {
		const date = new Date('2024-06-20T00:00:00.999Z');
		expect(toICalDate(date)).toBe('20240620T000000Z');
	});

	it('removes all dashes', () => {
		const result = toICalDate(new Date('2024-03-03T12:00:00.000Z'));
		expect(result).not.toContain('-');
	});

	it('removes all colons', () => {
		const result = toICalDate(new Date('2024-03-03T12:00:00.000Z'));
		expect(result).not.toContain(':');
	});

	it('removes the millisecond dot-suffix', () => {
		const result = toICalDate(new Date('2024-03-03T12:00:00.000Z'));
		expect(result).not.toContain('.');
	});

	it('ends with Z indicating UTC', () => {
		expect(toICalDate(new Date('2024-01-01T00:00:00.000Z'))).toMatch(/Z$/);
	});

	it('correctly formats midnight UTC', () => {
		expect(toICalDate(new Date('2024-12-31T00:00:00.000Z'))).toBe('20241231T000000Z');
	});
});

// ─── toDatetimeLocalString ────────────────────────────────────────────────────

describe('toDatetimeLocalString', () => {
	it('returns a string matching YYYY-MM-DDTHH:MM format', () => {
		const result = toDatetimeLocalString(new Date());
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
	});

	it('zero-pads single-digit month', () => {
		const result = toDatetimeLocalString(new Date());
		const month = result.split('T')[0].split('-')[1];
		expect(month).toHaveLength(2);
	});

	it('zero-pads single-digit day', () => {
		const result = toDatetimeLocalString(new Date());
		const day = result.split('T')[0].split('-')[2];
		expect(day).toHaveLength(2);
	});

	it('zero-pads single-digit hour', () => {
		const result = toDatetimeLocalString(new Date());
		const hour = result.split('T')[1].split(':')[0];
		expect(hour).toHaveLength(2);
	});

	it('zero-pads single-digit minute', () => {
		const result = toDatetimeLocalString(new Date());
		const minute = result.split('T')[1].split(':')[1];
		expect(minute).toHaveLength(2);
	});

	it('contains a T separator between date and time parts', () => {
		const result = toDatetimeLocalString(new Date());
		expect(result).toContain('T');
		expect(result.split('T')).toHaveLength(2);
	});
});

// ─── foldICalLine ─────────────────────────────────────────────────────────────

describe('foldICalLine', () => {
	it('returns a short string (≤75 chars) unchanged', () => {
		const short = 'Short string with no special chars';
		expect(foldICalLine(short)).toBe(short);
	});

	it('returns a string of exactly 75 chars unchanged', () => {
		const exact = 'a'.repeat(75);
		expect(foldICalLine(exact)).toBe(exact);
	});

	it('folds a 76-char string: first 75 chars + CRLF-space + remainder', () => {
		const long = 'a'.repeat(76);
		expect(foldICalLine(long)).toBe('a'.repeat(75) + '\r\n ' + 'a');
	});

	it('folds a 150-char string into two 75-char segments', () => {
		const long = 'a'.repeat(150);
		expect(foldICalLine(long)).toBe('a'.repeat(75) + '\r\n ' + 'a'.repeat(75));
	});

	it('folds a 226-char string into three segments', () => {
		const long = 'a'.repeat(226);
		// 226 = 75 + 75 + 75 + 1
		const expected = 'a'.repeat(75) + '\r\n ' + 'a'.repeat(75) + '\r\n ' + 'a'.repeat(75) + '\r\n ' + 'a';
		expect(foldICalLine(long)).toBe(expected);
	});

	it('escapes backslashes', () => {
		expect(foldICalLine('path\\to\\file')).toBe('path\\\\to\\\\file');
	});

	it('escapes semicolons', () => {
		expect(foldICalLine('part1;part2')).toBe('part1\\;part2');
	});

	it('escapes commas', () => {
		expect(foldICalLine('item1,item2')).toBe('item1\\,item2');
	});

	it('escapes newlines', () => {
		expect(foldICalLine('line1\nline2')).toBe('line1\\nline2');
	});

	it('escapes multiple types of special characters in one string', () => {
		expect(foldICalLine('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
	});

	it('escapes backslash before other special chars (order matters)', () => {
		// A literal backslash followed by a semicolon: \; → \\; → \\;
		expect(foldICalLine('\\;')).toBe('\\\\\\;');
	});

	it('folds AND escapes a long string with special characters', () => {
		// 37 a's + semicolon + 42 b's = 80 chars raw
		// After escaping: 37 a's + \; (2 chars) + 42 b's = 81 chars → needs folding
		const value = 'a'.repeat(37) + ';' + 'b'.repeat(42);
		const result = foldICalLine(value);
		expect(result).toContain('\\;');
		expect(result).toContain('\r\n ');
	});

	it('returns empty string for empty input', () => {
		expect(foldICalLine('')).toBe('');
	});
});
