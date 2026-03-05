import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import { CalendarInfo, CalDAVItem, NextcloudPluginSettings, DEFAULT_SETTINGS } from './src/types';
import { buildAuthHeader, normalizeServerUrl, generateUid, toDatetimeLocalString } from './src/utils';
import { generateVEVENT, generateVTODO, parseICalProperty, markTaskCompleted, RecurrenceRule } from './src/ical';
import { fetchCalendars, putCalendarObject, updateCalendarObject, createNote, fetchOpenTasks, fetchUpcomingEvents } from './src/caldav';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEditorSelection(app: App): string {
	const editor = app.workspace.activeEditor?.editor;
	return editor?.getSelection() ?? '';
}

function formatICalDateForDisplay(dtstart: string): string {
	if (!dtstart) return '';
	// Strip any timezone param prefix (e.g. TZID=...) — parseICalProperty already strips params
	const clean = dtstart.includes(':') ? dtstart.split(':').slice(-1)[0] : dtstart;
	if (clean.length === 8) {
		return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(6, 8)}`;
	}
	const year = clean.substring(0, 4);
	const month = clean.substring(4, 6);
	const day = clean.substring(6, 8);
	const hour = clean.substring(9, 11);
	const min = clean.substring(11, 13);
	return `${year}-${month}-${day} ${hour}:${min}`;
}

// ─── Modals ──────────────────────────────────────────────────────────────────

class CreateEventModal extends Modal {
	plugin: NextcloudPlugin;
	title = '';
	startDate = '';
	endDate = '';
	description = '';
	selectedCalendarUrl = '';
	recurrence: RecurrenceRule = 'none';

	constructor(app: App, plugin: NextcloudPlugin) {
		super(app);
		this.plugin = plugin;
		this.selectedCalendarUrl = plugin.settings.defaultCalendarUrl;
		const now = new Date();
		const later = new Date(now.getTime() + 60 * 60 * 1000);
		this.startDate = toDatetimeLocalString(now);
		this.endDate = toDatetimeLocalString(later);

		// Quick-capture: pre-fill title from selected text
		const selection = getEditorSelection(app);
		if (selection.trim()) this.title = selection.trim();
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Create Nextcloud Event' });

		new Setting(contentEl)
			.setName('Title')
			.addText(text => {
				text.setPlaceholder('Event title').setValue(this.title);
				text.onChange(val => { this.title = val; });
			});

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

		new Setting(contentEl)
			.setName('Recurrence')
			.addDropdown(drop => {
				drop.addOption('none', 'None');
				drop.addOption('daily', 'Daily');
				drop.addOption('weekly', 'Weekly');
				drop.addOption('monthly', 'Monthly');
				drop.setValue(this.recurrence);
				drop.onChange(val => { this.recurrence = val as RecurrenceRule; });
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
		const ics = generateVEVENT({
			title: this.title,
			startDate: start,
			endDate: end,
			description: this.description,
			uid,
			recurrence: this.recurrence,
		});

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

		// Quick-capture: pre-fill title from selected text
		const selection = getEditorSelection(app);
		if (selection.trim()) this.title = selection.trim();
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Create Nextcloud Task' });

		new Setting(contentEl)
			.setName('Title')
			.addText(text => {
				text.setPlaceholder('Task title').setValue(this.title);
				text.onChange(val => { this.title = val; });
			});

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

		// Quick-capture: pre-fill content from selected text
		const selection = getEditorSelection(app);
		if (selection.trim()) this.content = selection.trim();
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
				ta.setValue(this.content);
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

class ListEventsModal extends Modal {
	plugin: NextcloudPlugin;

	constructor(app: App, plugin: NextcloudPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Upcoming Events (next 7 days)' });

		const loadingEl = contentEl.createEl('p', { text: 'Loading…', cls: 'nextcloud-modal-loading' });

		this.loadEvents(contentEl, loadingEl);
	}

	private async loadEvents(contentEl: HTMLElement, loadingEl: HTMLElement) {
		const { serverUrl, username, password, cachedCalendars } = this.plugin.settings;

		if (!serverUrl || !username || !password) {
			loadingEl.setText('Configure Nextcloud settings first.');
			return;
		}

		const eventCalendars = cachedCalendars.filter(c => c.supportsVEVENT);
		if (eventCalendars.length === 0) {
			loadingEl.setText('No calendars found. Refresh calendars in Settings.');
			return;
		}

		try {
			const results = await Promise.all(
				eventCalendars.map(cal =>
					fetchUpcomingEvents(cal.url, username, password, 7)
						.then(items => items.map(item => ({ item, calName: cal.name })))
						.catch(() => [] as { item: CalDAVItem; calName: string }[])
				)
			);

			loadingEl.remove();

			const entries = results.flat().sort((a, b) => {
				const dtA = parseICalProperty(a.item.icsData, 'DTSTART');
				const dtB = parseICalProperty(b.item.icsData, 'DTSTART');
				return dtA.localeCompare(dtB);
			});

			if (entries.length === 0) {
				contentEl.createEl('p', { text: 'No upcoming events in the next 7 days.' });
				return;
			}

			const listEl = contentEl.createEl('div', { cls: 'nextcloud-item-list' });
			for (const { item, calName } of entries) {
				const summary = parseICalProperty(item.icsData, 'SUMMARY');
				const dtstart = parseICalProperty(item.icsData, 'DTSTART');
				const dtend = parseICalProperty(item.icsData, 'DTEND');

				const rowEl = listEl.createEl('div', { cls: 'nextcloud-item-row' });
				rowEl.createEl('span', { text: `[${calName}] `, cls: 'nextcloud-item-calendar' });
				rowEl.createEl('strong', { text: summary });
				rowEl.createEl('span', {
					text: `  ${formatICalDateForDisplay(dtstart)} → ${formatICalDateForDisplay(dtend)}`,
					cls: 'nextcloud-item-date',
				});
			}
		} catch (e) {
			loadingEl.setText(`Failed to load events: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	onClose() { this.contentEl.empty(); }
}

