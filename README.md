# Agent TUI Bar

Launch your AI CLI TUI tools from the VS Code Activity Bar.

Agent TUI Bar is a small VS Code extension for people who already use terminal-first coding agents such as Codex, Claude Code, OpenCode, Pi, and MimoCode. It does not replace those tools or wrap them in a custom chat UI. It gives them a focused launcher inside VS Code, opens them in the integrated terminal, and helps you copy file or selection references when you want to bring code context into the TUI.

## Features

- One-click launchers in the Activity Bar.
- Built-in launchers for Codex, Claude Code, OpenCode, Pi, and MimoCode.
- Opens CLI TUI sessions in the editor area by default, so they behave like tabs.
- Optional terminal panel mode if you prefer the traditional bottom terminal.
- Custom launchers through the sidebar manager or VS Code settings.
- Editor context menu actions for copying the current file or selected code as a reference.
- Explorer context menu action for copying selected file references.
- Remote-aware execution for WSL, SSH, and Dev Containers.

## Built-in Launchers

| Launcher | Default command |
| --- | --- |
| Codex | `codex` |
| Claude Code | `claude` |
| OpenCode | `opencode` |
| Pi | `pi` |
| MimoCode | `mimo` |

The extension starts these commands in VS Code's integrated terminal. Install and authenticate each CLI tool separately before launching it from Agent TUI Bar.

## Usage

1. Open the `Agent TUI Bar` icon in the Activity Bar.
2. Click `Codex`, `Claude Code`, `OpenCode`, `Pi`, or `MimoCode`.
3. The CLI TUI opens in the editor area by default.

You can also right-click in the editor or Explorer to copy references:

- `Agent TUI Bar: Copy Selection Reference`
- `Agent TUI Bar: Copy Current File Reference`
- `Agent TUI Bar: Copy Explorer Selection References`

Selection references use this default format:

````md
src/example.ts:12-28

```typescript
selected code
```
````

File references use this format:

```md
@src/example.ts
```

## Configuration

Add custom launchers with `Agent TUI Bar: Manage Launchers` from the Launchers view title, or edit your VS Code settings directly:

```json
{
  "agentTuiBar.launchers": [
    {
      "id": "my-agent",
      "label": "My Agent",
      "command": "my-agent",
      "args": ["--project", "${workspaceFolder}"],
      "cwd": "${workspaceFolder}",
      "env": {
        "MY_AGENT_MODE": "tui"
      }
    }
  ]
}
```

Custom launchers with the same `id` as a built-in launcher override that built-in item. Other custom launchers are appended to the list.

Supported launcher fields:

| Field | Required | Description |
| --- | --- | --- |
| `id` | Yes | Stable launcher id. |
| `label` | Yes | Name shown in the sidebar. |
| `command` | Yes | CLI command to run. |
| `args` | No | Command arguments. |
| `cwd` | No | Working directory. Defaults to `${workspaceFolder}`. |
| `env` | No | Environment variables passed to the terminal. |

Supported variables in `command`, `args`, `cwd`, and `env`:

| Variable | Meaning |
| --- | --- |
| `${workspaceFolder}` | Current workspace folder path. |
| `${fileDirname}` | Directory of the active file. |
| `${file}` | Absolute path of the active file. |
| `${relativeFile}` | Active file path relative to the workspace. |

## Terminal Settings

```json
{
  "agentTuiBar.terminal.location": "editor",
  "agentTuiBar.terminal.reuse": false,
  "agentTuiBar.terminal.cwdMode": "workspace"
}
```

| Setting | Default | Options |
| --- | --- | --- |
| `agentTuiBar.terminal.location` | `editor` | `editor`, `panel` |
| `agentTuiBar.terminal.reuse` | `false` | `true`, `false` |
| `agentTuiBar.terminal.cwdMode` | `workspace` | `workspace`, `fileDirectory`, `custom` |

`editor` opens terminals in the editor area as tabs. `panel` opens terminals in the bottom terminal panel.

## Reference Template

Customize selected-code references with:

```json
{
  "agentTuiBar.reference.template": "${relativePath}:${startLine}-${endLine}\n\n```${language}\n${text}\n```"
}
```

Available template variables:

- `${relativePath}`
- `${startLine}`
- `${endLine}`
- `${language}`
- `${text}`

## Remote Development

Agent TUI Bar is declared as a workspace extension. In WSL, SSH, and Dev Container windows, install or enable the extension in the remote workspace so launchers execute in that remote environment.

This is important because commands such as `codex`, `claude`, `opencode`, `pi`, and `mimo` must exist on the same machine where the terminal is created.

## Development

```sh
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

## Packaging

Install `vsce` if needed:

```sh
npm install -g @vscode/vsce
```

Build a `.vsix` package:

```sh
vsce package
```

## Requirements

- VS Code 1.90 or newer.
- The CLI tools you want to launch must be installed and available on `PATH`.

## License

MIT
