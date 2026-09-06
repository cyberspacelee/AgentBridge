# Shared Office Tools

Both engines receive the absolute Python executable and this tool entry point in their system instructions. The agent calls it through its native command tool, so arguments, output and failures remain in the engine trajectory.

Install Python 3.11-3.13, create `code/.venv`, then install `requirements.txt`. Set `AGENT_TOOLS_PYTHON` to use another prepared interpreter. Windows output directories must support hard links (NTFS); existing output files are never overwritten.

Write a UTF-8 JSON request in the task directory, then invoke:

```text
<python> <code>/tools/office.py --directory <task-directory> --request request.json
```

Alternatively pass one JSON object on stdin. Exit code 0 means the tool operation succeeded, not that the task's business requirements passed. The result is one JSON object containing `ok`, `result` or `code`/`message`.

| Action | Request Fields | Result |
| --- | --- | --- |
| `read` | `path` (docx/pptx/xlsx/csv) | Paragraphs, tables, ordered slides or sheets |
| `replace` | `path`, `output`, `replacements` map, optional PPTX `order` | New document; modified package parts and replacement count |
| `tables_to_xlsx` | DOCX `path`, XLSX `output` | One sheet per top-level table, literal text retained |
| `create_pptx` | `output`, `slides: [{title, bullets}]` | New presentation, 1-5 slides |
| `analyse` | `path`, `output` (.md), optional `sheet`, `groupBy`, `measure`, `aggregate` | Decimal aggregation and Markdown report |
| `validate` | `path` | ZIP CRC, XML parsing, library reopen and SHA-256 |
| `find` | optional basename `pattern` | Recursive file list, no symlink traversal |
| `delete` | `paths` (literal file paths) | Deleted paths, explicit partial-failure result |
| `launch` | `application: "outlook"` | Windows process ID; Outlook must be installed and resolvable |
| `search` | `query`, optional `count` (1-20) | Brave Search results with source URLs |

```json
{"action":"replace","path":"input.docx","output":"updated.docx","replacements":{"2025":"2026"}}
```

```json
{"action":"replace","path":"input.pptx","output":"reordered.pptx","order":[3,1,2]}
```

```json
{"action":"analyse","path":"sales.xlsx","output":"analysis.md","groupBy":["Region"],"measure":"Revenue","aggregate":"sum"}
```

Aggregation supports sum/mean/count/min/max. Formula cells are returned as formulas and rejected as numeric measures: the tool does not silently use stale Excel caches. Use the engine's native scripts for cleaning, richer analysis, plotting or spreadsheet modifications. Installed openpyxl, python-docx and python-pptx are available to those scripts.

DOCX/PPTX replacement changes relevant XML text nodes and preserves unrelated ZIP entries. A replacement spanning formatted runs takes the first run's format for inserted text; untouched text keeps its run properties. PPTX reordering changes the presentation slide list and preserves slide resources. Charts, fields, embedded objects and unusual layouts require sample-specific verification. Package validation does not assert visual fidelity or business correctness.

Limits: input/package 100 MiB; 10,000 package entries; JSON request 1 MiB; tabular read 200,000 cells; directory search 10,000 entries. All file operations remain beneath the working directory. Native engine shell tools have their own broader permissions.

Search requires server-side `BRAVE_SEARCH_API_KEY`. No key is sent to the frontend. Reference: [Brave Web Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get). Outlook and search need target-environment verification. WeLink sending is not implemented without the target tenant API/access method; it must not be reported as successfully sent.
