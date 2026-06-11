import * as path from "node:path";
import * as vscode from "vscode";

type CwdMode = "workspace" | "fileDirectory" | "custom";
type TerminalLocationMode = "editor" | "panel";

interface LauncherConfig {
  id: string;
  label: string;
  command: string;
  args?: string[];
  cwd?: string;
  icon?: string;
  env?: Record<string, string>;
}

const defaultLaunchers: LauncherConfig[] = [
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    args: [],
    cwd: "${workspaceFolder}",
    icon: "terminal"
  },
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    args: [],
    cwd: "${workspaceFolder}",
    icon: "hubot"
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    args: [],
    cwd: "${workspaceFolder}",
    icon: "code"
  },
  {
    id: "pi",
    label: "Pi",
    command: "pi",
    args: [],
    cwd: "${workspaceFolder}",
    icon: "rocket"
  }
];

class LauncherItem extends vscode.TreeItem {
  constructor(readonly launcher: LauncherConfig) {
    super(launcher.label, vscode.TreeItemCollapsibleState.None);
    this.id = launcher.id;
    this.description = launcher.command;
    this.tooltip = `${launcher.label}: ${buildDisplayCommand(launcher)}`;
    this.iconPath = new vscode.ThemeIcon(launcher.icon || "terminal");
    this.command = {
      command: "agentTuiBar.launchLauncher",
      title: "Launch Agent",
      arguments: [launcher]
    };
  }
}

class LaunchersProvider implements vscode.TreeDataProvider<LauncherItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<LauncherItem | undefined | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  getTreeItem(element: LauncherItem): vscode.TreeItem {
    return element;
  }

  getChildren(): LauncherItem[] {
    return getLaunchers().map((launcher) => new LauncherItem(launcher));
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }
}

const terminalsByLauncher = new Map<string, vscode.Terminal>();

export function activate(context: vscode.ExtensionContext): void {
  const provider = new LaunchersProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("agentTuiBar.launchers", provider),
    vscode.commands.registerCommand("agentTuiBar.refreshLaunchers", () => provider.refresh()),
    vscode.commands.registerCommand("agentTuiBar.launchLauncher", (launcher?: LauncherConfig | LauncherItem) =>
      launchAgent(resolveLauncherArgument(launcher))
    ),
    vscode.commands.registerCommand("agentTuiBar.copyCurrentFileReference", () => copyCurrentFileReference()),
    vscode.commands.registerCommand("agentTuiBar.copySelectionReference", () => copySelectionReference()),
    vscode.commands.registerCommand(
      "agentTuiBar.copyExplorerSelectionReferences",
      (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => copyExplorerSelectionReferences(uri, selectedUris)
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("agentTuiBar")) {
        provider.refresh();
      }
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      for (const [launcherId, trackedTerminal] of terminalsByLauncher.entries()) {
        if (trackedTerminal === terminal) {
          terminalsByLauncher.delete(launcherId);
        }
      }
    })
  );
}

export function deactivate(): void {
  terminalsByLauncher.clear();
}

function getLaunchers(): LauncherConfig[] {
  const configured = vscode.workspace
    .getConfiguration("agentTuiBar")
    .get<LauncherConfig[]>("launchers", []);
  const merged = new Map(defaultLaunchers.map((launcher) => [launcher.id, launcher]));

  for (const launcher of configured) {
    if (!isUsableLauncher(launcher)) {
      continue;
    }

    const existing = merged.get(launcher.id);
    merged.set(launcher.id, {
      ...existing,
      ...launcher,
      args: launcher.args || existing?.args || [],
      cwd: launcher.cwd || existing?.cwd || "${workspaceFolder}",
      icon: launcher.icon || existing?.icon || "terminal",
      env: launcher.env || existing?.env || {}
    });
  }

  return Array.from(merged.values());
}

function isUsableLauncher(launcher: unknown): launcher is LauncherConfig {
  if (!launcher || typeof launcher !== "object") {
    return false;
  }

  const candidate = launcher as Partial<LauncherConfig>;
  return Boolean(candidate.id && candidate.label && candidate.command);
}

function resolveLauncherArgument(launcher?: LauncherConfig | LauncherItem): LauncherConfig | undefined {
  if (launcher instanceof LauncherItem) {
    return launcher.launcher;
  }

  if (isUsableLauncher(launcher)) {
    return launcher;
  }

  return undefined;
}

