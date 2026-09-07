import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { readConfig } from "../src/config.js";
import {
  SettingsManager,
  opencodeEnvironment,
  piMcpConfiguration,
  readSettings,
  syncPiMcp,
} from "../src/settings.js";
import { PiAdapter } from "../src/engines/pi/adapter.js";

test("Pi MCP sync preserves native entries and handles edits, removal, conflicts and directory changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-mcp-"));
  try {
    const config = readConfig([], { AGENT_DATA_DIR: directory });
    const manager = new SettingsManager(config);
    const file = path.join(directory, "pi/mcp.json");
    const native = {
      settings: { toolPrefix: "server" },
      mcpServers: { personal: { command: "personal-server" } },
    };
    await mkdir(path.dirname(file));
    const nativeJsonc = "// Personal configuration\n" + JSON.stringify(native);
    await writeFile(file, nativeJsonc);
    let view = manager.view();
    const save = (changes: Record<string, unknown>) =>
      (view = manager.save({
        revision: view.revision,
        settings: { ...view.settings, ...changes },
      }));
    save({
      mcp: [{ id: "legacy", config: { type: "local", command: ["node"] } }],
    });
    assert.equal(view.settings.mcp[0]!.engine, "opencode");
    syncPiMcp(config);
    assert.equal(await readFile(file, "utf8"), nativeJsonc);
    await writeFile(file, JSON.stringify(native));
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), native);
    save({ mcp: [] });
    const token = "!literal ${TOKEN} $env:TOKEN {env:TOKEN}";
    save({
      mcp: [
        {
          id: "office",
          engine: "pi",
          config: {
            type: "local",
            command: ["node", "office.mjs", token],
            environment: { TOKEN: token },
          },
        },
        {
          id: "remote",
          engine: "pi",
          config: {
            type: "remote",
            url: "https://example.test/mcp",
            headers: { Authorization: token },
          },
        },
      ],
    });
    assert.equal(view.restartRequired, false);
    assert.equal(view.piMcp.configFile, file);
    assert.equal(view.piMcp.serverCount, 2);
    assert.equal(view.piMcp.adapterDetected, false);
    assert.deepEqual(
      JSON.parse(opencodeEnvironment(config).OPENCODE_CONFIG_CONTENT).mcp,
      {},
    );
    const content = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(content.settings, native.settings);
    assert.deepEqual(content.mcpServers.personal, native.mcpServers.personal);
    assert.equal(content.mcpServers.office.command, "node");
    assert.equal(content.mcpServers.office.disabled, false);
    assert.ok(!JSON.stringify(content).includes(token));
    const converted = piMcpConfiguration(readSettings(config));
    const expand = (value: string) => converted.environment[value.slice(5, -1)];
    assert.equal(expand(content.mcpServers.office.args[1]), token);
    assert.equal(expand(content.mcpServers.office.env.TOKEN), token);
    assert.equal(
      expand(content.mcpServers.remote.headers.Authorization),
      token,
    );
    assert.equal(
      expand(content.mcpServers.remote.url),
      "https://example.test/mcp",
    );
    save({
      mcp: view.settings.mcp.map((m) => ({
        ...m,
        engine: "both",
        enabled: false,
      })),
    });
    assert.equal(
      JSON.parse(await readFile(file, "utf8")).mcpServers.office.disabled,
      true,
    );
    assert.equal(
      JSON.parse(opencodeEnvironment(config).OPENCODE_CONFIG_CONTENT).mcp.office
        .enabled,
      false,
    );
    assert.equal(view.restartRequired, true);
    const other = path.join(directory, "other-pi");
    await mkdir(other);
    await writeFile(
      path.join(other, "mcp.json"),
      JSON.stringify({ mcpServers: { office: { command: "owned-by-user" } } }),
    );
    const before = await readFile(file, "utf8");
    const revision = view.revision;
    assert.throws(() => save({ piConfigDirectory: other }), /already exists/);
    assert.equal(manager.view().revision, revision);
    assert.equal(await readFile(file, "utf8"), before);
    await writeFile(path.join(other, "mcp.json"), "invalid JSON");
    assert.throws(
      () => save({ piConfigDirectory: other }),
      /Cannot read configuration/,
    );
    assert.equal(await readFile(file, "utf8"), before);
    await rm(path.join(other, "mcp.json"));
    save({ piConfigDirectory: other });
    assert.deepEqual(
      JSON.parse(await readFile(file, "utf8")).mcpServers,
      native.mcpServers,
    );
    const nextFile = path.join(other, "mcp.json");
    assert.equal(
      JSON.parse(await readFile(nextFile, "utf8")).mcpServers.office.disabled,
      true,
    );
    await rm(nextFile);
    syncPiMcp(config);
    assert.ok(JSON.parse(await readFile(nextFile, "utf8")).mcpServers.remote);
    save({ mcp: view.settings.mcp.map((m) => ({ ...m, engine: "opencode" })) });
    assert.deepEqual(
      JSON.parse(await readFile(nextFile, "utf8")).mcpServers,
      {},
    );
    save({ mcp: [] });
    if (process.platform !== "win32")
      assert.equal((await stat(nextFile)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "published pi-mcp-adapter loads generated stdio and HTTP configuration with literal credentials",
  {
    skip: !process.env.AGENT_MCP_ADAPTER_PATH,
    timeout: 60000,
  },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "bridge-mcp-native-"),
    );
    const config = readConfig([], { AGENT_DATA_DIR: directory });
    const adapter = new PiAdapter(config);
    const token = "!literal ${TOKEN} $env:TOKEN {env:TOKEN}";
    const headers: string[] = [];
    const http = createServer(async (request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      headers.push(request.headers.authorization ?? "");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const { id, method } = JSON.parse(Buffer.concat(chunks).toString());
      if (id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        method === "initialize"
          ? {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "remote", version: "1" },
            }
          : method === "tools/list"
            ? { tools: [] }
            : {};
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
    try {
      await new Promise<void>((resolve) =>
        http.listen(0, "127.0.0.1", resolve),
      );
      const address = http.address();
      assert.ok(address && typeof address !== "string");
      const task = path.join(directory, "task");
      await mkdir(task);
      const marker = path.join(directory, "result.json");
      const source = path.join(directory, "extension");
      await mkdir(source);
      const server = path.join(directory, "server.mjs");
      await writeFile(
        server,
        `import { createInterface } from 'node:readline';
      createInterface({ input: process.stdin }).on('line', line => {
        const { id, method } = JSON.parse(line);
        if (id === undefined) return;
        const result = method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
          : method === 'tools/list' ? { tools: [{ name: 'echo', description: 'Echo process context', inputSchema: { type: 'object', properties: {} } }] }
          : method === 'tools/call' ? { content: [{ type: 'text', text: JSON.stringify({ cwd: process.cwd(), token: process.env.TOKEN, arg: process.argv[2] }) }] }
          : {};
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
      });`,
      );
      await writeFile(
        path.join(source, "package.json"),
        JSON.stringify({
          name: "pi-mcp-adapter",
          pi: { extensions: ["index.ts"] },
        }),
      );
      await writeFile(
        path.join(source, "index.ts"),
        `import mcp from ${JSON.stringify(path.join(process.env.AGENT_MCP_ADAPTER_PATH!, "index.ts"))};
      import { writeFileSync } from 'node:fs';
      export default async function(pi) {
        let tool;
        await mcp(new Proxy(pi, { get(target, key) {
          if (key === 'registerTool') return definition => { if (definition.name === 'mcp') tool = definition; target.registerTool(definition); };
          return Reflect.get(target, key);
        } }));
        pi.on('session_start', async (_, ctx) => {
          const connected = await tool.execute('connect', { connect: 'office' }, undefined, undefined, ctx);
          const called = await tool.execute('call', { tool: 'office_echo', args: {} }, undefined, undefined, ctx);
          const remote = await tool.execute('remote', { connect: 'remote' }, undefined, undefined, ctx);
          writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ connected, called, remote }));
        });
      }`,
      );
      const manager = new SettingsManager(config);
      let view = manager.view();
      view = manager.save({
        revision: view.revision,
        settings: {
          ...view.settings,
          mcp: [
            {
              id: "office",
              engine: "pi",
              config: {
                type: "local",
                command: [process.execPath, server, token],
                environment: { TOKEN: token },
              },
            },
            {
              id: "remote",
              engine: "pi",
              config: {
                type: "remote",
                url: `http://127.0.0.1:${address.port}/mcp`,
                headers: { Authorization: token },
              },
            },
          ],
        },
      });
      await adapter.start();
      const session = {
        id: "mcp-test",
        title: "MCP test",
        directory: task,
        engineId: "pi",
        interactionPolicy: {
          permission: "auto" as const,
          question: "manual" as const,
        },
        availability: "ready" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      await assert.rejects(
        adapter.createSession(session),
        /pi-mcp-adapter did not load/,
      );
      view = await manager.packageOperation({ action: "install", source });
      assert.equal(view.piMcp.adapterDetected, true);
      await adapter.createSession({ ...session, id: "mcp-installed" });
      const result = JSON.parse(await readFile(marker, "utf8"));
      assert.equal(result.called.isError, undefined, JSON.stringify(result));
      const echoed = JSON.parse(
        result.called.content.find((c: { type: string }) => c.type === "text")
          .text,
      );
      assert.deepEqual(echoed, { cwd: task, token, arg: token });
      assert.equal(
        result.remote.isError,
        undefined,
        JSON.stringify(result.remote),
      );
      assert.ok(headers.length >= 2);
      assert.ok(headers.every((header) => header === token));
    } finally {
      await adapter.stop();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  },
);
