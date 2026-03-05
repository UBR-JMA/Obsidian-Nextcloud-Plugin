// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface CalendarInfo {
	url: string;              // absolute DAV URL
	name: string;             // displayname from PROPFIND
	color: string;            // hex color, e.g. "#0082c9"
	supportsVEVENT: boolean;
	supportsVTODO: boolean;
}

export interface NextcloudPluginSettings {
	serverUrl: string;
	username: string;
	password: string;
	defaultCalendarUrl: string;
	defaultCalendarName: string;
	cachedCalendars: CalendarInfo[];
}

export interface CalDAVItem {
	url: string;   // full URL to the .ics file
	etag: string;  // ETag for conditional updates
	icsData: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: NextcloudPluginSettings = {
	serverUrl: '',
	username: '',
	password: '',
	defaultCalendarUrl: '',
	defaultCalendarName: '',
	cachedCalendars: [],
};
