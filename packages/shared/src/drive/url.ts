/**
 * Google Drive link parsing.
 *
 * Pure function shared by the web app (to reject bad links with a 400 before
 * queueing) and anything else that needs the file ID behind a Drive link.
 */

const DRIVE_HOST = 'drive.google.com';

/** Drive file IDs are URL-safe base64-ish strings; real ones are ~33 characters. */
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

/** `/file/d/<id>` optionally followed by `/view`, `/preview`, `/edit`, etc. */
const FILE_PATH_PATTERN = /^\/file\/d\/([^/]+)(?:\/.*)?$/;

/** Paths whose file ID is carried in the `id` query parameter. */
const ID_QUERY_PATHS = new Set(['/open', '/uc']);

/**
 * Extracts the file ID from a Google Drive link, or returns `null` if the
 * input is not a recognised Drive file link.
 *
 * Accepted shapes (extra query params and fragments are ignored):
 * - `https://drive.google.com/file/d/<id>[/view|/preview|…]`
 * - `https://drive.google.com/open?id=<id>`
 * - `https://drive.google.com/uc?id=<id>`
 *
 * Anything else — other hosts, non-HTTPS, folder links, missing or malformed
 * IDs, unparseable input — yields `null`.
 */
export function parseDriveFileId(url: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		return null;
	}

	if (parsed.protocol !== 'https:' || parsed.hostname !== DRIVE_HOST) {
		return null;
	}

	let candidate: string | null = null;
	const fileMatch = FILE_PATH_PATTERN.exec(parsed.pathname);
	if (fileMatch) {
		candidate = fileMatch[1] ?? null;
	} else if (ID_QUERY_PATHS.has(parsed.pathname)) {
		candidate = parsed.searchParams.get('id');
	}

	return candidate !== null && FILE_ID_PATTERN.test(candidate) ? candidate : null;
}
