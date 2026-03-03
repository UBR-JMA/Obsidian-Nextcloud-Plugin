import { describe, it, expect } from 'vitest';
import { generateVEVENT, generateVTODO } from '../src/ical';

const FIXED_START = new Date('2024-03-01T10:00:00.000Z');
const FIXED_END = new Date('2024-03-01T11:00:00.000Z');
const FIXED_DUE = new Date('2024-03-15T17:00:00.000Z');
const TEST_UID = 'abc123-def456@obsidian-nextcloud';

// ─── generateVEVENT ───────────────────────────────────────────────────────────

describe('generateVEVENT', () => {
	it('wraps the output in VCALENDAR', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toContain('BEGIN:VCALENDAR');
		expect(result).toContain('END:VCALENDAR');
	});

	it('contains a VEVENT block', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toContain('BEGIN:VEVENT');
		expect(result).toContain('END:VEVENT');
	});

	it('includes the correct iCalendar version and product ID', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toContain('VERSION:2.0');
		expect(result).toContain('PRODID:-//Obsidian Nextcloud Plugin//EN');
		expect(result).toContain('CALSCALE:GREGORIAN');
		expect(result).toContain('METHOD:PUBLISH');
	});

	it('includes the UID line matching the provided uid', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toContain(`UID:${TEST_UID}`);
	});

	it('includes a DTSTAMP line in iCal date format', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
	});

	it('includes DTSTART matching the startDate in UTC iCal format', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toContain('DTSTART:20240301T100000Z');
	});

	it('includes DTEND matching the endDate in UTC iCal format', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toContain('DTEND:20240301T110000Z');
	});

	it('includes SUMMARY with the event title', () => {
		const result = generateVEVENT({ title: 'Team Meeting', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toContain('SUMMARY:Team Meeting');
	});

	it('includes DESCRIPTION when description is non-empty', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: 'Weekly sync', uid: TEST_UID });
		expect(result).toContain('DESCRIPTION:Weekly sync');
	});

	it('omits DESCRIPTION when description is empty', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).not.toContain('DESCRIPTION:');
	});

	it('omits DESCRIPTION when description is whitespace only', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '   ', uid: TEST_UID });
		expect(result).not.toContain('DESCRIPTION:');
	});

	it('joins lines with CRLF (\\r\\n)', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toContain('\r\n');
		// All line separators should be CRLF, not bare LF
		const lines = result.split('\r\n');
		expect(lines.length).toBeGreaterThan(5);
	});

	it('folds a long title at 75 characters', () => {
		const longTitle = 'a'.repeat(80);
		const result = generateVEVENT({ title: longTitle, startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		// foldICalLine operates on the title value only (not the "SUMMARY:" prefix),
		// so folding occurs at position 75 of the 80-char title string.
		expect(result).toContain('SUMMARY:' + 'a'.repeat(75) + '\r\n ' + 'a'.repeat(5));
	});

	it('escapes semicolons in the title via foldICalLine', () => {
		const result = generateVEVENT({ title: 'Part1;Part2', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		expect(result).toContain('SUMMARY:Part1\\;Part2');
	});

	it('places VEVENT block between the VCALENDAR wrapper lines', () => {
		const result = generateVEVENT({ title: 'Test', startDate: FIXED_START, endDate: FIXED_END, description: '', uid: TEST_UID });
		const lines = result.split('\r\n');
		const beginCal = lines.indexOf('BEGIN:VCALENDAR');
		const beginEvt = lines.indexOf('BEGIN:VEVENT');
		const endEvt = lines.indexOf('END:VEVENT');
		const endCal = lines.indexOf('END:VCALENDAR');
		expect(beginCal).toBeLessThan(beginEvt);
		expect(beginEvt).toBeLessThan(endEvt);
		expect(endEvt).toBeLessThan(endCal);
	});
});

// ─── generateVTODO ────────────────────────────────────────────────────────────

describe('generateVTODO', () => {
	it('wraps the output in VCALENDAR', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).toContain('BEGIN:VCALENDAR');
		expect(result).toContain('END:VCALENDAR');
	});

	it('contains a VTODO block', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).toContain('BEGIN:VTODO');
		expect(result).toContain('END:VTODO');
	});

	it('does NOT contain a VEVENT block', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).not.toContain('BEGIN:VEVENT');
	});

	it('includes STATUS:NEEDS-ACTION', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).toContain('STATUS:NEEDS-ACTION');
	});

	it('includes the UID line', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).toContain(`UID:${TEST_UID}`);
	});

	it('includes a DTSTAMP line in iCal date format', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
	});

	it('includes SUMMARY with the task title', () => {
		const result = generateVTODO({ title: 'Buy groceries', dueDate: null, description: '', uid: TEST_UID });
		expect(result).toContain('SUMMARY:Buy groceries');
	});

	it('includes DUE line when dueDate is provided', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: FIXED_DUE, description: '', uid: TEST_UID });
		expect(result).toContain('DUE:20240315T170000Z');
	});

	it('omits DUE line when dueDate is null', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).not.toContain('DUE:');
	});

	it('includes DESCRIPTION when description is non-empty', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: 'Buy milk and eggs', uid: TEST_UID });
		expect(result).toContain('DESCRIPTION:Buy milk and eggs');
	});

	it('omits DESCRIPTION when description is empty', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).not.toContain('DESCRIPTION:');
	});

	it('omits DESCRIPTION when description is whitespace only', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '  \n  ', uid: TEST_UID });
		expect(result).not.toContain('DESCRIPTION:');
	});

	it('joins lines with CRLF (\\r\\n)', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).toContain('\r\n');
	});

	it('includes correct iCalendar header fields', () => {
		const result = generateVTODO({ title: 'Test Task', dueDate: null, description: '', uid: TEST_UID });
		expect(result).toContain('VERSION:2.0');
		expect(result).toContain('CALSCALE:GREGORIAN');
		expect(result).toContain('METHOD:PUBLISH');
	});
});
