"""Build a source-only submission archive without traversing dependency or data directories."""
import os
from pathlib import Path
import zipfile

code = Path(__file__).resolve().parents[1]
root = code.parent
destination = root / "solution.zip"
temporary = destination.with_suffix(".zip.tmp")
excluded = {"node_modules", ".git", "dist", ".venv", ".agentbridge", "__pycache__", "test-results", "playwright-report"}
extensions = {".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".json", ".yaml", ".md", ".txt", ".py", ".ps1"}
root_files = {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "playwright.config.ts", ".gitignore", "README.md", "ARCHITECTURE.md", "DEVELOPMENT.md", ".env.example"}
config_files = {".gitignore", ".prettierrc", ".prettierignore", ".env.example"}
try:
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(root / "INSTRUCTION.md", "INSTRUCTION.md")
        for directory, dirs, files in os.walk(code, followlinks=False):
            dirs[:] = [d for d in dirs if d not in excluded and not (Path(directory) / d).is_symlink()]
            if Path(directory) == code:
                dirs[:] = [d for d in dirs if d in {"src", "shared", "tools", "web", "test", "docs"}]
                files = [name for name in files if name in root_files]
            if Path(directory) == code / "web":
                dirs[:] = [d for d in dirs if d in {"src", "public"}]
            for name in files:
                source = Path(directory) / name
                if source.is_symlink() or (name.startswith(".env") and name != ".env.example") or (source.suffix not in extensions and name not in config_files):
                    continue
                archive_name = "code/" + source.relative_to(code).as_posix()
                if source == code / "web/README.md":
                    archive.writestr(archive_name, source.read_text(encoding="utf-8").replace("../../DEVELOPMENT.md", "../DEVELOPMENT.md").replace("../../ARCHITECTURE.md", "../ARCHITECTURE.md"))
                else:
                    archive.write(source, archive_name)
        for name in ("ARCHITECTURE.md", "DEVELOPMENT.md"):
            if (root / name).exists():
                archive.write(root / name, "code/" + name)
        for source in sorted((root / "docs").rglob("*.md")):
            if not source.is_symlink():
                archive.write(source, "code/" + source.relative_to(root).as_posix())
    with zipfile.ZipFile(temporary) as archive:
        assert archive.testzip() is None
        assert {name.split("/")[0] for name in archive.namelist()} == {"INSTRUCTION.md", "code"}
    temporary.replace(destination)
    print(f"{destination} ({destination.stat().st_size} bytes)")
finally:
    temporary.unlink(missing_ok=True)
