import { writeFile } from "node:fs/promises";
import { apiMarkdown } from "../src/gateway/api-markdown.js";
await writeFile(new URL("../docs/API_REFERENCE.md", import.meta.url), apiMarkdown());
