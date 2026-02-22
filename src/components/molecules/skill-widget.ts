// Skill Widget — Dashboard card renderer for skill output data (Phase F.2)
// Renders 5 widget types: status, metric, table, log, kv
// Field types: text, number, badge, datetime, percentage, currency

import { escHtml } from '../../components/helpers';
import type { SkillOutput } from '../../engine/atoms/types';

// ── Types ─────────────────────────────────────────────────────────────

interface StatusData {
  icon?: string;
  text?: string;
  badge?: string;
  badge_color?: string;
}

interface MetricData {
  value?: string | number;
  unit?: string;
  change?: string | number;
  trend?: 'up' | 'down' | 'flat';
  label?: string;
}

interface TableData {
  columns?: string[];
  rows?: (string | number)[][];
}

interface LogEntry {
  time?: string;
  text?: string;
  level?: 'info' | 'warn' | 'error' | 'success';
}

interface LogData {
  entries?: LogEntry[];
}

interface KvPair {
  key: string;
  value: string | number;
  type?: string;
}

interface KvData {
  pairs?: KvPair[];
}

// ── Render helpers ────────────────────────────────────────────────────

function formatFieldValue(value: string | number, fieldType?: string): string {
  const raw = String(value);
  switch (fieldType) {
    case 'currency':
      return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'percentage':
      return `${Number(value).toFixed(1)}%`;
    case 'number':
      return Number(value).toLocaleString('en-US');
    case 'datetime':
      try {
        return new Date(raw).toLocaleString();
      } catch {
        return raw;
      }
    case 'badge':
      return `<span class="skill-widget-badge">${escHtml(raw)}</span>`;
    default:
      return escHtml(raw);
  }
}

function trendIcon(trend?: string): string {
  if (trend === 'up') return '<span class="ms ms-sm skill-widget-trend-up">trending_up</span>';
  if (trend === 'down')
    return '<span class="ms ms-sm skill-widget-trend-down">trending_down</span>';
  return '<span class="ms ms-sm skill-widget-trend-flat">trending_flat</span>';
}

function logLevelClass(level?: string): string {
  if (level === 'error') return 'skill-widget-log-error';
  if (level === 'warn') return 'skill-widget-log-warn';
  if (level === 'success') return 'skill-widget-log-success';
  return 'skill-widget-log-info';
}

// ── Status widget ─────────────────────────────────────────────────────

function renderStatusWidget(data: StatusData): string {
  const icon = data.icon ?? 'info';
  const text = data.text ?? '';
  const badge = data.badge
    ? `<span class="skill-widget-badge" style="${data.badge_color ? `background:${data.badge_color}` : ''}">${escHtml(data.badge)}</span>`
    : '';

  return `
    <div class="skill-widget-status">
      <span class="ms">${escHtml(icon)}</span>
      <span class="skill-widget-status-text">${escHtml(text)}</span>
      ${badge}
    </div>
  `;
}

// ── Metric widget ─────────────────────────────────────────────────────

function renderMetricWidget(data: MetricData): string {
  const value = data.value ?? '--';
  const unit = data.unit ?? '';
  const label = data.label ?? '';
  const change = data.change != null ? String(data.change) : '';
  const trend = trendIcon(data.trend);

  return `
    <div class="skill-widget-metric">
      <div class="skill-widget-metric-value">
        ${escHtml(String(value))}${unit ? `<span class="skill-widget-metric-unit">${escHtml(unit)}</span>` : ''}
      </div>
      ${label ? `<div class="skill-widget-metric-label">${escHtml(label)}</div>` : ''}
      ${change ? `<div class="skill-widget-metric-change">${trend} ${escHtml(change)}</div>` : ''}
    </div>
  `;
}

// ── Table widget ──────────────────────────────────────────────────────

