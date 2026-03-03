// ─── Pure Helpers ─────────────────────────────────────────────────────────────

export function buildAuthHeader(username: string, password: string): string {
	return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

export function normalizeServerUrl(serverUrl: string): string {
	return serverUrl.replace(/\/$/, '');
}

export function generateUid(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 10);
	return `${timestamp}-${random}@obsidian-nextcloud`;
}

export function toICalDate(date: Date): string {
	return date.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

export function toDatetimeLocalString(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function foldICalLine(value: string): string {
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
