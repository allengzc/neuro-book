#!/usr/bin/env python3
"""
Create a Neuro Book skill skeleton.

Usage:
    init_skill.py <folder-name> [--name <skill-name>] [--description <text>]
        [--path <skills-root>] [--resources scripts,references,assets]

Examples:
    init_skill.py plot-helper
    init_skill.py shuangwen-style --name 爽文风格
    init_skill.py lore-tools --resources scripts,references
"""

import argparse
import re
import sys
from pathlib import Path

MAX_SKILL_NAME_LENGTH = 64
ALLOWED_RESOURCES = ("scripts", "references", "assets")
DEFAULT_SKILL_ROOT = Path(__file__).resolve().parents[2]
SKILL_NAME_PATTERN = re.compile(r"^[^\s\\/]+$", re.UNICODE)

SKILL_TEMPLATE = """---
name: {skill_name}
description: {skill_description}
---

# {skill_title}

## Purpose

[TODO: Explain what this skill helps with in 1-2 short paragraphs.]

## Workflow

1. [TODO: First action]
2. [TODO: Second action]
3. [TODO: Final action]

## Resource Routing

- Read `references/...` only when deeper detail is needed.
- Run `scripts/...` only when deterministic automation helps.
- Use `assets/...` only when output files or templates are required.

## Notes

- Keep this file concise.
- Put long reference material in `references/`.
- Remove sections that do not help another agent perform the task.
"""

REFERENCE_TEMPLATE = """# Reference Notes

[TODO: Put detailed background, schemas, examples, or long-form guidance here.]
"""

SCRIPT_TEMPLATE = """#!/usr/bin/env python3
\"\"\"
Placeholder helper for {skill_name}.
Replace this file with real automation or delete it.
\"\"\"


def main():
    \"\"\"Run the placeholder helper.\"\"\"
    print("Replace scripts/example.py with a real helper or delete it.")


if __name__ == "__main__":
    main()
"""

ASSET_TEMPLATE = """Placeholder asset file.
Replace this file with a real template, image, sample file, or delete it.
"""


def is_valid_skill_name(value: str) -> bool:
    """Return True when the skill name can be typed as a single `$name` token."""
    if not value or len(value) > MAX_SKILL_NAME_LENGTH:
        return False
    return SKILL_NAME_PATTERN.match(value) is not None


def is_valid_folder_name(value: str) -> bool:
    """Return True when the folder name is a single directory segment."""
    return bool(value) and value not in {".", ".."} and "/" not in value and "\\" not in value


def build_skill_title(skill_name: str) -> str:
    """Build a readable heading from the skill name."""
    if "-" not in skill_name and "_" not in skill_name:
        return skill_name
    parts = re.split(r"[-_]+", skill_name)
    return " ".join(part.capitalize() for part in parts if part)


def parse_resources(raw_resources: str) -> list[str]:
    """Parse and validate the requested resource directories."""
    if not raw_resources:
        return []

    resources: list[str] = []
    for item in raw_resources.split(","):
        resource = item.strip()
        if not resource:
            continue
        if resource not in ALLOWED_RESOURCES:
            allowed = ", ".join(ALLOWED_RESOURCES)
            print(f"[ERROR] Unknown resource '{resource}'. Allowed: {allowed}")
            sys.exit(1)
        if resource not in resources:
            resources.append(resource)
    return resources


def write_file(path: Path, content: str, executable: bool = False) -> None:
    """Write a UTF-8 file and optionally mark it executable."""
    path.write_text(content, encoding="utf-8")
    if executable:
        path.chmod(0o755)


def init_skill(folder_name: str, skill_name: str, description: str, root_path: Path, resources: list[str]) -> int:
    """Create the skill directory and starter files."""
    skill_dir = root_path / folder_name
    if skill_dir.exists():
        print(f"[ERROR] Skill directory already exists: {skill_dir}")
        return 1

    skill_dir.mkdir(parents=True, exist_ok=False)

    skill_title = build_skill_title(skill_name)
    write_file(
        skill_dir / "SKILL.md",
        SKILL_TEMPLATE.format(
            skill_name=skill_name,
            skill_description=description,
            skill_title=skill_title,
        ),
    )

    for resource in resources:
        resource_dir = skill_dir / resource
        resource_dir.mkdir(exist_ok=True)
        if resource == "references":
            write_file(resource_dir / "overview.md", REFERENCE_TEMPLATE)
        elif resource == "scripts":
            write_file(resource_dir / "example.py", SCRIPT_TEMPLATE.format(skill_name=skill_name), executable=True)
        elif resource == "assets":
            write_file(resource_dir / "placeholder.txt", ASSET_TEMPLATE)

    print(f"[OK] Created skill at {skill_dir}")
    print("Next steps:")
    print("1. Replace the placeholder description in SKILL.md with a concrete trigger description.")
    print("2. Rewrite the body so another agent can follow it directly.")
    if resources:
        print("3. Replace or delete placeholder files in the resource directories.")
        print("4. Run quick_validate.py when shell execution is available.")
    else:
        print("3. Add resource directories only if they are actually needed.")
        print("4. Run quick_validate.py when shell execution is available.")
    return 0


def main() -> int:
    """Parse CLI arguments and create the skill skeleton."""
    parser = argparse.ArgumentParser(description="Create a Neuro Book skill skeleton.")
    parser.add_argument("folder_name", help="Directory name under the skill root")
    parser.add_argument("--name", help="Frontmatter skill name. Defaults to folder_name.")
    parser.add_argument(
        "--description",
        default="[TODO: Explain what this skill does and when it should be used.]",
        help="Frontmatter description.",
    )
    parser.add_argument(
        "--path",
        default=str(DEFAULT_SKILL_ROOT),
        help="Skill root directory. Defaults to assets/agent/skills in this repo.",
    )
    parser.add_argument(
        "--resources",
        default="",
        help="Comma-separated resource directories: scripts,references,assets",
    )
    args = parser.parse_args()

    folder_name = args.folder_name.strip()
    skill_name = (args.name or folder_name).strip()
    description = args.description.strip()
    root_path = Path(args.path).resolve()
    resources = parse_resources(args.resources)

    if not is_valid_folder_name(folder_name):
        print("[ERROR] folder_name must be a single directory name.")
        return 1
    if not is_valid_skill_name(skill_name):
        print("[ERROR] skill name must be a single token without spaces or slashes.")
        return 1
    if not description:
        print("[ERROR] description cannot be empty.")
        return 1

    return init_skill(folder_name, skill_name, description, root_path, resources)


if __name__ == "__main__":
    sys.exit(main())
