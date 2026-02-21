// ── Content Studio ─────────────────────────────────────────────────────────
import { listDocs, saveDoc, getDoc, deleteDoc } from '../db';
import { pawEngine } from '../engine';
import { $, escHtml } from '../components/helpers';
import { showToast } from '../components/toast';
import { appState } from '../state/index';

let _activeDocId: string | null = null;

export async function loadContentDocs() {
  const list = $('content-doc-list');
  const empty = $('content-empty');
  const toolbar = $('content-toolbar');
  const body = $('content-body') as HTMLTextAreaElement | null;
  const wordCount = $('content-word-count');
  if (!list) return;

  const docs = await listDocs();
  list.innerHTML = '';

  if (!docs.length && !_activeDocId) {
    if (empty) empty.style.display = 'flex';
    if (toolbar) toolbar.style.display = 'none';
    if (body) body.style.display = 'none';
    if (wordCount) wordCount.style.display = 'none';
    return;
  }

  for (const doc of docs) {
    const item = document.createElement('div');
    item.className = `studio-doc-item${doc.id === _activeDocId ? ' active' : ''}`;
    item.innerHTML = `
      <div class="studio-doc-title">${escHtml(doc.title || 'Untitled')}</div>
      <div class="studio-doc-meta">${doc.word_count} words · ${new Date(doc.updated_at).toLocaleDateString()}</div>
    `;
    item.addEventListener('click', () => openContentDoc(doc.id));
    list.appendChild(item);
  }
}

export async function openContentDoc(docId: string) {
  const doc = await getDoc(docId);
  if (!doc) return;
  _activeDocId = docId;

  const empty = $('content-empty');
  const toolbar = $('content-toolbar');
  const body = $('content-body') as HTMLTextAreaElement;
  const titleInput = $('content-title') as HTMLInputElement;
  const typeSelect = $('content-type') as HTMLSelectElement;
  const wordCount = $('content-word-count');

  if (empty) empty.style.display = 'none';
  if (toolbar) toolbar.style.display = 'flex';
  if (body) { body.style.display = ''; body.value = doc.content; }
  if (titleInput) titleInput.value = doc.title;
  if (typeSelect) typeSelect.value = doc.content_type;
  if (wordCount) {
    wordCount.style.display = '';
    wordCount.textContent = `${doc.word_count} words`;
  }
  loadContentDocs();
}

async function createNewDoc() {
  const id = crypto.randomUUID();
  await saveDoc({ id, title: 'Untitled document', content: '', content_type: 'markdown' });
  await openContentDoc(id);
}

export function initContent() {
  $('content-new-doc')?.addEventListener('click', createNewDoc);
  $('content-create-first')?.addEventListener('click', createNewDoc);

  $('content-save')?.addEventListener('click', async () => {
    if (!_activeDocId) return;
    const title = ($('content-title') as HTMLInputElement).value.trim() || 'Untitled';
    const content = ($('content-body') as HTMLTextAreaElement).value;
    const contentType = ($('content-type') as HTMLSelectElement).value;
    await saveDoc({ id: _activeDocId, title, content, content_type: contentType });
    const wordCount = $('content-word-count');
    if (wordCount) wordCount.textContent = `${content.split(/\s+/).filter(Boolean).length} words`;
    loadContentDocs();
  });

  $('content-body')?.addEventListener('input', () => {
    const body = $('content-body') as HTMLTextAreaElement;
    const wordCount = $('content-word-count');
    if (wordCount && body) {
      wordCount.textContent = `${body.value.split(/\s+/).filter(Boolean).length} words`;
    }
  });

  $('content-ai-improve')?.addEventListener('click', async () => {
    if (!_activeDocId || !appState.wsConnected) { showToast('Not connected', 'error'); return; }
    const bodyEl = $('content-body') as HTMLTextAreaElement;
    const body = bodyEl?.value.trim();
    if (!body) return;

    const btn = $('content-ai-improve') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    showToast('AI improving your text…', 'info');

    try {
      const result = await pawEngine.chatSend('paw-improve', `Improve this text. Return only the improved version, no explanations:\n\n${body}`);
      const text = (result as unknown as Record<string, unknown>).text as string | undefined;
      if (text && bodyEl) {
        bodyEl.value = text;
        showToast('Text improved!', 'success');
      } else {
        showToast('Agent returned no text', 'error');
      }
    } catch (e) {
      showToast(`Failed: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('content-delete-doc')?.addEventListener('click', async () => {
    if (!_activeDocId) return;
    if (!confirm('Delete this document?')) return;
    await deleteDoc(_activeDocId);
    _activeDocId = null;
    loadContentDocs();
  });
}
