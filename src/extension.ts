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
  env?: Record<string, string>;
}

const defaultLaunchers: LauncherConfig[] = [
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    args: [],
    cwd: "${workspaceFolder}"
  },
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    args: [],
    cwd: "${workspaceFolder}"
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    args: [],
    cwd: "${workspaceFolder}"
  },
  {
    id: "pi",
    label: "Pi",
    command: "pi",
    args: [],
    cwd: "${workspaceFolder}"
  },
  {
    id: "mimocode",
    label: "MimoCode",
    command: "mimo",
    args: [],
    cwd: "${workspaceFolder}"
  }
];

class LauncherItem extends vscode.TreeItem {
  constructor(readonly launcher: LauncherConfig) {
    super(launcher.label, vscode.TreeItemCollapsibleState.None);
    this.id = launcher.id;
    this.description = launcher.command;
    this.tooltip = `${launcher.label}: ${buildDisplayCommand(launcher)}`;
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
    vscode.commands.registerCommand("agentTuiBar.manageLaunchers", () => manageLaunchers(provider)),
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
  const configured = getConfiguredLaunchers();
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

function getConfiguredLaunchers(): LauncherConfig[] {
  return vscode.workspace
    .getConfiguration("agentTuiBar")
    .get<LauncherConfig[]>("launchers", [])
    .filter(isUsableLauncher)
    .map(normalizeLauncher);
}

function normalizeLauncher(launcher: LauncherConfig): LauncherConfig {
  return {
    id: launcher.id,
    label: launcher.label,
    command: launcher.command,
    args: launcher.args || [],
    cwd: launcher.cwd || "${workspaceFolder}",
    env: launcher.env || {}
  };
}

async function manageLaunchers(provider: LaunchersProvider): Promise<void> {
  const action = await vscode.window.showQuickPick(
    [
      { label: "Add Launcher", description: "Create a custom launcher" },
      { label: "Edit Launcher", description: "Override or update a launcher" },
      { label: "Delete Launcher", description: "Remove a custom launcher or built-in override" }
    ],
    {
      placeHolder: "Manage Agent TUI launchers"
    }
  );

  if (!action) {
    return;
  }

  if (action.label === "Add Launcher") {
    await addLauncher(provider);
    return;
  }

  if (action.label === "Edit Launcher") {
    await editLauncher(provider);
    return;
  }

  await deleteLauncher(provider);
}

async function addLauncher(provider: LaunchersProvider): Promise<void> {
  const launcher = await promptForLauncher();
  if (!launcher) {
    return;
  }

  const configured = getConfiguredLaunchers();
  const existingIndex = configured.findIndex((item) => item.id === launcher.id);

  if (existingIndex >= 0 || defaultLaunchers.some((item) => item.id === launcher.id)) {
    const overwrite = await vscode.window.showWarningMessage(
      `Launcher "${launcher.id}" already exists. Overwrite it?`,
      { modal: true },
      "Overwrite"
    );

    if (overwrite !== "Overwrite") {
      return;
    }
  }

  await saveLauncher(launcher);
  provider.refresh();
  vscode.window.showInformationMessage(`Saved launcher "${launcher.label}".`);
}

async function editLauncher(provider: LaunchersProvider): Promise<void> {
  const selected = await pickLauncher("Select a launcher to edit");
  if (!selected) {
    return;
  }

  const launcher = await promptForLauncher(selected);
  if (!launcher) {
    return;
  }

  if (launcher.id !== selected.id && getLaunchers().some((item) => item.id === launcher.id)) {
    const overwrite = await vscode.window.showWarningMessage(
      `Launcher "${launcher.id}" already exists. Overwrite it?`,
      { modal: true },
      "Overwrite"
    );

    if (overwrite !== "Overwrite") {
      return;
    }
  }

  await saveLauncher(launcher, selected.id);
  provider.refresh();
  vscode.window.showInformationMessage(`Saved launcher "${launcher.label}".`);
}

async function deleteLauncher(provider: LaunchersProvider): Promise<void> {
  const selected = await pickLauncher("Select a launcher to delete");
  if (!selected) {
    return;
  }

  const configured = getConfiguredLaunchers();
  const existingIndex = configured.findIndex((item) => item.id === selected.id);

  if (existingIndex < 0) {
    vscode.window.showInformationMessage(`"${selected.label}" is built in and has no custom override to delete.`);
    return;
  }

  const remove = await vscode.window.showWarningMessage(
    `Remove custom settings for "${selected.label}"?`,
    { modal: true },
    "Remove"
  );

  if (remove !== "Remove") {
    return;
  }

  configured.splice(existingIndex, 1);
  await updateConfiguredLaunchers(configured);
  provider.refresh();
  vscode.window.showInformationMessage(`Removed custom settings for "${selected.label}".`);
}

async function pickLauncher(placeHolder: string): Promise<LauncherConfig | undefined> {
  const configuredIds = new Set(getConfiguredLaunchers().map((launcher) => launcher.id));
  const items = getLaunchers().map((launcher) => ({
    label: launcher.label,
    description: launcher.command,
    detail: configuredIds.has(launcher.id) ? "Custom" : "Built in",
    launcher
  }));
  const selected = await vscode.window.showQuickPick(items, { placeHolder });
  return selected?.launcher;
}

async function promptForLauncher(existing?: LauncherConfig): Promise<LauncherConfig | undefined> {
  const label = await promptForRequiredString("Launcher name", existing?.label);
  if (label === undefined) {
    return undefined;
  }

  const id = await promptForRequiredString("Launcher id", existing?.id || toLauncherId(label), validateLauncherId);
  if (id === undefined) {
    return undefined;
  }

  const command = await promptForRequiredString("Command", existing?.command);
  if (command === undefined) {
    return undefined;
  }

  const argsInput = await vscode.window.showInputBox({
    title: "Arguments",
    prompt: "Space-separated arguments. Variables like ${workspaceFolder} are supported.",
    value: (existing?.args || []).join(" ")
  });
  if (argsInput === undefined) {
    return undefined;
  }

  const cwd = await vscode.window.showInputBox({
    title: "Working directory",
    prompt: "Supports ${workspaceFolder}, ${fileDirname}, ${file}, and ${relativeFile}.",
    value: existing?.cwd || "${workspaceFolder}"
  });
  if (cwd === undefined) {
    return undefined;
  }

  const envInput = await vscode.window.showInputBox({
    title: "Environment variables",
    prompt: "JSON object, for example {\"MY_AGENT_MODE\":\"tui\"}.",
    value: JSON.stringify(existing?.env || {}),
    validateInput: validateEnvJson
  });
  if (envInput === undefined) {
    return undefined;
  }

  return normalizeLauncher({
    id: id.trim(),
    label: label.trim(),
    command: command.trim(),
    args: splitArgs(argsInput),
    cwd: cwd || "${workspaceFolder}",
    env: parseEnvJson(envInput)
  });
}

async function promptForRequiredString(
  title: string,
  value?: string,
  validateInput?: (value: string) => string | undefined
): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    title,
    value,
    validateInput: (input) => {
      if (!input.trim()) {
        return `${title} is required.`;
      }

      return validateInput?.(input.trim());
    }
  });

  return input?.trim();
}

async function saveLauncher(launcher: LauncherConfig, previousId = launcher.id): Promise<void> {
  const configured = getConfiguredLaunchers();
  const withoutPrevious = configured.filter((item) => item.id !== previousId && item.id !== launcher.id);
  withoutPrevious.push(launcher);
  await updateConfiguredLaunchers(withoutPrevious);
}

async function updateConfiguredLaunchers(launchers: LauncherConfig[]): Promise<void> {
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration("agentTuiBar").update("launchers", launchers, target);
}

function validateLauncherId(value: string): string | undefined {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    return "Use only letters, numbers, dots, underscores, and hyphens.";
  }

  return undefined;
}

function validateEnvJson(value: string): string | undefined {
  try {
    parseEnvJson(value);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON object.";
  }
}

function parseEnvJson(value: string): Record<string, string> {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Enter a JSON object.");
  }

  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== "string") {
      throw new Error(`Environment variable "${key}" must be a string.`);
    }
  }

  return parsed as Record<string, string>;
}

function splitArgs(value: string): string[] {
  return value.trim() ? value.trim().split(/\s+/) : [];
}

function toLauncherId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
