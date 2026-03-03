import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { parseCalendarPropfind, fetchCalendars, putCalendarObject, createNote } from '../src/caldav';

const mockRequestUrl = vi.mocked(requestUrl);

beforeEach(() => {
	mockRequestUrl.mockReset();
});

// ─── XML Fixtures ─────────────────────────────────────────────────────────────

const MULTI_CALENDAR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname/>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/personal/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Personal</d:displayname>
        <d:resourcetype>
          <d:collection/>
          <cal:calendar/>
        </d:resourcetype>
        <cal:supported-calendar-component-set>
          <cal:comp name="VEVENT"/>
          <cal:comp name="VTODO"/>
        </cal:supported-calendar-component-set>
        <oc:calendar-color>#0082c9FF</oc:calendar-color>
      </d:prop>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/work/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Work</d:displayname>
        <d:resourcetype>
          <d:collection/>
          <cal:calendar/>
        </d:resourcetype>
        <cal:supported-calendar-component-set>
          <cal:comp name="VEVENT"/>
        </cal:supported-calendar-component-set>
        <oc:calendar-color>#e9d100FF</oc:calendar-color>
      </d:prop>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/tasks/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Tasks</d:displayname>
        <d:resourcetype>
          <d:collection/>
          <cal:calendar/>
        </d:resourcetype>
        <cal:supported-calendar-component-set>
          <cal:comp name="VTODO"/>
        </cal:supported-calendar-component-set>
        <oc:calendar-color>#00c9c9FF</oc:calendar-color>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const NO_CALENDARS_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const NEITHER_VEVENT_NOR_VTODO_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/contacts/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Contacts</d:displayname>
        <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
        <cal:supported-calendar-component-set>
          <cal:comp name="VCARD"/>
        </cal:supported-calendar-component-set>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

// No <d:displayname> element at all — triggers path-segment fallback
const NO_DISPLAY_NAME_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/myCal/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
        <cal:supported-calendar-component-set>
          <cal:comp name="VEVENT"/>
        </cal:supported-calendar-component-set>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const BASE_URL = 'https://cloud.example.com';

// ─── parseCalendarPropfind ────────────────────────────────────────────────────

