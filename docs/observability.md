# Observability

Yoto Sync uses structured logs and typed telemetry events to understand
application behavior in development and production.

## Logger and Telemetry

The logger and telemetry modules serve different purposes.

### Logger

[app/lib/logger.server.ts](../app/lib/logger.server.ts) is the only
application-owned code that calls `console.debug`, `console.info`,
`console.warn`, or `console.error`.

Use the logger for diagnostic details that help explain how an operation ran:

- Sandbox lifecycle
- Cache hits and misses
- Upload milestones
- Transcode polling
- Recoverable upstream errors

Diagnostic messages use stable, machine-readable names:

```ts
logger.info({
    message: "yoto.audio.upload.completed",
    cardId,
    trackId,
})
```

Cloudflare and Sandbox SDK logs are emitted by dependencies and do not pass
through the application logger.

### Telemetry

[app/lib/telemetry.server.ts](../app/lib/telemetry.server.ts) defines typed
product events. Use telemetry for meaningful user actions and their outcomes:

- Authentication
- Imports
- Card creation and deletion
- Track copy, deletion, icon assignment, reorder, and numbering

```ts
telemetry.info(EVENT.IMPORT.COMPLETED, {
    importId,
    cardId,
    youtubeUrl,
    sourceType,
    splitByChapters,
    durationMs,
    sourceTrackCount,
    sourceDurationSeconds,
    added,
    skipped,
    chapterSplitUnavailable,
})
```

Telemetry currently writes structured records through the logger. Both
diagnostic logs and telemetry events are stored in Cloudflare Workers Logs.
Analytics Engine is not connected yet.

The [`EVENT` object](../app/lib/telemetry.server.ts) is the canonical event
catalog. Do not maintain a duplicate event list in documentation.

## Levels

Use levels consistently:

| Level   | Use                                                                   |
| ------- | --------------------------------------------------------------------- |
| `debug` | Repetitive internal details such as cache lookups and polling         |
| `info`  | Successful milestones and completed user operations                   |
| `warn`  | Recoverable problems, rejected input, or expected upstream conditions |
| `error` | Operations that cannot complete or unexpected application failures    |

Fast user mutations generally emit only completed or failed telemetry events.
Long-running imports emit started, completed, and failed events.

## Naming

Use lowercase dot-separated names:

```text
<domain>.<operation>.<state>
```

Examples:

```text
auth.login.failed
card.create.completed
track.copy.completed
import.failed
```

Diagnostic logger messages follow the same style but may include additional
implementation detail:

```text
yoto.audio.transcode.polled
import.sandbox.destroy_failed
```

## Payloads

Every telemetry event must have an entry in
[`TelemetryPayloads`](../app/lib/telemetry.server.ts). This keeps event payloads
consistent and catches missing or invalid fields at compile time.

Prefer operational context:

- Card, import, and track identifiers
- Canonical public YouTube URLs for imports
- Source type and chapter-splitting mode
- Counts, sizes, durations, stages, and failure reasons

Never log:

- Authentication tokens or refresh tokens
- Cookies or encrypted credentials
- Signed upload URLs
- Request authorization headers
- Raw audio or image contents
- Feedback messages or email addresses

Avoid user-entered card titles unless they are required to diagnose a specific
problem. Diagnostic audio logs may include source track titles supplied by
YouTube.

## Adding Telemetry

To add a product event:

1. Add its name to `EVENT`.
2. Add its payload to `TelemetryPayloads`.
3. Emit it only after the operation has reached the stated outcome.
4. Add a focused test that verifies the event name, level, and important
   payload fields.

To add a diagnostic log:

1. Choose a stable machine-readable `message`.
2. Select the appropriate log level.
3. Include only the context needed to investigate the operation.
4. Use `logger` instead of calling `console` directly.

## Viewing Logs

During local development, records appear in the terminal running
`npm run dev`.

In production:

1. Open the Cloudflare dashboard.
2. Select **Workers & Pages**.
3. Select the `yoto` Worker.
4. Open **Observability**.
5. Filter or group records by `event`, `message`, `level`, `reason`, `cardId`,
   or `importId`.

Cloudflare automatic tracing is enabled at 100% sampling during its initial
evaluation. Traces include Worker handlers, fetch calls, and binding calls
without custom application instrumentation.

## Future Integrations

Planned observability work:

- Evaluate trace coverage and choose a permanent sampling rate.
- Evaluate Analytics Engine for aggregate product metrics.
- Evaluate an OpenTelemetry destination when external dashboards or alerts are
  needed.

The logger should remain the structured logging boundary. Telemetry may later
write to both the logger and Analytics Engine without changing its call sites.