function launchAgent(launcher?: LauncherConfig): void {
  if (!launcher) {
    vscode.window.showWarningMessage("No Agent TUI launcher selected.");
    return;
  }

  const config = vscode.workspace.getConfiguration("agentTuiBar");
  const reuseTerminal = config.get<boolean>("terminal.reuse", false);
  const cwdMode = config.get<CwdMode>("terminal.cwdMode", "workspace");
  const terminalLocation = config.get<TerminalLocationMode>("terminal.location", "editor");
  const activeFile = vscode.window.activeTextEditor?.document.uri;
  const cwd = resolveCwd(launcher, cwdMode);
  const command = buildShellCommand(launcher, activeFile);
  const existingTerminal = terminalsByLauncher.get(launcher.id);
  const terminal =
    reuseTerminal && existingTerminal
      ? existingTerminal
      : vscode.window.createTerminal({
          name: launcher.label,
          cwd,
          env: resolveEnv(launcher.env, activeFile),
          location:
            terminalLocation === "editor"
              ? vscode.TerminalLocation.Editor
              : vscode.TerminalLocation.Panel
        });

  terminalsByLauncher.set(launcher.id, terminal);
  terminal.show();
  terminal.sendText(command);
}

function resolveCwd(launcher: LauncherConfig, cwdMode: CwdMode): string | undefined {
  const activeFile = vscode.window.activeTextEditor?.document.uri;
  const workspaceFolder = activeFile
    ? vscode.workspace.getWorkspaceFolder(activeFile)
    : vscode.workspace.workspaceFolders?.[0];

  if (cwdMode === "fileDirectory" && activeFile?.scheme === "file") {
    return path.dirname(activeFile.fsPath);
  }

  if (cwdMode === "custom") {
    return replaceVariables(launcher.cwd || "${workspaceFolder}", activeFile);
  }

  return workspaceFolder?.uri.fsPath;
}

function buildDisplayCommand(launcher: LauncherConfig): string {
  return [launcher.command, ...(launcher.args || [])].join(" ");
}

function buildShellCommand(launcher: LauncherConfig, activeFile?: vscode.Uri): string {
  return [launcher.command, ...(launcher.args || [])]
    .map((part) => replaceVariables(part, activeFile) || "")
    .filter(Boolean)
    .map(quoteShellArg)
    .join(" ");
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }

  if (process.platform === "win32") {
    return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function copyCurrentFileReference(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor to copy a file reference from.");
    return;
  }

  await copyToClipboard(formatFileReference(editor.document.uri), "Copied file reference.");
}

async function copySelectionReference(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor to copy a selection reference from.");
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    await copyToClipboard(formatFileReference(editor.document.uri), "Copied file reference.");
    return;
  }

  const text = editor.document.getText(selection);
  const startLine = selection.start.line + 1;
  const endLine =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line
      : selection.end.line + 1;
  const relativePath = getRelativePath(editor.document.uri);
  const language = editor.document.languageId;
  const template = vscode.workspace
    .getConfiguration("agentTuiBar")
    .get<string>("reference.template", "${relativePath}:${startLine}-${endLine}\n\n```${language}\n${text}\n```");

  await copyToClipboard(
    applyTemplate(template, {
      relativePath,
      startLine: String(startLine),
      endLine: String(endLine),
      language,
      text
    }),
    "Copied selection reference."
  );
}

async function copyExplorerSelectionReferences(uri?: vscode.Uri, selectedUris?: vscode.Uri[]): Promise<void> {
  const uris = selectedUris && selectedUris.length > 0 ? selectedUris : uri ? [uri] : [];
  const fileUris = uris.filter((item) => item.scheme === "file");

  if (fileUris.length === 0) {
    vscode.window.showWarningMessage("No file selected to copy references from.");
    return;
  }

  await copyToClipboard(fileUris.map(formatFileReference).join("\n"), "Copied file references.");
}

async function copyToClipboard(text: string, message: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage(message);
}

function formatFileReference(uri: vscode.Uri): string {
  return `@${getRelativePath(uri)}`;
}

function getRelativePath(uri: vscode.Uri): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return uri.fsPath;
  }

  return normalizePath(path.relative(workspaceFolder.uri.fsPath, uri.fsPath));
}

function replaceVariables(value: string, activeFile?: vscode.Uri): string | undefined {
  const workspaceFolder = activeFile
    ? vscode.workspace.getWorkspaceFolder(activeFile)
    : vscode.workspace.workspaceFolders?.[0];
  const file = activeFile?.scheme === "file" ? activeFile.fsPath : "";
  const replacements: Record<string, string> = {
    workspaceFolder: workspaceFolder?.uri.fsPath || "",
    fileDirname: file ? path.dirname(file) : "",
    file,
    relativeFile: activeFile ? getRelativePath(activeFile) : ""
  };

  const replaced = value.replace(/\$\{(workspaceFolder|fileDirname|file|relativeFile)\}/g, (_, key: string) => {
    return replacements[key] || "";
  });

  return replaced || undefined;
}

function resolveEnv(env: LauncherConfig["env"], activeFile?: vscode.Uri): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, replaceVariables(value, activeFile) || ""])
  );
}

function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\$\{(relativePath|startLine|endLine|language|text)\}/g, (_, key: string) => values[key] || "");
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}
