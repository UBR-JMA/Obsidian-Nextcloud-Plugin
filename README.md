# Obsidian Nextcloud Plugin

Create and manage calendar events, tasks, and notes in Nextcloud directly from Obsidian.

## Features

- Create calendar events with title, start/end time, description, recurrence, and calendar selection
- Create tasks (todos) with title, optional due date, and notes
- Create notes via the Nextcloud Notes app
- **List upcoming events** — view events from all your calendars for the next 7 days
- **List open tasks** — view all incomplete tasks across your task lists, with one-click completion
- **Quick-capture from selection** — selected text in the active note pre-fills event/task titles and note content
- **Recurring events** — set daily, weekly, or monthly recurrence when creating an event
- Persistent default calendar selection remembered across sessions
- Works with any Nextcloud instance using CalDAV and the Notes app

## Requirements

- A running Nextcloud instance (v25+)
- The Nextcloud Calendar app (for events and tasks)
- The Nextcloud Notes app (for notes — optional)
- Node.js v16+ and npm (for building from source)

## Building from Source

```bash
# Clone the repository
git clone https://github.com/UBR-JMA/Obsidian-Nextcloud-Plugin.git
cd Obsidian-Nextcloud-Plugin

# Install dependencies
npm install

# Build (type-check + bundle)
npm run build
```

This produces `main.js` in the project root.

For development with live rebuilding:

```bash
npm run dev
```

## Installation

### Manual installation

1. Build the plugin (see above), or download a release.
2. In your Obsidian vault, create the folder `.obsidian/plugins/obsidian-nextcloud-plugin/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. In Obsidian, go to **Settings → Community plugins**, disable Safe mode if prompted, and enable **Nextcloud**.

### BRAT (Beta Reviewers Auto-update Tool)

If you use the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat), you can add this repo directly for automatic updates.

## Configuration

1. Open **Settings → Nextcloud**.
2. Enter your **Server URL** (e.g. `https://nextcloud.example.com`).
3. Enter your **Username**.
4. Enter your **Password** — using a [Nextcloud app password](https://docs.nextcloud.com/server/latest/user_manual/en/session_token.html) is strongly recommended over your account password.
5. Click **Refresh calendars** to fetch your available calendars.
6. Select a **Default calendar** from the dropdown — this is pre-selected whenever you create an event or task.

> **Note:** Credentials are stored unencrypted in your vault's plugin data. Use an app password to limit exposure.

## Usage

All actions are available via the **Command palette** (`Ctrl/Cmd+P`):

| Command | Description |
|---|---|
| Create Nextcloud event | Opens a form to create a calendar event |
| Create Nextcloud task | Opens a form to create a task/todo |
| Create Nextcloud note | Opens a form to create a note |
| List upcoming Nextcloud events | Shows events from all calendars for the next 7 days |
| List open Nextcloud tasks | Shows incomplete tasks across all task lists |
| Test Nextcloud connection | Verifies your credentials and server URL |

The **cloud icon** in the left ribbon also opens the Create Event form directly.

### Creating an event

1. Run **Create Nextcloud event** from the command palette (or click the ribbon icon).
2. Fill in the title, start time, and end time.
3. Optionally set a **Recurrence** (None / Daily / Weekly / Monthly).
4. Optionally add a description.
5. Select the target calendar from the dropdown.
6. Click **Create Event**.

**Tip:** Select text in the active note before opening the modal — it will be pre-filled as the event title.

### Creating a task

1. Run **Create Nextcloud task**.
2. Fill in the title and optionally a due date and notes.
3. Select the task list from the dropdown.
4. Click **Create Task**.

**Tip:** Selected text in the active note is pre-filled as the task title.

### Creating a note

1. Run **Create Nextcloud note**.
2. The title is pre-filled with the active file name if one is open.
3. Add content and click **Create Note**.

**Tip:** Selected text in the active note is pre-filled as the note content.

### Listing upcoming events

1. Run **List upcoming Nextcloud events**.
2. The plugin fetches events from all your calendars for the next 7 days.
3. Events are displayed sorted by start time, showing the calendar name, title, and time range.

### Listing and completing tasks

1. Run **List open Nextcloud tasks**.
2. The plugin fetches all incomplete tasks across your task lists.
3. Tasks are displayed sorted by due date. Click **Complete** on any row to mark it done — the task is updated on the server immediately.

## Roadmap

### Obsidian Integration

- **Insert link after creation** — After creating an event, task, or note, offer to insert a summary line or link at the cursor position in the active note.
- **Frontmatter pre-fill** — Parse YAML frontmatter from the active file to pre-fill fields (e.g. `title:` → event title, `date:` → start date).
- **Daily Notes integration** — When the daily note is open, parse its unchecked tasks (`- [ ]`) and offer a bulk-push to Nextcloud.
- **Two-way sync** — Fetch events and tasks from CalDAV and display them in a sidebar panel. The most complex item, but the most powerful.

### Polish

- **Calendar color indicators** — Calendar metadata already includes a `color` field; surface it as colored dots in the calendar dropdowns.
- **Inline credential validation** — Validate credentials when the password field loses focus, rather than requiring a manual "Test connection" click.
- **Offline queue** — If a CalDAV request fails due to connectivity, queue it locally and retry automatically when a connection is next available.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
