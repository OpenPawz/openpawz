#!/usr/bin/env node
/**
 * generate-credential-data.mjs
 *
 * Reads extracted credential schemas (credential-schemas.json) and the
 * catalog source to produce src/views/integrations/credential-data.ts,
 * a static lookup from n8n node type → {credentialFields, setupGuide}.
 *
 * The svc() helper in catalog.ts uses this lookup to provide real credential
 * fields instead of the generic "paste your API key" fallback.
 *
 * Usage:
 *   node scripts/generate-credential-data.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SCHEMAS_PATH = join(import.meta.dirname, 'credential-schemas.json');
const CATALOG_PATH = join(ROOT, 'src/views/integrations/catalog.ts');
const OUTPUT_PATH = join(ROOT, 'src/views/integrations/credential-data.ts');

// ── Manual aliases for node types that don't match by name ─────────────

const ALIASES = {
  'n8n-nodes-base.awsLambda': 'n8n-nodes-base.aws',
  'n8n-nodes-base.awsSes': 'n8n-nodes-base.aws',
  'n8n-nodes-base.awsSns': 'n8n-nodes-base.aws',
  'n8n-nodes-base.awsDynamoDB': 'n8n-nodes-base.aws',
  'n8n-nodes-base.awsSqs': 'n8n-nodes-base.aws',
};

// Node types that don't need credentials (utility/trigger nodes)
const SKIP_TYPES = new Set([
  'n8n-nodes-base.rssFeedRead',
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.cron',
  'n8n-nodes-base.code',
  'n8n-nodes-base.xml',
  'n8n-nodes-base.html',
  'n8n-nodes-base.graphQL',
  'n8n-nodes-base.spreadsheetFile',
  'n8n-nodes-base.compression',
  'n8n-nodes-base.markdown',
  'n8n-nodes-base.wait',
  'n8n-nodes-base.switch',
  'n8n-nodes-base.merge',
  'n8n-nodes-base.set',
  'n8n-nodes-base.filter',
  'n8n-nodes-base.dateTime',
  'n8n-nodes-base.errorTrigger',
  'n8n-nodes-base.httpRequest',
]);

// Curated services that already have hand-written credential configs.
// Don't overwrite those — they've been manually verified.
const CURATED_IDS = new Set([
  'slack', 'discord', 'github', 'notion', 'trello', 'linear',
  'telegram', 'microsoft-teams', 'twilio', 'sendgrid', 'mailchimp',
  'intercom', 'mattermost', 'airtable',
]);

// ── n8n property → CredentialField mapper ──────────────────────────────

function toCredentialField(prop) {
  let type = 'text';
  const nameLower = (prop.name || '').toLowerCase();

  if (prop.isPassword) {
    type = 'password';
  } else if (nameLower.includes('secret') || nameLower.includes('password') ||
             nameLower.includes('token') || (nameLower.includes('key') && nameLower !== 'webhookkey')) {
    type = 'password';
  } else if (nameLower.includes('url') || nameLower.includes('baseurl') || nameLower === 'domain') {
    type = 'url';
  } else if (prop.type === 'options') {
    type = 'select';
  } else if (prop.type === 'boolean') {
    return null; // Skip booleans — advanced options
  }

  if (!prop.name || prop.name === 'notice') return null;

  const field = {
    key: prop.name,
    label: prop.displayName || prop.name,
    type,
    required: prop.required ?? false,
  };

  if (prop.placeholder) {
    // Strip n8n references from example URLs
    let ph = prop.placeholder.replace(/n8n\./g, 'my.').replace(/\.n8n\./g, '.my.');
    ph = ph.replace(/appname=n8n/g, 'appname=openpawz');
    field.placeholder = ph;
  }

  if (prop.description) {
    let ht = prop.description.replace(/<[^>]+>/g, '').trim();
    // Remove n8n-specific references
    ht = ht.replace(/n8n/gi, 'OpenPawz');
    if (ht.length > 120) ht = ht.slice(0, 117) + '...';
    if (ht.length > 0) field.helpText = ht;
  }

  // Generate sensible placeholder if missing
  if (!field.placeholder) {
    if (type === 'password' && nameLower.includes('token')) {
      field.placeholder = 'Paste your access token';
    } else if (type === 'password' && nameLower.includes('key')) {
      field.placeholder = 'Paste your API key';
    } else if (type === 'password' && nameLower.includes('secret')) {
      field.placeholder = 'Paste your secret';
    } else if (type === 'password') {
      field.placeholder = `Enter ${field.label.toLowerCase()}`;
    } else if (type === 'url' && prop.default) {
      field.placeholder = prop.default;
    }
  }

  return field;
}

function generateSetupGuide(serviceName, cred) {
  const steps = [];

  if (cred.authType === 'oauth2') {
    steps.push({ instruction: `Log into your ${serviceName} account and go to the developer console or API settings.` });
    steps.push({ instruction: 'Create a new OAuth application or API integration.' });
    steps.push({ instruction: 'Copy the Client ID and Client Secret into the fields below.' });
    steps.push({ instruction: 'Click "Test & Save" to authorize the connection.' });
    return { title: `Connect ${serviceName}`, steps, estimatedTime: '3-5 minutes' };
  }

  if (cred.authType === 'basic') {
    steps.push({ instruction: `Enter your ${serviceName} username and password below.` });
    steps.push({ instruction: 'Click "Test & Save" to verify the connection.' });
    return { title: `Connect ${serviceName}`, steps, estimatedTime: '1 minute' };
  }

  steps.push({ instruction: `Log into your ${serviceName} account.` });

  const fieldNames = cred.fields
    .filter(f => f.name !== 'notice' && f.type !== 'notice' && f.type !== 'hidden')
    .map(f => f.displayName || f.name);

  if (fieldNames.length === 1) {
    const fn = fieldNames[0];
    steps.push({ instruction: `Navigate to Settings → API and generate ${/^[aeiou]/i.test(fn) ? 'an' : 'a'} ${fn}.` });
    steps.push({ instruction: `Copy the ${fn} and paste it below.` });
  } else if (fieldNames.length > 0) {
    steps.push({ instruction: 'Navigate to Settings → API or Developer section.' });
    steps.push({ instruction: `Locate or generate the following: ${fieldNames.join(', ')}.` });
    steps.push({ instruction: 'Copy each value into the matching field below.' });
  }

  steps.push({ instruction: 'Click "Test & Save" to verify the connection.' });

  return {
    title: `Connect ${serviceName}`,
    steps,
    estimatedTime: fieldNames.length > 2 ? '3-5 minutes' : '2-3 minutes',
  };
}

function esc(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Credential Data Generator ===\n');

  const schemas = JSON.parse(await readFile(SCHEMAS_PATH, 'utf-8'));
  const catalogSrc = await readFile(CATALOG_PATH, 'utf-8');

  // Extract all node types used in catalog (and their service names)
  const entries = [];
  const svcRegex = /svc\(\s*\n\s*'([^']+)',\s*\n\s*'([^']+)',[\s\S]*?'(n8n-nodes-base\.[^']+)'/g;
  let m;
  while ((m = svcRegex.exec(catalogSrc)) !== null) {
    entries.push({ id: m[1], name: m[2], nodeType: m[3] });
  }

  console.log(`Found ${entries.length} catalog entries`);

  // Build the lookup
  const lookup = new Map();
  let matched = 0;
  let oauthOnly = 0;
  let skipped = 0;

  for (const entry of entries) {
    const { id, name, nodeType } = entry;

    if (SKIP_TYPES.has(nodeType)) { skipped++; continue; }
    if (CURATED_IDS.has(id)) { skipped++; continue; }

    // Resolve schema
    let credKey = ALIASES[nodeType] || nodeType;
    let credInfo = schemas[credKey];
    if (!credInfo) {
      const lowerKey = credKey.toLowerCase();
      const found = Object.keys(schemas).find(k => k.toLowerCase() === lowerKey);
      if (found) credInfo = schemas[found];
    }
    if (!credInfo) continue;

    const preferred = credInfo.credentials.find(c => c.name === credInfo.preferredCredential);
    if (!preferred) continue;

    // Convert fields
    let fields = preferred.fields.map(toCredentialField).filter(Boolean);

    // For pure OAuth2 with no visible fields, provide client ID/secret
    if (fields.length === 0 && preferred.authType === 'oauth2') {
      fields = [
        { key: 'clientId', label: 'Client ID', type: 'password', placeholder: 'Paste your Client ID', required: true },
        { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Paste your Client Secret', required: true },
      ];
    }

    if (fields.length === 0) continue;

    const guide = generateSetupGuide(name, preferred);

    if (preferred.authType === 'oauth2') oauthOnly++;
    matched++;

    lookup.set(nodeType, { fields, guide, authType: preferred.authType });
  }

  console.log(`Matched: ${matched}`);
  console.log(`  OAuth2: ${oauthOnly}`);
  console.log(`  Skipped (curated/utility): ${skipped}`);
  console.log(`  Unmatched: ${entries.length - matched - skipped}`);

  // Generate TypeScript source
  const lines = [
    '// src/views/integrations/credential-data.ts',
    '// AUTO-GENERATED by scripts/generate-credential-data.mjs',
    '// DO NOT EDIT — re-run the generator to update.',
    '//',
    '// Source: n8n-io/n8n (MIT license) credential type definitions.',
    '',
    "import type { CredentialField, SetupGuide } from './atoms';",
    '',
    'interface CredentialOverride {',
    '  fields: CredentialField[];',
    '  guide: SetupGuide;',
    '}',
    '',
    '/** Node-type → real credential fields & setup guide. */',
    'export const CREDENTIAL_OVERRIDES: Record<string, CredentialOverride> = {',
  ];

  for (const [nodeType, data] of lookup) {
    lines.push(`  '${esc(nodeType)}': {`);

    // Fields
    lines.push('    fields: [');
    for (const f of data.fields) {
      lines.push('      {');
      lines.push(`        key: '${esc(f.key)}',`);
      lines.push(`        label: '${esc(f.label)}',`);
      lines.push(`        type: '${f.type}',`);
      if (f.placeholder) lines.push(`        placeholder: '${esc(f.placeholder)}',`);
      lines.push(`        required: ${f.required},`);
      if (f.helpText) lines.push(`        helpText: '${esc(f.helpText)}',`);
      lines.push('      },');
    }
    lines.push('    ],');

    // Guide
    lines.push('    guide: {');
    lines.push(`      title: '${esc(data.guide.title)}',`);
    lines.push('      steps: [');
    for (const step of data.guide.steps) {
      if (step.link) {
        lines.push(`        { instruction: '${esc(step.instruction)}', link: '${esc(step.link)}' },`);
      } else {
        lines.push(`        { instruction: '${esc(step.instruction)}' },`);
      }
    }
    lines.push('      ],');
    lines.push(`      estimatedTime: '${esc(data.guide.estimatedTime)}',`);
    lines.push('    },');

    lines.push('  },');
  }

  lines.push('};');
  lines.push('');

  const output = lines.join('\n');
  await writeFile(OUTPUT_PATH, output, 'utf-8');
  console.log(`\nWritten ${output.length} bytes to ${OUTPUT_PATH}`);
  console.log(`${lookup.size} credential overrides generated`);
}

main().catch(console.error);
