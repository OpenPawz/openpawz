/**
 * extension.ts — Pawz VS Code Extension entry point.
 *
 * Registers the @pawz chat participant and the pawz.showDiff command.
 * When the user types `@pawz <message>`, the handler:
 *   1. Collects workspace context (active file, selection, workspace root)
 *   2. POSTs to the Pawz webhook /chat/stream SSE endpoint
 *   3. Maps streaming events to VS Code ChatResponseStream APIs — live text,
 *      tool progress spinners, file anchors, and "Show diff" buttons
 */

import * as vscode from 'vscode';
import { PawzClient } from './pawz-client';
import { ToolRenderer } from './tool-renderer';

const PARTICIPANT_ID = 'pawz';

/** In-memory content provider for diff views (pawz-diff: scheme). */
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
  // ── Chat participant ─────────────────────────────────────────────────
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handleChatRequest);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'pawz-icon.png');
  context.subscriptions.push(participant);

  // ── Diff content provider ────────────────────────────────────────────
  const diffProvider = new MemoryContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('pawz-diff', diffProvider),
  );

  // ── showDiff command ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'pawz.showDiff',
      async (filePath: string, oldContent: string, newContent: string) => {
        const label = filePath.split(/[\\/]/).pop() ?? filePath;
        const beforeUri = vscode.Uri.parse(`pawz-diff:before/${encodeURIComponent(filePath)}`);
        const afterUri = vscode.Uri.parse(`pawz-diff:after/${encodeURIComponent(filePath)}`);
        diffProvider.setContent(beforeUri, oldContent);
        diffProvider.setContent(afterUri, newContent);
        await vscode.commands.executeCommand(
          'vscode.diff',
          beforeUri,
          afterUri,
          `Pawz → ${label}`,
          { preview: true } as vscode.TextDocumentShowOptions,
        );
      },
    ),
  );

  // ── Open settings command ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('pawz.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'pawz');
    }),
  );
}

// ── Chat request handler ───────────────────────────────────────────────────

async function handleChatRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('pawz');
  const baseUrl = cfg.get<string>('webhookUrl') ?? 'http://127.0.0.1:3940';
  const authToken = cfg.get<string>('authToken') ?? '';
  const agentId = cfg.get<string>('agentId') ?? 'default';
  const allowDangerous = cfg.get<boolean>('allowDangerousTools') ?? true;

  // --- Not configured yet ---
  if (!authToken) {
    stream.markdown(
      '**Pawz is not connected.**\n\n' +
        '1. Open **Pawz Desktop** → Settings → Channels → Webhook\n' +
        '2. Enable the webhook server and copy the auth token\n' +
        '3. Paste it into VS Code settings: `pawz.authToken`\n\n' +
        'Then try again.',
    );
    stream.button({
      command: 'pawz.openSettings',
      title: '$(gear) Open Pawz Settings',
    });
    return;
  }

  const client = new PawzClient(baseUrl, authToken);
  const renderer = new ToolRenderer(stream);

  // Build context to inject into the agent system prompt
  const context = buildWorkspaceContext(allowDangerous);

  const abortController = new AbortController();
  token.onCancellationRequested(() => abortController.abort());

  try {
    await client.streamChat(
      {
        message: request.prompt,
        agent_id: agentId,
        context,
        user_id: 'vscode',
      },
      (event) => renderer.handleEvent(event),
      abortController.signal,
    );
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'AbortError') return;

    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('fetch failed') ||
      msg.includes('Failed to fetch')
    ) {
      stream.markdown(
        `**Could not reach Pawz** at \`${baseUrl}\`.\n\n` +
          'Make sure:\n' +
          '- Pawz Desktop is running\n' +
          '- The webhook server is enabled (Settings → Channels → Webhook)\n' +
          '- The URL in `pawz.webhookUrl` matches the configured port',
      );
      stream.button({
        command: 'pawz.openSettings',
        title: '$(gear) Check Settings',
      });
    } else {
      stream.markdown(`**Pawz error:** ${msg}`);
    }
  }
}

// ── Workspace context builder ──────────────────────────────────────────────

function buildWorkspaceContext(allowDangerousTools: boolean): string {
  const parts: string[] = [];

  // Workspace root — the agent uses this to resolve relative paths for tools
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    parts.push(`Workspace root: ${wsFolder.uri.fsPath}`);
  }

  // Active editor context
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const doc = editor.document;
    const rel = vscode.workspace.asRelativePath(doc.uri);
    const lang = doc.languageId;
    parts.push(`Active file: ${rel} (${lang})`);

    const sel = editor.selection;
    if (!sel.isEmpty) {
      const selectedText = doc.getText(sel);
      const lineRange = `${sel.start.line + 1}–${sel.end.line + 1}`;
      parts.push(
        `Selected code (lines ${lineRange}):\n\`\`\`${lang}\n${selectedText}\n\`\`\``,
      );
    }
  }

  // Tool access notice
  if (allowDangerousTools) {
    parts.push(
      'You have full access to the workspace via read_file, write_file, exec, ' +
        'list_directory, and other built-in tools. ' +
        'Use absolute paths or resolve relative paths against the workspace root above.',
    );
  }

  return parts.join('\n\n');
}

export function deactivate(): void {
  // nothing to clean up
}
