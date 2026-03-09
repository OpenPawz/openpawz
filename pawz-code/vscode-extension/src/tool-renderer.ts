/**
 * tool-renderer.ts — maps pawz-code EngineEvents onto VS Code ChatResponseStream.
 * Identical behaviour to the main Pawz extension — progress spinners, diff anchors.
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
  private pendingWrites = new Map<string, PendingWrite>();

  constructor(private readonly stream: vscode.ChatResponseStream) {}

  handleEvent(event: PawzEvent): void {
    switch (event.kind) {
      case 'delta':
        if (event.text) this.stream.markdown(event.text);
        break;

      case 'thinking_delta':
        if (event.text) {
          const s = event.text.length > 100 ? event.text.slice(0, 100) + '…' : event.text;
          this.stream.markdown(`*${s}*`);
        }
        break;

      case 'tool_request':
        this.handleToolRequest(event);
        break;

      case 'tool_auto_approved':
        if (event.tool_name) this.stream.progress(`Running ${event.tool_name}…`);
        break;

      case 'tool_result':
        this.handleToolResult(event);
        break;

      case 'error':
        if (event.message) this.stream.markdown(`\n\n> ⚠️ **${event.message}**\n\n`);
        break;

      case 'complete':
      case 'canvas_push':
      case 'canvas_update':
        break;
    }
  }

  private handleToolRequest(event: PawzEvent): void {
    if (!event.tool_call) return;
    const { id, function: fn } = event.tool_call;
    const name = fn.name;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(fn.arguments) as Record<string, unknown>; } catch { /* skip */ }

    switch (name) {
      case 'read_file':
        this.stream.progress(`Reading ${path.basename(String(args['path'] ?? ''))}`);
        break;
      case 'write_file': {
        const fp = String(args['path'] ?? '');
        const nc = String(args['content'] ?? '');
        this.stream.progress(`Writing ${path.basename(fp)}`);
        this.captureOldContent(id, fp, nc);
        break;
      }
      case 'exec': {
        const cmd = String(args['command'] ?? '');
        this.stream.progress(`$ ${cmd.length > 70 ? cmd.slice(0, 67) + '…' : cmd}`);
        break;
      }
      case 'grep':
        this.stream.progress(`Searching: ${String(args['pattern'] ?? '')}`);
        break;
      case 'list_directory':
        this.stream.progress(`Listing ${String(args['path'] ?? '.')}`);
        break;
      case 'remember':
        this.stream.progress('Saving memory…');
        break;
      case 'recall':
        this.stream.progress('Searching memory…');
        break;
      case 'fetch': {
        try {
          const host = new URL(String(args['url'] ?? '')).host;
          this.stream.progress(`Fetching ${host}`);
        } catch {
          this.stream.progress(`Fetching…`);
        }
        break;
      }
      default:
        this.stream.progress(`Calling ${name}…`);
    }
  }

  private handleToolResult(event: PawzEvent): void {
    if (!event.tool_call_id) return;
    const pending = this.pendingWrites.get(event.tool_call_id);
    if (!pending) return;
    this.pendingWrites.delete(event.tool_call_id);
    if (!event.success) return;

    const rel = vscode.workspace.asRelativePath(pending.filePath);
    try {
      this.stream.anchor(vscode.Uri.file(pending.filePath), rel);
    } catch {
      this.stream.markdown(`\`${rel}\``);
    }

    if (pending.oldContent !== null && pending.oldContent !== pending.newContent) {
      this.stream.button({
        command: 'pawz-code.showDiff',
        title: '$(diff) Show diff',
        arguments: [pending.filePath, pending.oldContent ?? '', pending.newContent],
      });
    }
  }

  private captureOldContent(toolCallId: string, filePath: string, newContent: string): void {
    let absPath = filePath;
    if (!path.isAbsolute(filePath)) {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (wsRoot) absPath = path.join(wsRoot, filePath);
    }
    vscode.workspace.openTextDocument(vscode.Uri.file(absPath)).then(
      (doc) => {
        this.pendingWrites.set(toolCallId, { filePath: absPath, newContent, oldContent: doc.getText() });
      },
      () => {
        this.pendingWrites.set(toolCallId, { filePath: absPath, newContent, oldContent: null });
      },
    );
  }
}