describe('parseCalendarPropfind', () => {
	it('returns an empty array for empty XML', () => {
		expect(parseCalendarPropfind('', BASE_URL)).toEqual([]);
	});

	it('returns an empty array when no <cal:calendar/> resourcetype is present', () => {
		expect(parseCalendarPropfind(NO_CALENDARS_XML, BASE_URL)).toEqual([]);
	});

	it('skips calendars that support neither VEVENT nor VTODO', () => {
		const calendars = parseCalendarPropfind(NEITHER_VEVENT_NOR_VTODO_XML, BASE_URL);
		expect(calendars).toHaveLength(0);
	});

	it('parses a single calendar with all fields', () => {
		const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/calendars/user/personal/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Personal</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <cal:supported-calendar-component-set>
        <cal:comp name="VEVENT"/>
        <cal:comp name="VTODO"/>
      </cal:supported-calendar-component-set>
      <oc:calendar-color>#0082c9FF</oc:calendar-color>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

		const calendars = parseCalendarPropfind(xml, BASE_URL);
		expect(calendars).toHaveLength(1);
		expect(calendars[0]).toEqual({
			url: 'https://cloud.example.com/remote.php/dav/calendars/user/personal/',
			name: 'Personal',
			color: '#0082c9',
			supportsVEVENT: true,
			supportsVTODO: true,
		});
	});

	it('builds the absolute URL using the server origin + the href path', () => {
		const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/user/cal/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Cal</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

		const calendars = parseCalendarPropfind(xml, 'https://mycloud.org');
		expect(calendars[0].url).toBe('https://mycloud.org/remote.php/dav/calendars/user/cal/');
	});

	it('strips the alpha channel from the color (e.g. #0082c9FF → #0082c9)', () => {
		const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/calendars/user/cal/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Cal</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
      <oc:calendar-color>#e9d100FF</oc:calendar-color>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

		const calendars = parseCalendarPropfind(xml, BASE_URL);
		expect(calendars[0].color).toBe('#e9d100');
	});

	it('falls back to the last path segment as the name when displayname is empty', () => {
		const calendars = parseCalendarPropfind(NO_DISPLAY_NAME_XML, BASE_URL);
		expect(calendars).toHaveLength(1);
		expect(calendars[0].name).toBe('myCal');
	});

	it('sets supportsVEVENT=true and supportsVTODO=false for VEVENT-only calendars', () => {
		const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/user/events/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Events</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

		const calendars = parseCalendarPropfind(xml, BASE_URL);
		expect(calendars[0].supportsVEVENT).toBe(true);
		expect(calendars[0].supportsVTODO).toBe(false);
	});

	it('sets supportsVEVENT=false and supportsVTODO=true for VTODO-only calendars', () => {
		const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/user/tasks/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Tasks</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

		const calendars = parseCalendarPropfind(xml, BASE_URL);
		expect(calendars[0].supportsVEVENT).toBe(false);
		expect(calendars[0].supportsVTODO).toBe(true);
	});

	it('parses multiple calendars from one XML response (real fixture)', () => {
		const calendars = parseCalendarPropfind(MULTI_CALENDAR_XML, BASE_URL);
		// First response (collection only) is skipped
		expect(calendars).toHaveLength(3);

		expect(calendars[0]).toMatchObject({
			url: 'https://cloud.example.com/remote.php/dav/calendars/alice/personal/',
			name: 'Personal',
			color: '#0082c9',
			supportsVEVENT: true,
			supportsVTODO: true,
		});
		expect(calendars[1]).toMatchObject({
			url: 'https://cloud.example.com/remote.php/dav/calendars/alice/work/',
			name: 'Work',
			color: '#e9d100',
			supportsVEVENT: true,
			supportsVTODO: false,
		});
		expect(calendars[2]).toMatchObject({
			url: 'https://cloud.example.com/remote.php/dav/calendars/alice/tasks/',
			name: 'Tasks',
			color: '#00c9c9',
			supportsVEVENT: false,
			supportsVTODO: true,
		});
	});

	it('sets color to empty string when no calendar-color element is present', () => {
		const xml = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/remote.php/dav/calendars/user/cal/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Cal</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

		const calendars = parseCalendarPropfind(xml, BASE_URL);
		expect(calendars[0].color).toBe('');
	});
});

// ─── fetchCalendars ───────────────────────────────────────────────────────────

describe('fetchCalendars', () => {
	const SINGLE_CAL_XML = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/personal/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Personal</d:displayname>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
      <oc:calendar-color>#0082c9FF</oc:calendar-color>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

	it('calls requestUrl with PROPFIND method', async () => {
		mockRequestUrl.mockResolvedValue({ status: 207, text: SINGLE_CAL_XML });
		await fetchCalendars('https://cloud.example.com', 'alice', 'secret');
		expect(mockRequestUrl).toHaveBeenCalledOnce();
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect(call.method).toBe('PROPFIND');
	});

	it('constructs the correct URL with the normalized server URL and encoded username', async () => {
		mockRequestUrl.mockResolvedValue({ status: 207, text: SINGLE_CAL_XML });
		await fetchCalendars('https://cloud.example.com/', 'alice doe', 'secret');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect(call.url).toBe('https://cloud.example.com/remote.php/dav/calendars/alice%20doe/');
	});

	it('sets the Depth: 1 header', async () => {
		mockRequestUrl.mockResolvedValue({ status: 207, text: SINGLE_CAL_XML });
		await fetchCalendars('https://cloud.example.com', 'alice', 'secret');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect((call.headers as Record<string, string>)['Depth']).toBe('1');
	});

	it('sets an Authorization header', async () => {
		mockRequestUrl.mockResolvedValue({ status: 207, text: SINGLE_CAL_XML });
		await fetchCalendars('https://cloud.example.com', 'alice', 'secret');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect((call.headers as Record<string, string>)['Authorization']).toMatch(/^Basic /);
	});

	it('sets throw: false to handle errors manually', async () => {
		mockRequestUrl.mockResolvedValue({ status: 207, text: SINGLE_CAL_XML });
		await fetchCalendars('https://cloud.example.com', 'alice', 'secret');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect(call.throw).toBe(false);
	});

	it('returns parsed calendars on a 207 success response', async () => {
		mockRequestUrl.mockResolvedValue({ status: 207, text: SINGLE_CAL_XML });
		const calendars = await fetchCalendars('https://cloud.example.com', 'alice', 'secret');
		expect(calendars).toHaveLength(1);
		expect(calendars[0].name).toBe('Personal');
	});

	it('returns parsed calendars on a 200 success response', async () => {
		mockRequestUrl.mockResolvedValue({ status: 200, text: SINGLE_CAL_XML });
		const calendars = await fetchCalendars('https://cloud.example.com', 'alice', 'secret');
		expect(calendars).toHaveLength(1);
	});

	it('throws on HTTP 401 unauthorized', async () => {
		mockRequestUrl.mockResolvedValue({ status: 401, text: '' });
		await expect(fetchCalendars('https://cloud.example.com', 'alice', 'wrongpass')).rejects.toThrow('Calendar discovery failed: HTTP 401');
	});

	it('throws on HTTP 404 not found', async () => {
		mockRequestUrl.mockResolvedValue({ status: 404, text: '' });
		await expect(fetchCalendars('https://cloud.example.com', 'alice', 'secret')).rejects.toThrow('Calendar discovery failed: HTTP 404');
	});

	it('throws on HTTP 500 server error', async () => {
		mockRequestUrl.mockResolvedValue({ status: 500, text: '' });
		await expect(fetchCalendars('https://cloud.example.com', 'alice', 'secret')).rejects.toThrow('Calendar discovery failed: HTTP 500');
	});
});

