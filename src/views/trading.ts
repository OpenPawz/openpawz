// Trading Dashboard — Portfolio, P&L, Trade History, Auto-Trade Policy
// Visual representation of Coinbase trading activity and automated guidelines.

import { pawEngine, type TradeRecord, type TradingSummary, type TradingPolicy } from '../engine';

const $ = (id: string) => document.getElementById(id);

// ── Module state ───────────────────────────────────────────────────────────
let wsConnected = false;

export function setWsConnected(connected: boolean) {
  wsConnected = connected;
  // Wire refresh button
  const refreshBtn = $('trading-refresh');
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = '1';
    refreshBtn.addEventListener('click', () => loadTrading());
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatUsd(value: number | string | null): string {
  if (value === null || value === undefined) return '$0.00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  return num < 0 ? `-$${Math.abs(num).toFixed(2)}` : `$${num.toFixed(2)}`;
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr + (isoStr.includes('Z') ? '' : 'Z'));
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

function pnlClass(value: number): string {
  if (value > 0) return 'trading-positive';
  if (value < 0) return 'trading-negative';
  return 'trading-neutral';
}

// ── Main Loader ────────────────────────────────────────────────────────────
export async function loadTrading() {
  if (!wsConnected) return;

  const container = $('trading-content');
  if (!container) return;

  try {
    const [trades, summary, policy] = await Promise.all([
      pawEngine.tradingHistory(50),
      pawEngine.tradingSummary(),
      pawEngine.tradingPolicyGet(),
    ]);

    renderDashboard(container, trades, summary, policy);
  } catch (err) {
    container.innerHTML = `<div class="trading-error">Failed to load trading data: ${escHtml(String(err))}</div>`;
  }
}

// ── Render Dashboard ───────────────────────────────────────────────────────
function renderDashboard(
  container: HTMLElement,
  trades: TradeRecord[],
  summary: TradingSummary,
  policy: TradingPolicy,
) {
  const totalTrades = summary.trade_count + summary.transfer_count;

  container.innerHTML = `
    <!-- Summary Cards -->
    <div class="trading-cards">
      <div class="trading-card">
        <div class="trading-card-label">Today's P&L</div>
        <div class="trading-card-value ${pnlClass(summary.net_pnl_usd)}">
          ${formatUsd(summary.net_pnl_usd)}
        </div>
      </div>
      <div class="trading-card">
        <div class="trading-card-label">Bought Today</div>
        <div class="trading-card-value">${formatUsd(summary.buy_total_usd)}</div>
      </div>
      <div class="trading-card">
        <div class="trading-card-label">Sold Today</div>
        <div class="trading-card-value">${formatUsd(summary.sell_total_usd)}</div>
      </div>
      <div class="trading-card">
        <div class="trading-card-label">Transfers Today</div>
        <div class="trading-card-value">${formatUsd(summary.transfer_total_usd)}</div>
      </div>
      <div class="trading-card">
        <div class="trading-card-label">Trades Today</div>
        <div class="trading-card-value">${totalTrades}</div>
      </div>
      <div class="trading-card">
        <div class="trading-card-label">Daily Spent</div>
        <div class="trading-card-value">${formatUsd(summary.daily_spent_usd)} / ${formatUsd(policy.max_daily_loss_usd)}</div>
        <div class="trading-card-bar">
          <div class="trading-card-bar-fill ${summary.daily_spent_usd > policy.max_daily_loss_usd * 0.8 ? 'warn' : ''}"
               style="width: ${Math.min(100, (summary.daily_spent_usd / Math.max(1, policy.max_daily_loss_usd)) * 100)}%"></div>
        </div>
      </div>
    </div>

    <!-- Auto-Trade Policy -->
    <div class="trading-section">
      <div class="trading-section-header">
        <h3>Auto-Trade Policy</h3>
        <div class="trading-policy-toggle">
          <label class="trading-toggle-label">
            <input type="checkbox" id="trading-auto-approve" ${policy.auto_approve ? 'checked' : ''}>
            <span>Auto-approve trades within guidelines</span>
          </label>
        </div>
      </div>
      <div class="trading-policy-grid" id="trading-policy-fields" style="${policy.auto_approve ? '' : 'opacity: 0.5; pointer-events: none;'}">
        <div class="trading-policy-field">
          <label>Max Trade (USD)</label>
          <input type="number" id="trading-max-trade" value="${policy.max_trade_usd}" min="0" step="10">
        </div>
        <div class="trading-policy-field">
          <label>Max Daily Spend (USD)</label>
          <input type="number" id="trading-max-daily" value="${policy.max_daily_loss_usd}" min="0" step="50">
        </div>
        <div class="trading-policy-field">
          <label>Allowed Pairs</label>
          <input type="text" id="trading-allowed-pairs" value="${escHtml(policy.allowed_pairs.join(', '))}" placeholder="BTC-USD, ETH-USD (empty = all)">
        </div>
        <div class="trading-policy-field">
          <label class="trading-toggle-label">
            <input type="checkbox" id="trading-allow-transfers" ${policy.allow_transfers ? 'checked' : ''}>
            <span>Allow auto-approve transfers</span>
          </label>
        </div>
        <div class="trading-policy-field">
          <label>Max Transfer (USD)</label>
          <input type="number" id="trading-max-transfer" value="${policy.max_transfer_usd}" min="0" step="10">
        </div>
        <div class="trading-policy-field trading-policy-actions">
          <button class="btn-primary" id="trading-save-policy">Save Policy</button>
        </div>
      </div>
    </div>

    <!-- Trade History -->
    <div class="trading-section">
      <h3>Trade History</h3>
      ${trades.length === 0
        ? '<div class="trading-empty">No trades recorded yet. Your agents\' Coinbase trades will appear here.</div>'
        : `<div class="trading-table-wrap">
            <table class="trading-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Side</th>
                  <th>Pair / Currency</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                ${trades.map(t => `
                  <tr class="trading-row ${t.trade_type}">
                    <td class="trading-time">${formatTime(t.created_at)}</td>
                    <td><span class="trading-badge ${t.trade_type}">${t.trade_type}</span></td>
                    <td class="${t.side === 'buy' ? 'trading-positive' : t.side === 'sell' ? 'trading-negative' : ''}">${escHtml(t.side || '-')}</td>
                    <td>${escHtml(t.product_id || t.currency || '-')}</td>
                    <td>${escHtml(t.amount)}${t.usd_value ? ` <span class="trading-usd">(${formatUsd(t.usd_value)})</span>` : ''}</td>
                    <td><span class="trading-status ${t.status}">${escHtml(t.status)}</span></td>
                    <td class="trading-reason">${escHtml(t.reason || '-')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`
      }
    </div>
  `;

  // Wire up event listeners
  bindPolicyEvents();
}

// ── Policy Form Events ─────────────────────────────────────────────────────
function bindPolicyEvents() {
  const autoApprove = $('trading-auto-approve') as HTMLInputElement | null;
  const fields = $('trading-policy-fields');
  const saveBtn = $('trading-save-policy');

  if (autoApprove && fields) {
    autoApprove.addEventListener('change', () => {
      fields.style.opacity = autoApprove.checked ? '1' : '0.5';
      fields.style.pointerEvents = autoApprove.checked ? '' : 'none';
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const maxTrade = parseFloat(($('trading-max-trade') as HTMLInputElement)?.value || '100');
      const maxDaily = parseFloat(($('trading-max-daily') as HTMLInputElement)?.value || '500');
      const pairsRaw = ($('trading-allowed-pairs') as HTMLInputElement)?.value || '';
      const allowTransfers = ($('trading-allow-transfers') as HTMLInputElement)?.checked || false;
      const maxTransfer = parseFloat(($('trading-max-transfer') as HTMLInputElement)?.value || '0');
      const autoApproveChecked = ($('trading-auto-approve') as HTMLInputElement)?.checked || false;

      const pairs = pairsRaw.split(',').map(s => s.trim()).filter(Boolean);

      const policy: TradingPolicy = {
        auto_approve: autoApproveChecked,
        max_trade_usd: maxTrade,
        max_daily_loss_usd: maxDaily,
        allowed_pairs: pairs,
        allow_transfers: allowTransfers,
        max_transfer_usd: maxTransfer,
      };

      try {
        await pawEngine.tradingPolicySet(policy);
        showTradingToast('Trading policy saved', 'success');
      } catch (err) {
        showTradingToast(`Failed to save policy: ${err}`, 'error');
      }
    });
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────
let _tradingToastTimer: number | null = null;
function showTradingToast(message: string, type: 'success' | 'error' | 'info') {
  const toast = $('trading-toast');
  if (!toast) return;
  toast.className = `trading-toast ${type}`;
  toast.textContent = message;
  toast.style.display = 'flex';

  if (_tradingToastTimer) clearTimeout(_tradingToastTimer);
  _tradingToastTimer = window.setTimeout(() => {
    toast.style.display = 'none';
    _tradingToastTimer = null;
  }, type === 'error' ? 8000 : 4000);
}
