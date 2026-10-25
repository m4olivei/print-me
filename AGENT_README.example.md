<!--
  Template for the prompt handed to the print agent. Copy it to AGENT_README.md (git-ignored),
  replace https://print.example.com with your hostname (tofu output app_url) and <folder-id> with
  the ID of the Drive folder shared with the service account, then hand the copy to the agent.
  Leave {{CF_ID}} and {{CF_SECRET}} as they are: the real values go in the agent's vault, never in
  this file. Delete this comment in the copy.
-->

# Print Me: print PDFs on my home printer

You can print PDFs on my home printer, a Brother MFC-L3720CDW color laser. Color is available when a document needs it, and black-and-white pages print as usual. You do this by uploading the PDF to a Google Drive folder and then sending its link to my print server.

## 1. First: store the credentials in the vault

The print server is protected by a Cloudflare Access service token, which is two secret values. Before doing anything else, show me secure vault links where I can store each one:

- `CF_ID`: the Access client ID, sent in the `CF-Access-Client-Id` header
- `CF_SECRET`: the Access client secret, sent in the `CF-Access-Client-Secret` header

Current values, to be replaced by the vault:

- CF_ID = `{{CF_ID}}`
- CF_SECRET = `{{CF_SECRET}}`

Rules for these values:

- Read them from the vault whenever you call the server.
- Never print them, echo them back, log them, or put them in a URL, a file name or a Drive file.
- If a request returns **401**, the token is missing, wrong or expired. Tell me so I can rotate it. Don't retry with guessed values.

## 2. Upload the PDF to the "Print Me Inbox" folder

- Folder: **Print Me Inbox**, https://drive.google.com/drive/folders/<folder-id>
- Folder ID: `<folder-id>`

How to upload:

1. Upload the file **directly into that folder**. With the Drive API, call `files.create` with `parents: ["<folder-id>"]` and `mimeType: "application/pdf"`.
2. Give it a descriptive file name ending in `.pdf`.
3. Upload a real PDF. The printer only accepts `application/pdf`; Google Docs, images and Word files fail. To print something else, convert it to PDF first.
4. Keep it under **50 MB**. Larger files are rejected without retries.
5. Don't change the file's sharing settings. The print server can read the file only because it sits in this folder, which is already shared with the server's service account. A file anywhere else fails as "not found", even if it's shared with anyone who has the link.

## 3. Build the Drive link

Take the file ID returned by the upload and build:

```
https://drive.google.com/file/d/<FILE_ID>/view
```

The server also accepts `https://drive.google.com/open?id=<FILE_ID>` and `https://drive.google.com/uc?id=<FILE_ID>`. Folder links and `docs.google.com` links are rejected.

## 4. Send the print request and track it

Base URL: `https://print.example.com`

Every request needs these headers:

```
CF-Access-Client-Id: <CF_ID from vault>
CF-Access-Client-Secret: <CF_SECRET from vault>
User-Agent: print-me-agent/1.0
```

Always set `User-Agent` yourself. Don't rely on your HTTP library's default: Cloudflare has blocked the default `Python-urllib/3.x` agent with a `403` and the body `error code: 1010`. In Python's `urllib`, call `req.add_header("User-Agent", "print-me-agent/1.0")`.

### `POST /print`: queue a print

Request: `Content-Type: application/json`, body `{ "url": "<Drive file link>" }`

| Status                                                             | Meaning                                                                                                 | What to do                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `202 { "id": 42 }`                                                 | New job queued.                                                                                         | Save the `id` and poll it.                                         |
| `200 { "id": 42 }`                                                 | This Drive file is already queued or printing. You get the existing job, and no second copy is printed. | Poll that `id`. Safe to resend if your first request timed out.    |
| `400`                                                              | Missing body, or not a recognised Drive file link.                                                      | Fix the link, then retry.                                          |
| `429 { "error", "retryAfterSeconds" }` plus a `Retry-After` header | The hourly print limit has been reached.                                                                | Wait `retryAfterSeconds`, then retry once. Tell me if it's urgent. |

To print the same file again on purpose, wait until its previous job is `printed` or `failed`, then POST again. To print several copies, upload separate files.

### `GET /print/{id}`: job status

Returns `200 { id, state, attempts, lastError, cupsJobId, createdAt, updatedAt }`, or `404` for an unknown id.

`state` is one of:

- **`queued`**: waiting, or waiting to retry after a failure. If `attempts` > 0, `lastError` says what went wrong.
- **`processing`**: being downloaded and sent to the printer.
- **`printed`**: the printer's queue accepted it, and `cupsJobId` is set. This is the success state. It doesn't confirm paper came out, for example if the printer is out of paper.
- **`failed`**: gave up. Report `lastError` to me.

Polling:

1. Poll every 10–15 seconds for the first 2 minutes. A healthy job is normally `printed` within about 10–20 seconds.
2. If it's still `queued` with `attempts` > 0, the server is retrying. It tries up to 5 times over about 15 minutes, at 0, 1, 3, 7 and 15 minutes. Poll about once a minute after the first 2 minutes.
3. These fail immediately, without retries: a non-PDF file, a file over 50 MB.
4. The most common cause of `failed` with a "not found" error is a file uploaded outside the Print Me Inbox folder.

### `GET /healthz`: check the server is up

Returns `200 { "ok": true }`. Use it when something looks wrong:

| Response                 | Meaning                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `200`                    | The server is up.                                                            |
| `401`                    | Credential problem.                                                          |
| `403` `error code: 1010` | Cloudflare blocked your client. Check you're sending the `User-Agent` above. |
| `502`                    | Tunnel is up, but the print app is down.                                     |
| Cloudflare error `1033`  | Tunnel is down.                                                              |

For anything other than 200, tell me which one you got.

## 5. Example

```bash
curl -s -X POST https://print.example.com/print \
  -A 'print-me-agent/1.0' \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://drive.google.com/file/d/<FILE_ID>/view"}'
# → 202 {"id":42}

curl -s https://print.example.com/print/42 \
  -A 'print-me-agent/1.0' \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET"
# → {"id":42,"state":"printed","attempts":1,"lastError":null,"cupsJobId":"mfcl3720cdw-7",...}
```

When a print finishes, tell me:

- the file name;
- its Drive link;
- the job id;
- the final state: `printed`, or `failed` with the error.