class ListTasksModal extends Modal {
	plugin: NextcloudPlugin;

	constructor(app: App, plugin: NextcloudPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Open Tasks' });

		const loadingEl = contentEl.createEl('p', { text: 'Loading…', cls: 'nextcloud-modal-loading' });

		this.loadTasks(contentEl, loadingEl);
	}

	private async loadTasks(contentEl: HTMLElement, loadingEl: HTMLElement) {
		const { serverUrl, username, password, cachedCalendars } = this.plugin.settings;

		if (!serverUrl || !username || !password) {
			loadingEl.setText('Configure Nextcloud settings first.');
			return;
		}

		const taskCalendars = cachedCalendars.filter(c => c.supportsVTODO);
		if (taskCalendars.length === 0) {
			loadingEl.setText('No task lists found. Refresh calendars in Settings.');
			return;
		}

		try {
			const results = await Promise.all(
				taskCalendars.map(cal =>
					fetchOpenTasks(cal.url, username, password)
						.then(items => items.map(item => ({ item, cal })))
						.catch(() => [] as { item: CalDAVItem; cal: CalendarInfo }[])
				)
			);

			loadingEl.remove();

			const entries = results.flat().sort((a, b) => {
				const dueA = parseICalProperty(a.item.icsData, 'DUE') || 'z';
				const dueB = parseICalProperty(b.item.icsData, 'DUE') || 'z';
				return dueA.localeCompare(dueB);
			});

			if (entries.length === 0) {
				contentEl.createEl('p', { text: 'No open tasks.' });
				return;
			}

			const listEl = contentEl.createEl('div', { cls: 'nextcloud-item-list' });
			for (const { item, cal } of entries) {
				this.renderTaskRow(listEl, item, cal, username, password);
			}
		} catch (e) {
			loadingEl.setText(`Failed to load tasks: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private renderTaskRow(
		listEl: HTMLElement,
		item: CalDAVItem,
		cal: CalendarInfo,
		username: string,
		password: string
	) {
		const summary = parseICalProperty(item.icsData, 'SUMMARY');
		const due = parseICalProperty(item.icsData, 'DUE');

		const rowEl = listEl.createEl('div', { cls: 'nextcloud-item-row' });
		rowEl.createEl('span', { text: `[${cal.name}] `, cls: 'nextcloud-item-calendar' });
		rowEl.createEl('strong', { text: summary });
		if (due) {
			rowEl.createEl('span', { text: `  due: ${formatICalDateForDisplay(due)}`, cls: 'nextcloud-item-date' });
		}

		const completeBtn = rowEl.createEl('button', { text: 'Complete', cls: 'nextcloud-complete-btn' });
		completeBtn.addEventListener('click', async () => {
			completeBtn.setText('Completing…');
			completeBtn.disabled = true;
			try {
				const updatedIcs = markTaskCompleted(item.icsData);
				await updateCalendarObject(item.url, item.etag, updatedIcs, username, password);
				new Notice(`Task "${summary}" marked complete.`);
				rowEl.remove();
			} catch (e) {
				new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`);
				completeBtn.setText('Complete');
				completeBtn.disabled = false;
			}
		});
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

		this.addCommand({
			id: 'list-nextcloud-events',
			name: 'List upcoming Nextcloud events',
			callback: () => { new ListEventsModal(this.app, this).open(); }
		});

		this.addCommand({
			id: 'list-nextcloud-tasks',
			name: 'List open Nextcloud tasks',
			callback: () => { new ListTasksModal(this.app, this).open(); }
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
