/**
 * tool-renderer.ts — maps Pawz EngineEvents onto VS Code ChatResponseStream.
 *
 * For each event kind:
 *  - delta         → stream.markdown() — live text streaming
 *  - thinking_delta → stream.markdown() in italic (collapsed feel)
 *  - tool_request  → stream.progress() + capture pending write for diff
 *  - tool_result   → for write_file: show anchor + "Show diff" button
 *  - tool_auto_approved → stream.progress()
 *  - error         → stream.markdown() warning block
 *  - complete      → no-op (deltas already streamed)
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { PawzEvent } from './pawz-client';

interface PendingWrite {
  filePath: string;
  newContent: string;
  oldContent: string | null;
}

export class ToolRenderer {
  /** Map tool_call_id → pending write_file info for diff preview. */
  private pendingWrites = new Map<string, PendingWrite>();

  constructor(private readonly stream: vscode.ChatResponseStream) {}

  handleEvent(event: PawzEvent): void {
    switch (event.kind) {
      case 'delta':
        if (event.text) this.stream.markdown(event.text);
        break;

      case 'thinking_delta':
        // Show brief thinking indicator — VS Code doesn't have a native
        // "thinking" component so we use dim italic markdown.
        if (event.text) {
          const snippet = event.text.length > 100 ? event.text.slice(0, 100) + '…' : event.text;
          this.stream.markdown(`*${snippet}*`);
        }
        break;

      case 'tool_request':
        this.handleToolRequest(event);
        break;

      case 'tool_auto_approved':
        if (event.tool_name) {
          this.stream.progress(`Running ${event.tool_name}…`);
        }
        break;

      case 'tool_result':
        this.handleToolResult(event);
        break;

      case 'error':
        if (event.message) {
          this.stream.markdown(`\n\n> ⚠️ **${event.message}**\n\n`);
        }
        break;

      case 'complete':
      case 'canvas_push':
      case 'canvas_update':
        // complete: all deltas have been streamed — nothing extra needed.
        // canvas events are desktop-UI-specific, skip.
        break;
    }
  }

  // ── Tool request handling ──────────────────────────────────────────────

  private handleToolRequest(event: PawzEvent): void {
    if (!event.tool_call) return;
    const { id, function: fn } = event.tool_call;
    const name = fn.name;

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(fn.arguments) as Record<string, unknown>;
    } catch {
      /* ignore malformed args */
    }

    switch (name) {
      case 'read_file':
      case 'read_file_lines': {
        const p = String(args['path'] ?? args['file_path'] ?? '');
        this.stream.progress(`Reading ${path.basename(p) || p}`);
        break;
      }

      case 'write_file':
      case 'write_file_lines': {
        const filePath = String(args['path'] ?? args['file_path'] ?? '');
        const newContent = String(args['content'] ?? args['new_content'] ?? '');
        this.stream.progress(`Writing ${path.basename(filePath) || filePath}`);
        // Eagerly snapshot the current content so we can offer a diff later
        this.captureOldContent(id, filePath, newContent);
        break;
      }

      case 'exec':
      case 'execute_command':
      case 'run_command':
      case 'shell_exec': {
        const cmd = String(args['command'] ?? args['cmd'] ?? args['shell'] ?? '');
        const display = cmd.length > 70 ? cmd.slice(0, 67) + '…' : cmd;
        this.stream.progress(`$ ${display}`);
        break;
      }

      case 'search_files':
      case 'grep':
      case 'find_files': {
        const pattern = String(args['pattern'] ?? args['query'] ?? args['glob'] ?? '');
        this.stream.progress(`Searching: ${pattern}`);
        break;
      }

      case 'list_directory':
      case 'list_dir': {
        const dir = String(args['path'] ?? args['directory'] ?? '.');
        this.stream.progress(`Listing ${dir}`);
        break;
      }

      case 'memory_store':
        this.stream.progress('Saving memory…');
        break;

      case 'memory_search':
        this.stream.progress('Searching memory…');
        break;

      case 'fetch':
      case 'http_request': {
        const url = String(args['url'] ?? '');
        try {
          const host = new URL(url).host;
          this.stream.progress(`Fetching ${host}`);
        } catch {
          this.stream.progress(`Fetching ${url.slice(0, 50)}`);
        }
        break;
      }

      default:
        this.stream.progress(`Calling ${name}…`);
    }
  }

  // ── Tool result handling ───────────────────────────────────────────────

  private handleToolResult(event: PawzEvent): void {
    if (!event.tool_call_id) return;

    const pending = this.pendingWrites.get(event.tool_call_id);
    if (!pending) return;

    this.pendingWrites.delete(event.tool_call_id);

    if (!event.success) return; // write failed — nothing to show

    const rel = vscode.workspace.asRelativePath(pending.filePath);

    // File anchor (clickable link in chat)
    try {
      this.stream.anchor(vscode.Uri.file(pending.filePath), rel);
    } catch {
      this.stream.markdown(`\`${rel}\``);
    }

    // Show diff button only when there's a meaningful change
    const hasChange =
      pending.oldContent !== null && pending.oldContent !== pending.newContent;
    if (hasChange) {
      this.stream.button({
        command: 'pawz.showDiff',
        title: '$(diff) Show diff',
        arguments: [pending.filePath, pending.oldContent ?? '', pending.newContent],
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Resolve path (relative → absolute) and snapshot current file content. */
  private captureOldContent(
    toolCallId: string,
    filePath: string,
    newContent: string,
  ): void {
    let absPath = filePath;
    if (!path.isAbsolute(filePath)) {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (wsRoot) absPath = path.join(wsRoot, filePath);
    }

    vscode.workspace.openTextDocument(vscode.Uri.file(absPath)).then(
      (doc: vscode.TextDocument) => {
        this.pendingWrites.set(toolCallId, {
          filePath: absPath,
          newContent,
          oldContent: doc.getText(),
        });
      },
      () => {
        // File doesn't exist yet — new file being created
        this.pendingWrites.set(toolCallId, {
          filePath: absPath,
          newContent,
          oldContent: null,
        });
      },
    );
  }
}