// ─── putCalendarObject ────────────────────────────────────────────────────────

describe('putCalendarObject', () => {
	const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';

	it('calls requestUrl with PUT method', async () => {
		mockRequestUrl.mockResolvedValue({ status: 201 });
		await putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect(call.method).toBe('PUT');
	});

	it('constructs the URL as {calendarUrl}/{uid}.ics (calendarUrl already has trailing slash)', async () => {
		mockRequestUrl.mockResolvedValue({ status: 201 });
		await putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect(call.url).toBe('https://cloud.example.com/cal/uid-123.ics');
	});

	it('appends trailing slash to calendarUrl if missing', async () => {
		mockRequestUrl.mockResolvedValue({ status: 201 });
		await putCalendarObject('https://cloud.example.com/cal', 'uid-456', ICS, 'user', 'pass');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect(call.url).toBe('https://cloud.example.com/cal/uid-456.ics');
	});

	it('sets Content-Type: text/calendar header', async () => {
		mockRequestUrl.mockResolvedValue({ status: 201 });
		await putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect((call.headers as Record<string, string>)['Content-Type']).toBe('text/calendar; charset=utf-8');
	});

	it('sets If-None-Match: * header', async () => {
		mockRequestUrl.mockResolvedValue({ status: 201 });
		await putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect((call.headers as Record<string, string>)['If-None-Match']).toBe('*');
	});

	it('sets an Authorization header', async () => {
		mockRequestUrl.mockResolvedValue({ status: 201 });
		await putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect((call.headers as Record<string, string>)['Authorization']).toMatch(/^Basic /);
	});

	it('sends the ICS content as the request body', async () => {
		mockRequestUrl.mockResolvedValue({ status: 201 });
		await putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass');
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect(call.body).toBe(ICS);
	});

	it('resolves without error on HTTP 201 Created', async () => {
		mockRequestUrl.mockResolvedValue({ status: 201 });
		await expect(putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass')).resolves.toBeUndefined();
	});

	it('resolves without error on HTTP 204 No Content', async () => {
		mockRequestUrl.mockResolvedValue({ status: 204 });
		await expect(putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass')).resolves.toBeUndefined();
	});

	it('throws on HTTP 403 Forbidden', async () => {
		mockRequestUrl.mockResolvedValue({ status: 403 });
		await expect(putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass')).rejects.toThrow('Failed to save to calendar: HTTP 403');
	});

	it('throws on HTTP 500 Server Error', async () => {
		mockRequestUrl.mockResolvedValue({ status: 500 });
		await expect(putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass')).rejects.toThrow('Failed to save to calendar: HTTP 500');
	});

	it('throws on HTTP 409 Conflict (object already exists)', async () => {
		mockRequestUrl.mockResolvedValue({ status: 409 });
		await expect(putCalendarObject('https://cloud.example.com/cal/', 'uid-123', ICS, 'user', 'pass')).rejects.toThrow('Failed to save to calendar: HTTP 409');
	});
});

// ─── createNote ───────────────────────────────────────────────────────────────

describe('createNote', () => {
	it('calls requestUrl with POST method', async () => {
		mockRequestUrl.mockResolvedValue({ status: 200 });
		await createNote('https://cloud.example.com', 'alice', 'pass', { title: 'My Note', content: 'Hello' });
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect(call.method).toBe('POST');
	});

	it('constructs the URL using the normalized server URL', async () => {
		mockRequestUrl.mockResolvedValue({ status: 200 });
		await createNote('https://cloud.example.com/', 'alice', 'pass', { title: 'My Note', content: 'Hello' });
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect(call.url).toBe('https://cloud.example.com/index.php/apps/notes/api/v1/notes');
	});

	it('sets Content-Type: application/json header', async () => {
		mockRequestUrl.mockResolvedValue({ status: 200 });
		await createNote('https://cloud.example.com', 'alice', 'pass', { title: 'My Note', content: '' });
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect((call.headers as Record<string, string>)['Content-Type']).toBe('application/json');
	});

	it('sets the OCS-APIRequest: true header', async () => {
		mockRequestUrl.mockResolvedValue({ status: 200 });
		await createNote('https://cloud.example.com', 'alice', 'pass', { title: 'My Note', content: '' });
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect((call.headers as Record<string, string>)['OCS-APIRequest']).toBe('true');
	});

	it('sets an Authorization header', async () => {
		mockRequestUrl.mockResolvedValue({ status: 200 });
		await createNote('https://cloud.example.com', 'alice', 'pass', { title: 'My Note', content: '' });
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		expect((call.headers as Record<string, string>)['Authorization']).toMatch(/^Basic /);
	});

	it('sends the title and content as JSON in the body', async () => {
		mockRequestUrl.mockResolvedValue({ status: 200 });
		await createNote('https://cloud.example.com', 'alice', 'pass', { title: 'My Note', content: 'Hello world' });
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		const body = JSON.parse(call.body as string);
		expect(body.title).toBe('My Note');
		expect(body.content).toBe('Hello world');
	});

	it('sends category as empty string and favorite as false in the body', async () => {
		mockRequestUrl.mockResolvedValue({ status: 200 });
		await createNote('https://cloud.example.com', 'alice', 'pass', { title: 'Note', content: '' });
		const call = mockRequestUrl.mock.calls[0][0] as Record<string, unknown>;
		const body = JSON.parse(call.body as string);
		expect(body.category).toBe('');
		expect(body.favorite).toBe(false);
	});

	it('resolves without error on HTTP 200', async () => {
		mockRequestUrl.mockResolvedValue({ status: 200 });
		await expect(createNote('https://cloud.example.com', 'alice', 'pass', { title: 'Note', content: '' })).resolves.toBeUndefined();
	});

	it('resolves without error on HTTP 201 Created', async () => {
		mockRequestUrl.mockResolvedValue({ status: 201 });
		await expect(createNote('https://cloud.example.com', 'alice', 'pass', { title: 'Note', content: '' })).resolves.toBeUndefined();
	});

	it('throws a Notes-specific message on HTTP 404 (app not installed)', async () => {
		mockRequestUrl.mockResolvedValue({ status: 404 });
		await expect(createNote('https://cloud.example.com', 'alice', 'pass', { title: 'Note', content: '' })).rejects.toThrow('Nextcloud Notes app may not be installed on this server.');
	});

	it('throws a generic error message on HTTP 500', async () => {
		mockRequestUrl.mockResolvedValue({ status: 500 });
		await expect(createNote('https://cloud.example.com', 'alice', 'pass', { title: 'Note', content: '' })).rejects.toThrow('Notes API failed: HTTP 500');
	});

	it('throws on HTTP 401 Unauthorized', async () => {
		mockRequestUrl.mockResolvedValue({ status: 401 });
		await expect(createNote('https://cloud.example.com', 'alice', 'wrongpass', { title: 'Note', content: '' })).rejects.toThrow('Notes API failed: HTTP 401');
	});
});
