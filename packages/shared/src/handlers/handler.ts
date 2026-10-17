/** What a handler hands to the printer: a file `lp` can print, plus any extra `lp` arguments. */
export interface PreparedDocument {
	/** Path of the file to submit; may be the input path or a converted copy beside it. */
	filePath: string;
	/** Extra `lp` arguments, e.g. `['-o', 'fit-to-page']`. Empty for none. */
	lpOptions: string[];
}

/**
 * Turns a downloaded Drive file of one mimeType into something CUPS can print.
 * Supporting a new document type means writing one of these and adding it to
 * the registry in `./index.ts`; the worker loop does not change.
 */
export interface DocumentHandler {
	/** The Drive mimeType this handler accepts, e.g. `application/pdf`. */
	readonly mimeType: string;
	/** Prepares the downloaded file at `filePath` for printing. */
	prepare(filePath: string): Promise<PreparedDocument>;
}
