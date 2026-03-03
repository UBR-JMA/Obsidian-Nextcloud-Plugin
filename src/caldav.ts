import { requestUrl } from 'obsidian';
import { CalendarInfo } from './types';
import { buildAuthHeader, normalizeServerUrl } from './utils';

// ─── CalDAV HTTP Functions ────────────────────────────────────────────────────

export function parseCalendarPropfind(xml: string, baseUrl: string): CalendarInfo[] {
	const calendars: CalendarInfo[] = [];
	const responseRegex = /<[a-zA-Z]+:response[^>]*>([\s\S]*?)<\/[a-zA-Z]+:response>/gi;
	let match: RegExpExecArray | null;

	while ((match = responseRegex.exec(xml)) !== null) {
		const block = match[1];

		// Must be a calendar resource (has <cal:calendar/> in resourcetype)
		if (!/<[a-zA-Z]+:calendar[\s/]/.test(block)) continue;

		// Extract server-relative href
		const hrefMatch = /<[a-zA-Z]+:href>([^<]+)<\/[a-zA-Z]+:href>/i.exec(block);
		if (!hrefMatch) continue;
		const path = hrefMatch[1].trim();

		// Build absolute URL from server base + path
		const serverOrigin = new URL(baseUrl).origin;
		const absoluteUrl = serverOrigin + path;

		// Extract display name
		const nameMatch = /<[a-zA-Z]+:displayname>([^<]*)<\/[a-zA-Z]+:displayname>/i.exec(block);
		const name = nameMatch
			? nameMatch[1].trim()
			: path.split('/').filter(Boolean).pop() ?? 'Calendar';

		// Extract color (Nextcloud appends alpha channel, e.g. #0082c9FF)
		const colorMatch = /<[a-zA-Z]+:calendar-color>([^<]+)<\/[a-zA-Z]+:calendar-color>/i.exec(block);
		const color = colorMatch ? colorMatch[1].trim().substring(0, 7) : '';

		const supportsVEVENT = /name="VEVENT"/i.test(block);
		const supportsVTODO = /name="VTODO"/i.test(block);

		// Skip collections that support neither
		if (!supportsVEVENT && !supportsVTODO) continue;

		calendars.push({ url: absoluteUrl, name, color, supportsVEVENT, supportsVTODO });
	}

	return calendars;
}

export async function fetchCalendars(
	serverUrl: string,
	username: string,
	password: string
): Promise<CalendarInfo[]> {
	const base = normalizeServerUrl(serverUrl);
	const url = `${base}/remote.php/dav/calendars/${encodeURIComponent(username)}/`;

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <d:displayname />
    <cal:supported-calendar-component-set />
    <oc:calendar-color />
    <d:resourcetype />
  </d:prop>
</d:propfind>`;

	const response = await requestUrl({
		url,
		method: 'PROPFIND',
		headers: {
			'Authorization': buildAuthHeader(username, password),
			'Depth': '1',
			'Content-Type': 'application/xml; charset=utf-8',
		},
		body,
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Calendar discovery failed: HTTP ${response.status}`);
	}

	return parseCalendarPropfind(response.text, base);
}

export async function putCalendarObject(
	calendarUrl: string,
	uid: string,
	icsContent: string,
	username: string,
	password: string
): Promise<void> {
	const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
	const url = `${base}${uid}.ics`;

	const response = await requestUrl({
		url,
		method: 'PUT',
		headers: {
			'Authorization': buildAuthHeader(username, password),
			'Content-Type': 'text/calendar; charset=utf-8',
			'If-None-Match': '*',
		},
		body: icsContent,
		throw: false,
	});

	if (response.status !== 201 && response.status !== 204) {
		throw new Error(`Failed to save to calendar: HTTP ${response.status}`);
	}
}

export async function createNote(
	serverUrl: string,
	username: string,
	password: string,
	options: { title: string; content: string }
): Promise<void> {
	const base = normalizeServerUrl(serverUrl);
	const url = `${base}/index.php/apps/notes/api/v1/notes`;

	const response = await requestUrl({
		url,
		method: 'POST',
		headers: {
			'Authorization': buildAuthHeader(username, password),
			'Content-Type': 'application/json',
			'OCS-APIRequest': 'true',
		},
		body: JSON.stringify({ title: options.title, content: options.content, category: '', favorite: false }),
		throw: false,
	});

	if (response.status === 404) {
		throw new Error('Nextcloud Notes app may not be installed on this server.');
	}
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Notes API failed: HTTP ${response.status}`);
	}
}
