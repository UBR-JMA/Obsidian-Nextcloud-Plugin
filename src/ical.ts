import { toICalDate, foldICalLine } from './utils';

// ─── Recurrence ───────────────────────────────────────────────────────────────

export type RecurrenceRule = 'none' | 'daily' | 'weekly' | 'monthly';

const RRULE_MAP: Record<string, string> = {
	daily: 'FREQ=DAILY',
	weekly: 'FREQ=WEEKLY',
	monthly: 'FREQ=MONTHLY',
};

// ─── iCalendar Generators ─────────────────────────────────────────────────────

export function generateVEVENT(options: {
	title: string;
	startDate: Date;
	endDate: Date;
	description: string;
	uid: string;
	recurrence?: RecurrenceRule;
}): string {
	const now = toICalDate(new Date());
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Obsidian Nextcloud Plugin//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${options.uid}`,
		`DTSTAMP:${now}`,
		`DTSTART:${toICalDate(options.startDate)}`,
		`DTEND:${toICalDate(options.endDate)}`,
		`SUMMARY:${foldICalLine(options.title)}`,
	];

	if (options.recurrence && options.recurrence !== 'none') {
		lines.push(`RRULE:${RRULE_MAP[options.recurrence]}`);
	}

	if (options.description.trim()) {
		lines.push(`DESCRIPTION:${foldICalLine(options.description)}`);
	}

	lines.push('END:VEVENT', 'END:VCALENDAR');
	return lines.join('\r\n');
}

export function generateVTODO(options: {
	title: string;
	dueDate: Date | null;
	description: string;
	uid: string;
}): string {
	const now = toICalDate(new Date());
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Obsidian Nextcloud Plugin//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VTODO',
		`UID:${options.uid}`,
		`DTSTAMP:${now}`,
		`SUMMARY:${foldICalLine(options.title)}`,
		'STATUS:NEEDS-ACTION',
	];

	if (options.dueDate) {
		lines.push(`DUE:${toICalDate(options.dueDate)}`);
	}

	if (options.description.trim()) {
		lines.push(`DESCRIPTION:${foldICalLine(options.description)}`);
	}

	lines.push('END:VTODO', 'END:VCALENDAR');
	return lines.join('\r\n');
}

// ─── ICS Parsing Helpers ──────────────────────────────────────────────────────

/**
 * Extract the value of a property from an ICS string.
 * Handles parameters (e.g. DTSTART;TZID=America/New_York:value) and unfolded lines.
 */
export function parseICalProperty(ics: string, property: string): string {
	// Unfold RFC 5545 line-folding (CRLF + space/tab)
	const unfolded = ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
	const regex = new RegExp(`^${property}(?:;[^:]*)?:(.+)$`, 'm');
	const match = regex.exec(unfolded);
	return match ? match[1].trim() : '';
}

/**
 * Return a copy of the ICS string with the task marked as completed.
 * Replaces STATUS with COMPLETED and adds a COMPLETED timestamp.
 */
export function markTaskCompleted(ics: string): string {
	const now = toICalDate(new Date());
	let result = ics;

	if (/^STATUS:/m.test(result)) {
		result = result.replace(/^STATUS:.+$/m, 'STATUS:COMPLETED');
	} else {
		result = result.replace(/^(END:VTODO)/m, `STATUS:COMPLETED\r\n$1`);
	}

	if (!/^COMPLETED:/m.test(result)) {
		result = result.replace(/^(END:VTODO)/m, `COMPLETED:${now}\r\n$1`);
	}

	return result;
}
