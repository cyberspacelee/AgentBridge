import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { ESLint } = createRequire(
  new URL("../web/package.json", import.meta.url),
)("eslint");

test("business UI cannot bypass shadcn, while primitive and content boundaries remain usable", async () => {
  const eslint = new ESLint({
    cwd: fileURLToPath(new URL("../web", import.meta.url)),
  });
  for (const source of [
    "export function Example() { return <button>Save</button> }",
    "export function Example() { return <input /> }",
    "export function Example() { return <details><summary>Open</summary></details> }",
    'export function Example() { window.confirm("Delete?"); return null }',
    'import { Button } from "@base-ui/react/button"; export function Example() { return <Button /> }',
  ]) {
    const [result] = await eslint.lintText(source, {
      filePath: "src/pages/policy-example.tsx",
    });
    assert.ok(
      result.messages.some((message: { ruleId: string }) =>
        ["no-restricted-syntax", "no-restricted-imports"].includes(
          message.ruleId,
        ),
      ),
      source,
    );
  }
  for (const [filePath, source] of [
    [
      "src/pages/policy-example.tsx",
      'import { Button } from "@/components/ui/button"; export function Example() { return <Button>Save</Button> }',
    ],
    [
      "src/components/ui/policy-example.tsx",
      "export function Example() { return <input /> }",
    ],
    [
      "src/components/agent-message.tsx",
      "export function Example() { return <table><tbody /></table> }",
    ],
  ]) {
    const [result] = await eslint.lintText(source, { filePath });
    assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  }
});
