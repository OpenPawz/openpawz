/**
 * extension.ts — Pawz CODE VS Code Extension.
 *
 * Registers the @code chat participant. Points at the standalone pawz-code
 * server (default port 3941) — completely separate from Pawz Desktop.
 *
 * Usage: @code <your message>
 *
 * Configure via VS Code settings:
 *   pawzCode.serverUrl  — default http://127.0.0.1:3941
 *   pawzCode.authToken  — from ~/.pawz-code/config.toml
 */

import * as vscode from 'vscode';
import { PawzCodeClient } from './pawz-client';
import { ToolRenderer } from './tool-renderer';

const PARTICIPANT_ID = 'pawz-code';

class MemoryContentProvider implements vscode.TextDocumentContentProvider {
  private store = new Map<string, string>();
  setContent(uri: vscode.Uri, content: string): void {
    this.store.set(uri.toString(), content);
  }
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.store.get(uri.toString()) ?? '';
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handleChatRequest);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');
  context.subscriptions.push(participant);

  const diffProvider = new MemoryContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('pawz-code-diff', diffProvider),
  );

  // Show diff command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'pawz-code.showDiff',
      async (filePath: string, oldContent: string, newContent: string) => {
        const label = filePath.split(/[\\/]/).pop() ?? filePath;
        const beforeUri = vscode.Uri.parse(
          `pawz-code-diff:before/${encodeURIComponent(filePath)}`,
        );
        const afterUri = vscode.Uri.parse(
          `pawz-code-diff:after/${encodeURIComponent(filePath)}`,
        );
        diffProvider.setContent(beforeUri, oldContent);
        diffProvider.setContent(afterUri, newContent);
        await vscode.commands.executeCommand(
          'vscode.diff',
          beforeUri,
          afterUri,
          `Pawz CODE → ${label}`,
          { preview: true } as vscode.TextDocumentShowOptions,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pawz-code.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'pawzCode');
    }),
  );
}

async function handleChatRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('pawzCode');
  const serverUrl = cfg.get<string>('serverUrl') ?? 'http://127.0.0.1:3941';
  const authToken = cfg.get<string>('authToken') ?? '';

  if (!authToken) {
    stream.markdown(
      '**Pawz CODE is not connected.**\n\n' +
        '1. Run `pawz-code` binary (from `pawz-code/server/`)\n' +
        '2. Copy the auth token printed on first run (or from `~/.pawz-code/config.toml`)\n' +
        '3. Set it in VS Code settings: `pawzCode.authToken`\n\n' +
        'Then try `@code hello` again.',
    );
    stream.button({ command: 'pawz-code.openSettings', title: '$(gear) Open Settings' });
    return;
  }

  const client = new PawzCodeClient(serverUrl, authToken);
  const renderer = new ToolRenderer(stream);
  const context = buildWorkspaceContext();

  const abortController = new AbortController();
  token.onCancellationRequested(() => abortController.abort());

  try {
    await client.streamChat(
      { message: request.prompt, context, user_id: 'vscode' },
      (event) => renderer.handleEvent(event),
      abortController.signal,
    );
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'AbortError') return;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      stream.markdown(
        `**Could not reach pawz-code** at \`${serverUrl}\`.\n\n` +
          'Make sure the `pawz-code` server is running.\n' +
          'Check `pawzCode.serverUrl` matches the configured port.',
      );
      stream.button({ command: 'pawz-code.openSettings', title: '$(gear) Check Settings' });
    } else {
      stream.markdown(`**Pawz CODE error:** ${msg}`);
    }
  }
}

function buildWorkspaceContext(): string {
  const parts: string[] = [];

  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    parts.push(`Workspace root: ${wsFolder.uri.fsPath}`);
  }

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const doc = editor.document;
    const rel = vscode.workspace.asRelativePath(doc.uri);
    parts.push(`Active file: ${rel} (${doc.languageId})`);

    const sel = editor.selection;
    if (!sel.isEmpty) {
      const text = doc.getText(sel);
      const range = `${sel.start.line + 1}–${sel.end.line + 1}`;
      parts.push(
        `Selected code (lines ${range}):\n\`\`\`${doc.languageId}\n${text}\n\`\`\``,
      );
    }
  }

  parts.push(
    'You have full access to the workspace via read_file, write_file, exec, ' +
      'list_directory, grep, fetch, remember, and recall tools. ' +
      'Use absolute paths or resolve relative paths against the workspace root above.',
  );

  return parts.join('\n\n');
}

export function deactivate(): void {}
