#!/usr/bin/env node
/**
 * extract-n8n-credentials.mjs
 *
 * Parses credential and node files from the n8n open-source repo
 * (MIT-licensed) to build a mapping of node types → credential schemas.
 *
 * Input:  Sparse checkout of n8n repo at /tmp/n8n-creds/
 * Output: scripts/credential-schemas.json
 *
 * Usage:
 *   node scripts/extract-n8n-credentials.mjs
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const CREDS_DIR = '/tmp/n8n-creds/packages/nodes-base/credentials';
const NODES_DIR = '/tmp/n8n-creds/packages/nodes-base/nodes';
const OUTPUT = join(import.meta.dirname, 'credential-schemas.json');

// ── Step 1: Parse all credential files ─────────────────────────────────

/**
 * Extract credential type metadata from a .credentials.ts file.
 * Uses regex-based parsing (not a full TS parser) since the files follow
 * a consistent structure.
 */
function parseCredentialFile(source, filename) {
  const result = {
    filename,
    name: null,        // e.g. 'slackApi'
    displayName: null,  // e.g. 'Slack API'
    extends: [],        // inherited credential types
    authType: 'apiKey', // 'apiKey' | 'oauth2' | 'basic' | 'header' | 'other'
    properties: [],     // user-facing fields
    hasTest: false,
    hasAuthenticate: false,
  };

  // Extract name
  const nameMatch = source.match(/name\s*=\s*['"]([^'"]+)['"]/);
  if (nameMatch) result.name = nameMatch[1];

  // Extract displayName
  const displayMatch = source.match(/displayName\s*=\s*['"]([^'"]+)['"]/);
  if (displayMatch) result.displayName = displayMatch[1];

  // Extract extends
  const extendsMatch = source.match(/extends\s*=\s*\[([^\]]+)\]/);
  if (extendsMatch) {
    result.extends = extendsMatch[1]
      .match(/['"]([^'"]+)['"]/g)
      ?.map((s) => s.replace(/['"]/g, '')) ?? [];
  }

  // Detect auth type from name, extends, or content
  const nameLower = (result.name || '').toLowerCase();
  if (nameLower.includes('oauth2') || result.extends.some((e) => e.toLowerCase().includes('oauth2'))) {
    result.authType = 'oauth2';
  } else if (nameLower.includes('oauth')) {
    result.authType = 'oauth2';
  } else if (nameLower.includes('basicauth') || nameLower === 'httpbasicauth') {
    result.authType = 'basic';
  } else if (nameLower.includes('headerauth') || nameLower === 'httpheaderauth') {
    result.authType = 'header';
  }

  // Check for test and authenticate blocks
  result.hasTest = /test\s*[:=]\s*\{/.test(source) || /test\s*[:=]\s*ICredentialTestRequest/.test(source);
  result.hasAuthenticate = /authenticate\s*[:=]/.test(source);

  // Extract properties (the tricky part - regex parse the properties array)
  const propsMatch = source.match(/properties\s*[:=]\s*(?:INodeProperties\[\]\s*=\s*)?\[/);
  if (propsMatch) {
    const startIdx = propsMatch.index + propsMatch[0].length;
    const props = extractBalancedArray(source, startIdx);
    if (props) {
      result.properties = parsePropertyObjects(props);
    }
  }

  return result;
}

/**
 * Extract content within balanced brackets starting from startIdx.
 * The opening bracket has already been consumed.
 */
function extractBalancedArray(source, startIdx) {
  let depth = 1;
  let i = startIdx;
  while (i < source.length && depth > 0) {
    if (source[i] === '[' || source[i] === '{') depth++;
    else if (source[i] === ']' || source[i] === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  return source.slice(startIdx, i);
}

/**
 * Parse property objects from the inner content of the properties array.
 * Each property is a {...} object.
 */
function parsePropertyObjects(propsContent) {
  const properties = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < propsContent.length; i++) {
    if (propsContent[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (propsContent[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const objStr = propsContent.slice(start, i + 1);
        const prop = parsePropertyObject(objStr);
        if (prop) properties.push(prop);
        start = -1;
      }
    }
  }

  return properties;
}

/**
 * Parse a single property object string into a structured representation.
 */
function parsePropertyObject(objStr) {
  const prop = {};

  // displayName
  const dnMatch = objStr.match(/displayName\s*:\s*['"]([^'"]*)['"]/);
  // handle multiline displayName with template literals or concatenation — use a simplified approach
  const dnMatchLong = objStr.match(/displayName\s*:\s*[`'"]([^`'"]*(?:(?:[`'"][\s\n]*\+[\s\n]*[`'"])[^`'"]*)*)[`'"]/);
  if (dnMatch) {
    prop.displayName = dnMatch[1];
  } else if (dnMatchLong) {
    prop.displayName = dnMatchLong[1];
  }

  // name
  const nameMatch = objStr.match(/\bname\s*:\s*['"]([^'"]+)['"]/);
  if (nameMatch) prop.name = nameMatch[1];

  // type
  const typeMatch = objStr.match(/\btype\s*:\s*['"]([^'"]+)['"]/);
  if (typeMatch) prop.type = typeMatch[1];

  // default
  const defaultMatch = objStr.match(/\bdefault\s*:\s*['"]([^'"]*)['"]/);
  if (defaultMatch) prop.default = defaultMatch[1];

  // required
  prop.required = /\brequired\s*:\s*true/.test(objStr);

  // typeOptions.password
  prop.isPassword = /password\s*:\s*true/.test(objStr);

  // placeholder
  const phMatch = objStr.match(/placeholder\s*:\s*['"]([^'"]*)['"]/);
  if (phMatch) prop.placeholder = phMatch[1];

  // description (simplified - just first line)
  const descMatch = objStr.match(/description\s*:\s*['"]([^'"]*)['"]/);
  if (descMatch) prop.description = descMatch[1];
  // Also try template literal descriptions
  const descMatchBt = objStr.match(/description\s*:\s*`([^`]*)`/);
  if (!prop.description && descMatchBt) prop.description = descMatchBt[1];

  // Skip 'notice' and 'hidden' types — not user-facing
  if (prop.type === 'notice' || prop.type === 'hidden') return null;

  // Filter out displayOptions-only fields (like scope fields)
  // that are hidden from the user
  if (!prop.name && !prop.displayName) return null;

  return prop;
}

// ── Step 2: Parse node files to build node→credential mapping ──────────

/**
 * Recursively find all .node.ts files under a directory.
 */
async function findNodeFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findNodeFiles(full));
    } else if (entry.name.endsWith('.node.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Parse a node .node.ts file to extract node name and credential references.
 */
function parseNodeFile(source, filepath) {
  const result = {
    filepath: basename(filepath),
    name: null,       // e.g. 'gmail'
    credentials: [],  // credential type names
  };

  // Extract name — look for `name: 'gmail'` or `name = 'gmail'`
  const nameMatch = source.match(/\bname\s*[:=]\s*['"]([^'"]+)['"]/);
  if (nameMatch) result.name = nameMatch[1];

  // Find credentials: [...] using balanced bracket matching
  const credStart = source.match(/credentials\s*:\s*\[/);
  if (credStart) {
    const startIdx = credStart.index + credStart[0].length;
    const credContent = extractBalancedArray(source, startIdx);
    if (credContent) {
      const names = [...credContent.matchAll(/name\s*:\s*['"]([^'"]+)['"]/g)];
      result.credentials = names.map((m) => m[1]);
    }
  }

  return result;
}

// ── Step 3: Build combined mapping ─────────────────────────────────────

async function main() {
  console.log('=== n8n Credential Schema Extractor ===\n');

  // 1. Parse all credential files
  console.log('Parsing credential files...');
  const credFiles = (await readdir(CREDS_DIR)).filter((f) => f.endsWith('.credentials.ts'));
  console.log(`  Found ${credFiles.length} credential files`);

  const credentialsByName = new Map();
  let oauthCount = 0;
  let apiKeyCount = 0;
  let otherCount = 0;

  for (const file of credFiles) {
    const source = await readFile(join(CREDS_DIR, file), 'utf-8');
    const parsed = parseCredentialFile(source, file);
    if (parsed.name) {
      credentialsByName.set(parsed.name, parsed);
      if (parsed.authType === 'oauth2') oauthCount++;
      else if (parsed.authType === 'apiKey') apiKeyCount++;
      else otherCount++;
    }
  }

  console.log(`  Parsed: ${credentialsByName.size} credentials`);
  console.log(`    OAuth2: ${oauthCount}, API Key: ${apiKeyCount}, Other: ${otherCount}`);

  // 2. Parse all node files
  console.log('\nParsing node files...');
  const nodeFiles = await findNodeFiles(NODES_DIR);
  console.log(`  Found ${nodeFiles.length} node files`);

  // Build node name → credential names map
  // Many nodes are versioned (e.g., SlackV1.node.ts, SlackV2.node.ts)
  // We want to collect ALL credential types across all versions
  const nodeToCredentials = new Map(); // nodeName → Set<credentialName>

  for (const filepath of nodeFiles) {
    const source = await readFile(filepath, 'utf-8');
    const parsed = parseNodeFile(source, filepath);
    if (parsed.name && parsed.credentials.length > 0) {
      if (!nodeToCredentials.has(parsed.name)) {
        nodeToCredentials.set(parsed.name, new Set());
      }
      for (const cred of parsed.credentials) {
        nodeToCredentials.get(parsed.name).add(cred);
      }
    }
  }

  console.log(`  Mapped ${nodeToCredentials.size} node types to credentials`);

  // 3. Also try to infer credential types from credential name patterns
  // e.g., credential 'slackApi' → node 'slack' (remove Api/OAuth2 suffix)
  const credNameToNodeName = new Map();
  for (const [credName] of credentialsByName) {
    // Remove common suffixes to guess the node name
    const baseName = credName
      .replace(/OAuth2Api$/i, '')
      .replace(/OAuth2$/i, '')
      .replace(/Api$/i, '')
      .replace(/AppToken$/i, '')
      .replace(/Token$/i, '');
    if (baseName) {
      if (!credNameToNodeName.has(baseName.toLowerCase())) {
        credNameToNodeName.set(baseName.toLowerCase(), []);
      }
      credNameToNodeName.get(baseName.toLowerCase()).push(credName);
    }
  }

  // 4. Build the final output: for each possible n8n-nodes-base.X node type,
  //    find matching credentials and their schemas
  const output = {};

  // First, use direct node→credential mappings from parsing node files
  for (const [nodeName, credNames] of nodeToCredentials) {
    const nodeType = `n8n-nodes-base.${nodeName}`;
    const credentials = [];

    for (const credName of credNames) {
      const credDef = credentialsByName.get(credName);
      if (credDef) {
        // Resolve extends chain for inherited properties
        const allProps = [...credDef.properties];
        for (const parent of credDef.extends) {
          const parentDef = credentialsByName.get(parent);
          if (parentDef) {
            // Parent properties go first, then override with child's
            for (const pp of parentDef.properties) {
              if (!allProps.some((p) => p.name === pp.name)) {
                allProps.unshift(pp);
              }
            }
          }
        }

        credentials.push({
          name: credDef.name,
          displayName: credDef.displayName,
          authType: credDef.authType,
          // Only include user-facing fields (filter out hidden/notice + scope-only)
          fields: allProps.filter((p) => {
            if (!p.name) return false;
            // Skip n8n-internal fields
            if (p.name === 'notice') return false;
            return true;
          }),
        });
      }
    }

    if (credentials.length > 0) {
      output[nodeType] = {
        nodeName,
        credentials,
        // Pick the "best" credential for simple setup:
        // Prefer non-OAuth2 API key credentials over OAuth2
        preferredCredential: pickPreferred(credentials),
      };
    }
  }

  // Also add credential-name-based matches for nodes we didn't find in node files
  // (some node files have complex structures we might miss)
  for (const [baseLower, credNames] of credNameToNodeName) {
    const nodeType = `n8n-nodes-base.${baseLower}`;
    if (output[nodeType]) continue; // already have it

    const credentials = [];
    for (const credName of credNames) {
      const credDef = credentialsByName.get(credName);
      if (credDef) {
        const allProps = [...credDef.properties];
        for (const parent of credDef.extends) {
          const parentDef = credentialsByName.get(parent);
          if (parentDef) {
            for (const pp of parentDef.properties) {
              if (!allProps.some((p) => p.name === pp.name)) {
                allProps.unshift(pp);
              }
            }
          }
        }

        credentials.push({
          name: credDef.name,
          displayName: credDef.displayName,
          authType: credDef.authType,
          fields: allProps.filter((p) => p.name && p.name !== 'notice'),
        });
      }
    }

    if (credentials.length > 0) {
      output[nodeType] = {
        nodeName: baseLower,
        credentials,
        preferredCredential: pickPreferred(credentials),
      };
    }
  }

  console.log(`\nGenerated schemas for ${Object.keys(output).length} node types`);

  // 5. Write output
  await writeFile(OUTPUT, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\nWritten to ${OUTPUT}`);

  // 6. Print stats
  printStats(output);
}

/**
 * Pick the "best" credential type for a simple setup flow.
 * Prefers: API Key > Header Auth > Basic Auth > OAuth2
 */
function pickPreferred(credentials) {
  // First try non-OAuth API key types
  const apiKey = credentials.find((c) => c.authType === 'apiKey' || c.authType === 'header');
  if (apiKey) return apiKey.name;

  // Then basic auth
  const basic = credentials.find((c) => c.authType === 'basic');
  if (basic) return basic.name;

  // Fall back to first available (might be OAuth2)
  return credentials[0]?.name || null;
}

function printStats(output) {
  let totalMatched = 0;
  let oauthOnly = 0;
  let hasApiKey = 0;
  let fieldCounts = [];

  for (const entry of Object.values(output)) {
    totalMatched++;
    const pref = entry.credentials.find((c) => c.name === entry.preferredCredential);
    if (pref) {
      if (pref.authType === 'oauth2') oauthOnly++;
      else hasApiKey++;
      fieldCounts.push(pref.fields.length);
    }
  }

  console.log(`\n=== Stats ===`);
  console.log(`Total node types with credential schemas: ${totalMatched}`);
  console.log(`  Have API Key/Token auth: ${hasApiKey}`);
  console.log(`  OAuth2 only: ${oauthOnly}`);
  console.log(`  Avg fields per credential: ${(fieldCounts.reduce((a, b) => a + b, 0) / fieldCounts.length).toFixed(1)}`);
}

main().catch(console.error);
