import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface CalendarInfo {
	url: string;              // absolute DAV URL
	name: string;             // displayname from PROPFIND
	color: string;            // hex color, e.g. "#0082c9"
	supportsVEVENT: boolean;
	supportsVTODO: boolean;
}

interface NextcloudPluginSettings {
	serverUrl: string;
	username: string;
	password: string;
	defaultCalendarUrl: string;
	defaultCalendarName: string;
	cachedCalendars: CalendarInfo[];
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: NextcloudPluginSettings = {
	serverUrl: '',
	username: '',
	password: '',
	defaultCalendarUrl: '',
	defaultCalendarName: '',
	cachedCalendars: [],
}

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

function buildAuthHeader(username: string, password: string): string {
	return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

function normalizeServerUrl(serverUrl: string): string {
	return serverUrl.replace(/\/$/, '');
}

function generateUid(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 10);
	return `${timestamp}-${random}@obsidian-nextcloud`;
}

function toICalDate(date: Date): string {
	return date.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

function toDatetimeLocalString(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function foldICalLine(value: string): string {
	const escaped = value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\n/g, '\\n');

	if (escaped.length <= 75) return escaped;

	let result = '';
	let remaining = escaped;
	while (remaining.length > 75) {
		result += remaining.substring(0, 75) + '\r\n ';
		remaining = remaining.substring(75);
	}
	result += remaining;
	return result;
}

// ─── iCalendar Generators ─────────────────────────────────────────────────────

function generateVEVENT(options: {
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

function generateVTODO(options: {
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

// ─── CalDAV HTTP Functions ────────────────────────────────────────────────────

function parseCalendarPropfind(xml: string, baseUrl: string): CalendarInfo[] {
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

async function fetchCalendars(
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

async function putCalendarObject(
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

async function createNote(
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

// ─── Modals ──────────────────────────────────────────────────────────────────

class CreateEventModal extends Modal {
	plugin: NextcloudPlugin;
	title = '';
	startDate = '';
	endDate = '';
	description = '';
	selectedCalendarUrl = '';

	constructor(app: App, plugin: NextcloudPlugin) {
		super(app);
		this.plugin = plugin;
		this.selectedCalendarUrl = plugin.settings.defaultCalendarUrl;
		const now = new Date();
		const later = new Date(now.getTime() + 60 * 60 * 1000);
		this.startDate = toDatetimeLocalString(now);
		this.endDate = toDatetimeLocalString(later);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Create Nextcloud Event' });

		new Setting(contentEl)
			.setName('Title')
			.addText(text => text
				.setPlaceholder('Event title')
				.onChange(val => { this.title = val; }));

		new Setting(contentEl)
			.setName('Start')
			.addText(text => {
				text.inputEl.type = 'datetime-local';
				text.inputEl.value = this.startDate;
				text.onChange(val => { this.startDate = val; });
			});

		new Setting(contentEl)
			.setName('End')
			.addText(text => {
				text.inputEl.type = 'datetime-local';
				text.inputEl.value = this.endDate;
				text.onChange(val => { this.endDate = val; });
			});

		const calendars = this.plugin.settings.cachedCalendars.filter(c => c.supportsVEVENT);

		if (calendars.length > 0) {
			new Setting(contentEl)
				.setName('Calendar')
				.addDropdown(drop => {
					calendars.forEach(cal => drop.addOption(cal.url, cal.name));
					const defaultVal = calendars.find(c => c.url === this.selectedCalendarUrl)?.url ?? calendars[0].url;
					drop.setValue(defaultVal);
					this.selectedCalendarUrl = defaultVal;
					drop.onChange(val => { this.selectedCalendarUrl = val; });
				});
		} else {
			contentEl.createEl('p', {
				text: 'No calendars found. Visit Settings to refresh your calendars.',
				cls: 'nextcloud-modal-warning',
			});
		}

		new Setting(contentEl)
			.setName('Description')
			.addTextArea(ta => {
				ta.setPlaceholder('Optional description');
				ta.onChange(val => { this.description = val; });
				ta.inputEl.rows = 4;
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Create Event')
				.setCta()
				.onClick(() => this.handleSubmit()));
	}

	async handleSubmit() {
		if (!this.title.trim()) { new Notice('Title is required.'); return; }
		if (!this.selectedCalendarUrl) { new Notice('Please select a calendar.'); return; }

		const start = new Date(this.startDate);
		const end = new Date(this.endDate);

		if (isNaN(start.getTime()) || isNaN(end.getTime())) { new Notice('Invalid date/time values.'); return; }
		if (end <= start) { new Notice('End time must be after start time.'); return; }

		const uid = generateUid();
		const ics = generateVEVENT({ title: this.title, startDate: start, endDate: end, description: this.description, uid });

		try {
			await putCalendarObject(this.selectedCalendarUrl, uid, ics, this.plugin.settings.username, this.plugin.settings.password);
			new Notice(`Event "${this.title}" created!`);
			this.close();
		} catch (e) {
			new Notice(`Failed to create event: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	onClose() { this.contentEl.empty(); }
}

class CreateTaskModal extends Modal {
	plugin: NextcloudPlugin;
	title = '';
	dueDate = '';
	description = '';
	selectedCalendarUrl = '';

	constructor(app: App, plugin: NextcloudPlugin) {
		super(app);
		this.plugin = plugin;
		this.selectedCalendarUrl = plugin.settings.defaultCalendarUrl;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Create Nextcloud Task' });

		new Setting(contentEl)
			.setName('Title')
			.addText(text => text
				.setPlaceholder('Task title')
				.onChange(val => { this.title = val; }));

		new Setting(contentEl)
			.setName('Due date (optional)')
			.addText(text => {
				text.inputEl.type = 'datetime-local';
				text.onChange(val => { this.dueDate = val; });
			});

		const taskLists = this.plugin.settings.cachedCalendars.filter(c => c.supportsVTODO);

		if (taskLists.length > 0) {
			new Setting(contentEl)
				.setName('Task list')
				.addDropdown(drop => {
					taskLists.forEach(cal => drop.addOption(cal.url, cal.name));
					const defaultVal = taskLists.find(c => c.url === this.selectedCalendarUrl)?.url ?? taskLists[0].url;
					drop.setValue(defaultVal);
					this.selectedCalendarUrl = defaultVal;
					drop.onChange(val => { this.selectedCalendarUrl = val; });
				});
		} else {
			contentEl.createEl('p', {
				text: 'No task lists found. Visit Settings to refresh your calendars.',
				cls: 'nextcloud-modal-warning',
			});
		}

		new Setting(contentEl)
			.setName('Notes')
			.addTextArea(ta => {
				ta.setPlaceholder('Optional notes');
				ta.onChange(val => { this.description = val; });
				ta.inputEl.rows = 4;
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Create Task')
				.setCta()
				.onClick(() => this.handleSubmit()));
	}

	async handleSubmit() {
		if (!this.title.trim()) { new Notice('Title is required.'); return; }
		if (!this.selectedCalendarUrl) { new Notice('No task list available. Check settings.'); return; }

		const dueDate = this.dueDate ? new Date(this.dueDate) : null;
		if (dueDate && isNaN(dueDate.getTime())) { new Notice('Invalid due date.'); return; }

		const uid = generateUid();
		const ics = generateVTODO({ title: this.title, dueDate, description: this.description, uid });

		try {
			await putCalendarObject(this.selectedCalendarUrl, uid, ics, this.plugin.settings.username, this.plugin.settings.password);
			new Notice(`Task "${this.title}" created!`);
			this.close();
		} catch (e) {
			new Notice(`Failed to create task: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	onClose() { this.contentEl.empty(); }
}

class CreateNoteModal extends Modal {
	plugin: NextcloudPlugin;
	title = '';
	content = '';

	constructor(app: App, plugin: NextcloudPlugin) {
		super(app);
		this.plugin = plugin;
		const activeFile = app.workspace.getActiveFile();
		if (activeFile) this.title = activeFile.basename;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Create Nextcloud Note' });

		new Setting(contentEl)
			.setName('Title')
			.addText(text => text
				.setPlaceholder('Note title')
				.setValue(this.title)
				.onChange(val => { this.title = val; }));

		new Setting(contentEl)
			.setName('Content')
			.addTextArea(ta => {
				ta.setPlaceholder('Note content');
				ta.onChange(val => { this.content = val; });
				ta.inputEl.rows = 8;
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Create Note')
				.setCta()
				.onClick(() => this.handleSubmit()));
	}

	async handleSubmit() {
		if (!this.title.trim()) { new Notice('Title is required.'); return; }

		try {
			await createNote(this.plugin.settings.serverUrl, this.plugin.settings.username, this.plugin.settings.password, { title: this.title, content: this.content });
			new Notice(`Note "${this.title}" created!`);
			this.close();
		} catch (e) {
			new Notice(`Failed to create note: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	onClose() { this.contentEl.empty(); }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class NextcloudPlugin extends Plugin {
	settings: NextcloudPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('cloud', 'Nextcloud', () => {
			new CreateEventModal(this.app, this).open();
		});

		this.addCommand({
			id: 'test-nextcloud-connection',
			name: 'Test Nextcloud connection',
			callback: () => { this.testConnection(); }
		});

		this.addCommand({
			id: 'create-nextcloud-event',
			name: 'Create Nextcloud event',
			callback: () => { new CreateEventModal(this.app, this).open(); }
		});

		this.addCommand({
			id: 'create-nextcloud-task',
			name: 'Create Nextcloud task',
			callback: () => { new CreateTaskModal(this.app, this).open(); }
		});

		this.addCommand({
			id: 'create-nextcloud-note',
			name: 'Create Nextcloud note',
			callback: () => { new CreateNoteModal(this.app, this).open(); }
		});

		this.addSettingTab(new NextcloudSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async testConnection() {
		const { serverUrl, username, password } = this.settings;

		if (!serverUrl || !username || !password) {
			new Notice('Please configure your Nextcloud settings first.');
			return;
		}

		try {
			const url = `${normalizeServerUrl(serverUrl)}/ocs/v1.php/cloud/capabilities?format=json`;

			const response = await requestUrl({
				url,
				headers: {
					'Authorization': buildAuthHeader(username, password),
					'OCS-APIRequest': 'true',
				},
			});

			if (response.status === 200) {
				new Notice('Successfully connected to Nextcloud!');
			} else {
				new Notice(`Connection failed: HTTP ${response.status}`);
			}
		} catch (error) {
			new Notice(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async refreshCalendars(): Promise<CalendarInfo[]> {
		const { serverUrl, username, password } = this.settings;

		if (!serverUrl || !username || !password) {
			new Notice('Configure Nextcloud settings before refreshing calendars.');
			return [];
		}

		try {
			const calendars = await fetchCalendars(serverUrl, username, password);
			this.settings.cachedCalendars = calendars;

			// If the saved default is no longer in the list, reset to the first calendar
			const stillExists = calendars.find(c => c.url === this.settings.defaultCalendarUrl);
			if (!stillExists && calendars.length > 0) {
				this.settings.defaultCalendarUrl = calendars[0].url;
				this.settings.defaultCalendarName = calendars[0].name;
			}

			await this.saveSettings();
			return calendars;
		} catch (e) {
			new Notice(`Calendar refresh failed: ${e instanceof Error ? e.message : String(e)}`);
			return [];
		}
	}
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class NextcloudSettingTab extends PluginSettingTab {
	plugin: NextcloudPlugin;

	constructor(app: App, plugin: NextcloudPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.addClass('nextcloud-settings');

		containerEl.createEl('h2', { text: 'Nextcloud Settings' });

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('The URL of your Nextcloud instance (e.g. https://nextcloud.example.com).')
			.addText(text => text
				.setPlaceholder('https://nextcloud.example.com')
				.setValue(this.plugin.settings.serverUrl)
				.onChange(async (value) => {
					this.plugin.settings.serverUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Username')
			.setDesc('Your Nextcloud username.')
			.addText(text => text
				.setPlaceholder('username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.setDesc('Your Nextcloud app password (recommended) or account password. Note: credentials are stored unencrypted on disk.')
			.addText(text => {
				text
					.setPlaceholder('password')
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		// ── Calendar Section ──────────────────────────────────────────────────

		containerEl.createEl('h3', { text: 'Calendar' });

		new Setting(containerEl)
			.setName('Calendars')
			.setDesc('Fetch your Nextcloud calendars to select a default for new events and tasks.')
			.addButton(btn => {
				btn.setButtonText('Refresh calendars')
					.onClick(async () => {
						btn.setButtonText('Refreshing…');
						btn.setDisabled(true);
						const calendars = await this.plugin.refreshCalendars();
						btn.setButtonText('Refresh calendars');
						btn.setDisabled(false);
						if (calendars.length > 0) {
							new Notice(`Found ${calendars.length} calendar(s).`);
							this.display();
						} else {
							new Notice('No calendars found.');
						}
					});
			});

		const cached = this.plugin.settings.cachedCalendars;

		if (cached.length > 0) {
			new Setting(containerEl)
				.setName('Default calendar')
				.setDesc('Pre-selected in the Create Event and Create Task modals.')
				.addDropdown(drop => {
					cached.forEach(cal => drop.addOption(cal.url, cal.name));
					drop.setValue(this.plugin.settings.defaultCalendarUrl || cached[0].url);
					drop.onChange(async (val) => {
						const selected = cached.find(c => c.url === val);
						if (selected) {
							this.plugin.settings.defaultCalendarUrl = selected.url;
							this.plugin.settings.defaultCalendarName = selected.name;
							await this.plugin.saveSettings();
						}
					});
				});
		}
	}
}
