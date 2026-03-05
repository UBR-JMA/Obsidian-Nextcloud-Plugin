import { requestUrl } from 'obsidian';
import { CalendarInfo, CalDAVItem } from './types';
import { buildAuthHeader, normalizeServerUrl } from './utils';
import { parseICalProperty } from './ical';

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

export async function updateCalendarObject(
	itemUrl: string,
	etag: string,
	icsContent: string,
	username: string,
	password: string
): Promise<void> {
	const response = await requestUrl({
		url: itemUrl,
		method: 'PUT',
		headers: {
			'Authorization': buildAuthHeader(username, password),
			'Content-Type': 'text/calendar; charset=utf-8',
			'If-Match': etag,
		},
		body: icsContent,
		throw: false,
	});

	if (response.status !== 200 && response.status !== 204) {
		throw new Error(`Failed to update calendar object: HTTP ${response.status}`);
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

// ─── CalDAV REPORT (read) Functions ──────────────────────────────────────────

export function parseCalendarReport(xml: string, serverOrigin: string): CalDAVItem[] {
	const items: CalDAVItem[] = [];
	const responseRegex = /<[a-zA-Z]+:response[^>]*>([\s\S]*?)<\/[a-zA-Z]+:response>/gi;
	let match: RegExpExecArray | null;

	while ((match = responseRegex.exec(xml)) !== null) {
		const block = match[1];

		const hrefMatch = /<[a-zA-Z]+:href>([^<]+)<\/[a-zA-Z]+:href>/i.exec(block);
		if (!hrefMatch) continue;
		const path = hrefMatch[1].trim();

		const etagMatch = /<[a-zA-Z]+:getetag>([^<]+)<\/[a-zA-Z]+:getetag>/i.exec(block);
		const etag = etagMatch ? etagMatch[1].trim() : '';

		const calDataMatch = /<[a-zA-Z]+:calendar-data>([\s\S]*?)<\/[a-zA-Z]+:calendar-data>/i.exec(block);
		if (!calDataMatch) continue;
		const icsData = calDataMatch[1].trim();

		const url = path.startsWith('http') ? path : serverOrigin + path;
		items.push({ url, etag, icsData });
	}

	return items;
}

export async function fetchOpenTasks(
	calendarUrl: string,
	username: string,
	password: string
): Promise<CalDAVItem[]> {
	const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
	const serverOrigin = new URL(calendarUrl).origin;

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

	const response = await requestUrl({
		url: base,
		method: 'REPORT',
		headers: {
			'Authorization': buildAuthHeader(username, password),
			'Depth': '1',
			'Content-Type': 'application/xml; charset=utf-8',
		},
		body,
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Task fetch failed: HTTP ${response.status}`);
	}

	const items = parseCalendarReport(response.text, serverOrigin);
	return items.filter(item => {
		const status = parseICalProperty(item.icsData, 'STATUS');
		return status !== 'COMPLETED' && status !== 'CANCELLED';
	});
}

export async function fetchUpcomingEvents(
	calendarUrl: string,
	username: string,
	password: string,
	days = 7
): Promise<CalDAVItem[]> {
	const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
	const serverOrigin = new URL(calendarUrl).origin;

	const now = new Date();
	const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
	const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${fmt(now)}" end="${fmt(end)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

	const response = await requestUrl({
		url: base,
		method: 'REPORT',
		headers: {
			'Authorization': buildAuthHeader(username, password),
			'Depth': '1',
			'Content-Type': 'application/xml; charset=utf-8',
		},
		body,
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Event fetch failed: HTTP ${response.status}`);
	}

	return parseCalendarReport(response.text, serverOrigin);
}
