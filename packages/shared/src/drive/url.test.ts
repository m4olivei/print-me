import { describe, expect, it } from 'vitest';
import { parseDriveFileId } from './url.js';

// Shaped like a real Drive file ID (33 chars of [A-Za-z0-9_-]) but not a real file.
const ID = '1AbC-dEf_GhIjKlMnOpQrStUvWxYz0123';

describe('parseDriveFileId: accepted link shapes', () => {
	it.each([
		['file/d view link', `https://drive.google.com/file/d/${ID}/view`],
		[
			'file/d view link with sharing params',
			`https://drive.google.com/file/d/${ID}/view?usp=sharing`
		],
		['file/d link with no trailing segment', `https://drive.google.com/file/d/${ID}`],
		['file/d link with a trailing slash', `https://drive.google.com/file/d/${ID}/`],
		['file/d preview link with a fragment', `https://drive.google.com/file/d/${ID}/preview#page=2`],
		['open?id link', `https://drive.google.com/open?id=${ID}`],
		['open?id link with extra params', `https://drive.google.com/open?id=${ID}&authuser=0`],
		['uc?id link', `https://drive.google.com/uc?id=${ID}`],
		['uc link with id after other params', `https://drive.google.com/uc?export=download&id=${ID}`],
		['surrounding whitespace', `  https://drive.google.com/file/d/${ID}/view \n`]
	])('%s', (_label, url) => {
		expect(parseDriveFileId(url)).toBe(ID);
	});
});

describe('parseDriveFileId: rejections', () => {
	it.each([
		['empty string', ''],
		['not a URL', 'not a url'],
		['bare ID', ID],
		['other host', `https://example.com/file/d/${ID}/view`],
		['lookalike host suffix', `https://drive.google.com.example.com/file/d/${ID}/view`],
		['different google.com subdomain', `https://evil-drive.google.com/open?id=${ID}`],
		['docs.google.com document link', `https://docs.google.com/document/d/${ID}/edit`],
		['plain http', `http://drive.google.com/file/d/${ID}/view`],
		['folder link', `https://drive.google.com/drive/folders/${ID}`],
		['file/d with no ID', 'https://drive.google.com/file/d/'],
		['file/d with ID in the wrong segment', `https://drive.google.com/x/file/d/${ID}/view`],
		['open with no id param', 'https://drive.google.com/open'],
		['open with an empty id', 'https://drive.google.com/open?id='],
		['uc with no id param', 'https://drive.google.com/uc?export=download'],
		['ID too short', 'https://drive.google.com/file/d/abc123/view'],
		['ID with illegal characters', 'https://drive.google.com/open?id=1AbC.dEf%2FGhIjKlMn'],
		['id query param on an unrecognised path', `https://drive.google.com/other?id=${ID}`]
	])('%s', (_label, url) => {
		expect(parseDriveFileId(url)).toBeNull();
	});
});
