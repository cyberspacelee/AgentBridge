import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AppEvent,
  Artifact,
  Interaction,
  Message,
  MessagePart,
  Run,
  Session,
  Snapshot,
  Submission,
} from "../../shared/contracts.js";
import { migrations } from "./migrations.js";

type Entities = {
  sessions: Session;
  runs: Run;
  interactions: Interaction;
  artifacts: Artifact;
  submissions: Submission;
};
type Table = keyof Entities;
const jsonColumns: Record<Table, string[]> = {
  sessions: ["interactionPolicy"],
  runs: ["inputParts", "model", "error", "usage"],
  interactions: ["questions", "reply"],
  artifacts: [],
  submissions: ["result", "error"],
};
export type EventInput = Pick<
  AppEvent,
  "type" | "data" | "sessionId" | "runId"
>;

export class Store {
  readonly db: DatabaseSync;
  readonly instanceId = randomUUID();
  readonly storeId: string;
  private active = false;
  private pending: AppEvent[] = [];
  private committedActions: (() => void)[] = [];
  private listeners = new Set<(events: AppEvent[]) => void>();
  healthy = true;

  constructor(
    readonly filename: string,
    private eventByteLimit = 128 * 1024 * 1024,
  ) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename, { timeout: 100 });
    try {
      this.db.exec(
        "PRAGMA foreign_keys=ON; PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE; COMMIT;",
      );
      const version = Number(
        this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0,
      );
      if (version > migrations.length)
        throw new Error("Database schema is newer than this gateway");
      migrations.slice(version).forEach((sql, i) => {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.exec(sql);
          this.db.exec(`PRAGMA user_version=${version + i + 1}; COMMIT;`);
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      });
      this.storeId = this.meta("storeId") ?? randomUUID();
      this.setMeta("storeId", this.storeId);
      if (!this.meta("revision")) this.setMeta("revision", "0");
      if (!this.meta("floor")) this.setMeta("floor", "0");
      if (!this.meta("eventBytes"))
        this.setMeta(
          "eventBytes",
          String(
            this.db
              .prepare(
                "SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS n FROM events",
              )
              .get()?.n ?? 0,
          ),
        );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  meta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? String(row.value) : null;
  }
  setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }

  transaction<T>(action: () => T): T {
    if (this.active) return action();
    this.db.exec("BEGIN IMMEDIATE");
    this.active = true;
    this.pending = [];
    this.committedActions = [];
    let result: T;
    try {
      this.setMeta("revision", String(Number(this.meta("revision")) + 1));
      result = action();
      if (result && typeof result === "object" && "then" in result)
        throw new Error("Store transactions must be synchronous");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.pending = [];
      this.committedActions = [];
      throw error;
    } finally {
      this.active = false;
    }
    const committed = this.pending;
    this.pending = [];
    const actions = this.committedActions;
    this.committedActions = [];
    for (const listener of this.listeners) {
      try {
        listener(committed);
      } catch {
        process.stderr.write("Event subscriber failed after commit\n");
      }
    }
    for (const action of actions) action();
    return result;
  }

  afterCommit(action: () => void) {
    if (this.active) this.committedActions.push(action);
    else action();
  }

  private assertTransaction() {
    if (!this.active) throw new Error("Business writes require a transaction");
  }
  put<K extends Table>(table: K, value: Entities[K]) {
    this.assertTransaction();
    const entries = Object.entries(value);
    const columns = entries.map(([key]) => key);
    const conflict = table === "submissions" ? "id,operation,target" : "id";
    const values = entries.map(([key, val]) =>
      jsonColumns[table].includes(key) && val !== null
        ? JSON.stringify(val)
        : val,
    ) as SQLInputValue[];
    this.db
      .prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT(${conflict}) DO UPDATE SET ${columns.map((c) => `${c}=excluded.${c}`).join(",")}`,
      )
      .run(...values);
  }

  list<K extends Table>(
    table: K,
    where = "1=1",
    parameters: SQLInputValue[] = [],
  ): Entities[K][] {
    return this.db
      .prepare(`SELECT * FROM ${table} WHERE ${where}`)
      .all(...parameters)
      .map((row) => {
        for (const key of jsonColumns[table])
          if (row[key] !== null) row[key] = JSON.parse(String(row[key]));
        return row as unknown as Entities[K];
      });
  }
  get<K extends Exclude<Table, "submissions">>(
    table: K,
    id: string,
  ): Entities[K] | undefined {
    return this.list(table, "id=?", [id])[0];
  }
  submission(
    id: string,
    operation: string,
    target: string,
  ): Submission | undefined {
    return this.list("submissions", "id=? AND operation=? AND target=?", [
      id,
      operation,
      target,
    ])[0];
  }

  saveMessage(message: Message) {
    this.assertTransaction();
    const existing = this.db
      .prepare("SELECT sessionId,runId,role FROM messages WHERE id=?")
      .get(message.id);
    if (
      existing &&
      (existing.sessionId !== message.sessionId ||
        existing.runId !== message.runId ||
        existing.role !== message.role)
    )
      throw new Error("Message ownership cannot change");
    if (new Set(message.parts.map((p) => p.id)).size !== message.parts.length)
      throw new Error("Duplicate message part ID");
    for (const part of message.parts) {
      const owner = this.db
        .prepare("SELECT messageId FROM message_parts WHERE id=?")
        .get(part.id);
      if (owner && owner.messageId !== message.id)
        throw new Error("Message part ownership cannot change");
    }
    this.db
      .prepare(
        "INSERT INTO messages(id,sessionId,runId,role,createdAt,completedAt,finishReason) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET completedAt=excluded.completedAt,finishReason=excluded.finishReason",
      )
      .run(
        message.id,
        message.sessionId,
        message.runId,
        message.role,
        message.createdAt,
        message.completedAt,
        message.finishReason,
      );
    this.db
      .prepare("DELETE FROM message_parts WHERE messageId=?")
      .run(message.id);
    const write = this.db.prepare(
      "INSERT INTO message_parts(id,messageId,position,type,content) VALUES (?,?,?,?,?)",
    );
    message.parts.forEach((part, index) =>
      write.run(part.id, message.id, index, part.type, JSON.stringify(part)),
    );
  }
  messages(sessionId: string, runId?: string): Message[] {
    const params = runId ? [sessionId, runId] : [sessionId];
    return this.db
      .prepare(
        `SELECT * FROM messages WHERE sessionId=? ${runId ? "AND runId=?" : ""} ORDER BY rowid`,
      )
      .all(...params)
      .map((row) => ({
        ...row,
        parts: this.db
          .prepare(
            "SELECT content FROM message_parts WHERE messageId=? ORDER BY position",
          )
          .all(String(row.id))
          .map((p) => JSON.parse(String(p.content)) as MessagePart),
      })) as unknown as Message[];
  }
  emit(input: EventInput) {
    this.assertTransaction();
    const at = new Date().toISOString();
    const revision = Number(this.meta("revision"));
    const data = JSON.stringify(input.data);
    const result = this.db
      .prepare(
        "INSERT INTO events(revision,instanceId,occurredAt,type,sessionId,runId,data) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        revision,
        this.instanceId,
        at,
        input.type,
        input.sessionId ?? null,
        input.runId ?? null,
        data,
      );
    const bytes = Number(this.meta("eventBytes")) + Buffer.byteLength(data);
    this.setMeta("eventBytes", String(bytes));
    if (bytes > this.eventByteLimit) {
      let remaining = bytes,
        floor = 0;
      for (const row of this.db
        .prepare(
          "SELECT seq,length(CAST(data AS BLOB)) AS bytes FROM events ORDER BY seq",
        )
        .iterate()) {
        remaining -= Number(row.bytes);
        floor = Number(row.seq);
        if (remaining <= this.eventByteLimit * 0.75) break;
      }
      this.trimThrough(floor);
    }
    this.pending.push({
      schemaVersion: 1,
      eventId: `${this.storeId}:${result.lastInsertRowid}`,
      revision,
      instanceId: this.instanceId,
      occurredAt: at,
      ...structuredClone(input),
    });
  }
  subscribe(listener: (events: AppEvent[]) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  snapshot(): Snapshot {
    const seq = Number(
      this.db
        .prepare("SELECT seq FROM sqlite_sequence WHERE name='events'")
        .get()?.seq ?? 0,
    );
    return {
      storeId: this.storeId,
      instanceId: this.instanceId,
      revision: Number(this.meta("revision")),
      cursor: `${this.storeId}:${seq}`,
      capturedAt: new Date().toISOString(),
    };
  }
  replay(cursor: string, sessionId?: string): AppEvent[] | null {
    const [storeId, raw] = cursor.split(":");
    const seq = Number(raw);
    const latest = Number(this.snapshot().cursor.split(":")[1]);
    if (
      storeId !== this.storeId ||
      !raw ||
      !Number.isSafeInteger(seq) ||
      seq < Number(this.meta("floor")) ||
      seq > latest
    )
      return null;
    return this.db
      .prepare(
        `SELECT * FROM events WHERE seq>? ${sessionId ? "AND sessionId=?" : ""} ORDER BY seq LIMIT 100001`,
      )
      .all(...(sessionId ? [seq, sessionId] : [seq]))
      .map((row) => ({
        schemaVersion: 1,
        eventId: `${this.storeId}:${row.seq}`,
        revision: Number(row.revision),
        instanceId: String(row.instanceId),
        occurredAt: String(row.occurredAt),
        type: String(row.type),
        ...(row.sessionId ? { sessionId: String(row.sessionId) } : {}),
        ...(row.runId ? { runId: String(row.runId) } : {}),
        data: JSON.parse(String(row.data)),
      }));
  }
  pruneEvents(max: number, before: string) {
    this.transaction(() => {
      const byCount = Number(
        this.db
          .prepare("SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?")
          .get(max)?.seq ?? 0,
      );
      const byAge = Number(
        this.db
          .prepare("SELECT MAX(seq) AS seq FROM events WHERE occurredAt<?")
          .get(before)?.seq ?? 0,
      );
      const floor = Math.max(byCount, byAge, Number(this.meta("floor")));
      this.trimThrough(floor);
    });
  }
  private trimThrough(floor: number) {
    const removed = Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS n FROM events WHERE seq<=?",
        )
        .get(floor)?.n ?? 0,
    );
    this.db.prepare("DELETE FROM events WHERE seq<=?").run(floor);
    this.setMeta(
      "eventBytes",
      String(Math.max(0, Number(this.meta("eventBytes")) - removed)),
    );
    this.setMeta("floor", String(Math.max(floor, Number(this.meta("floor")))));
  }
  deleteSession(sessionId: string) {
    this.assertTransaction();
    const floor = Number(
      this.db
        .prepare("SELECT MAX(seq) AS seq FROM events WHERE sessionId=?")
        .get(sessionId)?.seq ?? 0,
    );
    this.trimThrough(floor);
    this.db
      .prepare(
        "UPDATE submissions SET status='gone',result=NULL,error=NULL WHERE target=? OR json_extract(result,'$.sessionId')=?",
      )
      .run(sessionId, sessionId);
    this.db
      .prepare("DELETE FROM runtime_logs WHERE sessionId=?")
      .run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
    this.emit({ type: "session.deleted", sessionId, data: { sessionId } });
  }
  close() {
    this.listeners.clear();
    this.db.close();
  }
}
