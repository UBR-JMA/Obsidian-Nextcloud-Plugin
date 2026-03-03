import { vi } from 'vitest';

// Mock for Obsidian's requestUrl function — replaced per-test via mockResolvedValue etc.
export const requestUrl = vi.fn();

export class App {
	workspace = {
		getActiveFile: vi.fn().mockReturnValue(null),
	};
}

export class Plugin {
	app: App;
	constructor() { this.app = new App(); }
	addRibbonIcon() { return { addClass: vi.fn() }; }
	addCommand() {}
	addSettingTab() {}
	loadData = vi.fn().mockResolvedValue({});
	saveData = vi.fn().mockResolvedValue(undefined);
}

export class Modal {
	app: unknown;
	contentEl = {
		createEl: vi.fn().mockReturnValue({ addClass: vi.fn() }),
		empty: vi.fn(),
		addClass: vi.fn(),
	};
	constructor(app: unknown) { this.app = app; }
	open() {}
	close() {}
}

export class Notice {
	constructor(_msg: string) {}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl = {
		empty: vi.fn(),
		createEl: vi.fn().mockReturnValue({}),
		addClass: vi.fn(),
	};
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
	display() {}
}

export class Setting {
	constructor(_el: unknown) {}
	setName() { return this; }
	setDesc() { return this; }
	setCta() { return this; }
	setDisabled() { return this; }
	setButtonText() { return this; }
	setValue() { return this; }
	addText(_cb: (t: unknown) => void) {
		_cb({
			inputEl: { type: '', value: '' },
			setPlaceholder() { return this; },
			setValue() { return this; },
			onChange() { return this; },
		});
		return this;
	}
	addTextArea(_cb: (t: unknown) => void) {
		_cb({
			inputEl: { rows: 0 },
			setPlaceholder() { return this; },
			onChange() { return this; },
		});
		return this;
	}
	addButton(_cb: (b: unknown) => void) {
		_cb({
			setButtonText() { return this; },
			setCta() { return this; },
			setDisabled() { return this; },
			onClick(_fn: () => void) { return this; },
		});
		return this;
	}
	addDropdown(_cb: (d: unknown) => void) {
		_cb({
			addOption() { return this; },
			setValue() { return this; },
			onChange() { return this; },
		});
		return this;
	}
}