function renderTableWidget(data: TableData): string {
  const columns = data.columns ?? [];
  const rows = data.rows ?? [];

  if (columns.length === 0 && rows.length === 0) {
    return '<div class="skill-widget-empty">No data</div>';
  }

  const header = columns.length
    ? `<thead><tr>${columns.map((c) => `<th>${escHtml(String(c))}</th>`).join('')}</tr></thead>`
    : '';

  const body = rows
    .slice(0, 20)
    .map(
      (row) =>
        `<tr>${(row as (string | number)[]).map((cell) => `<td>${escHtml(String(cell))}</td>`).join('')}</tr>`,
    )
    .join('');

  return `
    <div class="skill-widget-table-wrap">
      <table class="skill-widget-table">
        ${header}
        <tbody>${body}</tbody>
      </table>
      ${rows.length > 20 ? `<div class="skill-widget-table-more">+${rows.length - 20} more rows</div>` : ''}
    </div>
  `;
}

// ── Log widget ────────────────────────────────────────────────────────

function renderLogWidget(data: LogData): string {
  const entries = data.entries ?? [];

  if (entries.length === 0) {
    return '<div class="skill-widget-empty">No log entries</div>';
  }

  return `
    <div class="skill-widget-log">
      ${entries
        .slice(0, 50)
        .map(
          (entry) => `
        <div class="skill-widget-log-entry ${logLevelClass(entry.level)}">
          ${entry.time ? `<span class="skill-widget-log-time">${escHtml(entry.time)}</span>` : ''}
          <span class="skill-widget-log-text">${escHtml(entry.text ?? '')}</span>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

// ── KV widget ─────────────────────────────────────────────────────────

function renderKvWidget(data: KvData): string {
  const pairs = data.pairs ?? [];

  if (pairs.length === 0) {
    return '<div class="skill-widget-empty">No data</div>';
  }

  return `
    <div class="skill-widget-kv">
      ${pairs
        .map(
          (p) => `
        <div class="skill-widget-kv-row">
          <span class="skill-widget-kv-key">${escHtml(p.key)}</span>
          <span class="skill-widget-kv-value">${formatFieldValue(p.value, p.type)}</span>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

// ── Public API ────────────────────────────────────────────────────────

/** Widget type → Material Symbol icon mapping */
const WIDGET_ICONS: Record<string, string> = {
  status: 'monitor_heart',
  metric: 'speed',
  table: 'table_chart',
  log: 'terminal',
  kv: 'data_object',
};

/** Render a single skill output as a dashboard card. */
export function renderSkillWidgetCard(output: SkillOutput): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output.data);
  } catch {
    parsed = {};
  }

  let body: string;
  switch (output.widget_type) {
    case 'status':
      body = renderStatusWidget(parsed as unknown as StatusData);
      break;
    case 'metric':
      body = renderMetricWidget(parsed as unknown as MetricData);
      break;
    case 'table':
      body = renderTableWidget(parsed as unknown as TableData);
      break;
    case 'log':
      body = renderLogWidget(parsed as unknown as LogData);
      break;
    case 'kv':
      body = renderKvWidget(parsed as unknown as KvData);
      break;
    default:
      body = `<div class="skill-widget-empty">Unknown widget type: ${escHtml(output.widget_type)}</div>`;
  }

  const icon = WIDGET_ICONS[output.widget_type] ?? 'widgets';
  const updated = new Date(output.updated_at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `
    <div class="today-card skill-widget-card" data-skill-output-id="${escHtml(output.id)}">
      <div class="today-card-header">
        <span class="today-card-icon"><span class="ms">${icon}</span></span>
        <span class="today-card-title">${escHtml(output.title)}</span>
        <span class="skill-widget-updated">${updated}</span>
      </div>
      <div class="today-card-body">
        ${body}
      </div>
    </div>
  `;
}

/** Render all skill output widgets as HTML. Returns empty string if none. */
export function renderSkillWidgets(outputs: SkillOutput[]): string {
  if (outputs.length === 0) return '';
  return outputs.map(renderSkillWidgetCard).join('');
}
