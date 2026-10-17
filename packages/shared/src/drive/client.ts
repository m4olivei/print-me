/**
 * Google Drive client for the worker.
 *
 * Authenticates as a service account from a JSON key file with the read-only
 * Drive scope, so it can only see files explicitly shared with that account.
 * Every call sets `supportsAllDrives` so files in shared drives work too.
 *
 * A thin wrapper over Google's official client: no retries here, errors
 * surface to the caller (the worker's retry policy handles them).
 */
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { drive as createDriveApi } from '@googleapis/drive';
import { GoogleAuth } from 'google-auth-library';

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export interface DriveFileMetadata {
	name: string;
	mimeType: string;
	/** Size in bytes, or `null` when Drive reports none (e.g. native Google Docs files). */
	size: number | null;
}

export interface DriveClient {
	/** Fetches the file's name, mimeType and size without downloading it. */
	getMetadata(fileId: string): Promise<DriveFileMetadata>;
	/** Streams the file's content to `destPath`, creating or truncating it (mode 0600). */
	downloadToFile(fileId: string, destPath: string): Promise<void>;
}

/**
 * Creates a Drive client authenticated as the service account whose JSON key
 * is at `keyFile`. The key is read lazily, so a bad path surfaces as an error
 * from the first call rather than from this function.
 */
export function createDriveClient(keyFile: string): DriveClient {
	const auth = new GoogleAuth({ keyFile, scopes: [DRIVE_READONLY_SCOPE] });
	const api = createDriveApi({ version: 'v3', auth });

	return {
		async getMetadata(fileId) {
			const { data } = await api.files.get({
				fileId,
				fields: 'name,mimeType,size',
				supportsAllDrives: true
			});
			if (!data.name || !data.mimeType) {
				throw new Error(`Drive returned incomplete metadata for file ${fileId}`);
			}
			return {
				name: data.name,
				mimeType: data.mimeType,
				size: data.size == null ? null : Number(data.size)
			};
		},

		async downloadToFile(fileId, destPath) {
			const response = await api.files.get(
				{ fileId, alt: 'media', supportsAllDrives: true },
				{ responseType: 'stream' }
			);
			await pipeline(response.data, createWriteStream(destPath, { mode: 0o600 }));
		}
	};
}
