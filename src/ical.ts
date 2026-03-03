import { toICalDate, foldICalLine } from './utils';

// ─── iCalendar Generators ─────────────────────────────────────────────────────

export function generateVEVENT(options: {
	title: string;
	startDate: Date;
	endDate: Date;
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
		'BEGIN:VEVENT',
		`UID:${options.uid}`,
		`DTSTAMP:${now}`,
		`DTSTART:${toICalDate(options.startDate)}`,
		`DTEND:${toICalDate(options.endDate)}`,
		`SUMMARY:${foldICalLine(options.title)}`,
	];

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
