export const migrations = [
  String.raw`
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL, engineId TEXT NOT NULL,
 interactionPolicy TEXT NOT NULL CHECK(json_valid(interactionPolicy)), availability TEXT NOT NULL CHECK(availability IN ('ready','unavailable','deleting')),
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL
) STRICT;
CREATE TABLE runs (
 id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, submissionId TEXT NOT NULL,
 sequence INTEGER NOT NULL, inputParts TEXT NOT NULL CHECK(json_valid(inputParts)), model TEXT,
 state TEXT NOT NULL CHECK(state IN ('queued','running','stopping','completed','failed','timed_out','cancelled')),
 acceptedAt TEXT NOT NULL, deadlineAt TEXT NOT NULL, startedAt TEXT, finishedAt TEXT, stopReason TEXT,
 error TEXT, usage TEXT, traceId TEXT NOT NULL, configRevision TEXT, UNIQUE(sessionId,sequence)
) STRICT;
CREATE UNIQUE INDEX one_active_run ON runs(sessionId) WHERE state IN ('running','stopping');
CREATE INDEX run_queue ON runs(state,acceptedAt);
CREATE TABLE messages (
 id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
 createdAt TEXT NOT NULL, completedAt TEXT, finishReason TEXT
) STRICT;
CREATE INDEX message_order ON messages(sessionId,createdAt,id);
CREATE TABLE message_parts (
 id TEXT PRIMARY KEY, messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('text','tool','step-finish')), content TEXT NOT NULL CHECK(json_valid(content))
) STRICT;
CREATE VIEW tool_calls AS SELECT id, messageId, content FROM message_parts WHERE type='tool';
CREATE TABLE interactions (
 id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('permission','question')),
 title TEXT NOT NULL, questions TEXT NOT NULL CHECK(json_valid(questions)), state TEXT NOT NULL CHECK(state IN ('pending','replying','resolved','expired')),
 policy TEXT NOT NULL, createdAt TEXT NOT NULL, resolvedAt TEXT, reply TEXT, error TEXT
) STRICT;
CREATE TABLE artifacts (
 id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, relativePath TEXT NOT NULL, displayName TEXT NOT NULL,
 mediaType TEXT NOT NULL, sizeBytes INTEGER NOT NULL, modifiedAt TEXT NOT NULL, digest TEXT NOT NULL,
 registeredAt TEXT NOT NULL, availability TEXT NOT NULL, validation TEXT NOT NULL
) STRICT;
CREATE TABLE submissions (
 id TEXT NOT NULL, operation TEXT NOT NULL, target TEXT NOT NULL, digest TEXT NOT NULL,
 status TEXT NOT NULL, result TEXT, error TEXT, createdAt TEXT NOT NULL, PRIMARY KEY(id,operation,target)
) STRICT;
CREATE TABLE engine_bindings (
 sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 engineId TEXT NOT NULL, nativeSessionId TEXT NOT NULL, directory TEXT NOT NULL, instanceId TEXT NOT NULL, processGeneration INTEGER NOT NULL
) STRICT;
CREATE TABLE events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, revision INTEGER NOT NULL, instanceId TEXT NOT NULL,
 occurredAt TEXT NOT NULL, type TEXT NOT NULL, sessionId TEXT, runId TEXT, data TEXT NOT NULL CHECK(json_valid(data))
) STRICT;
CREATE INDEX events_session ON events(sessionId,seq);
CREATE TABLE runtime_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, occurredAt TEXT NOT NULL, level TEXT NOT NULL,
 stage TEXT NOT NULL, code TEXT, message TEXT NOT NULL, sessionId TEXT, runId TEXT, traceId TEXT
) STRICT;
`,
  "ALTER TABLE runs ADD COLUMN runtimeVersion TEXT;",
];
