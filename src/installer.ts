// Claw Desktop - OpenClaw Installer
// Downloads and sets up OpenClaw on first run

import { platform, homedir } from '@tauri-apps/api/os';
import { createDir, exists, writeBinaryFile, writeTextFile } from '@tauri-apps/api/fs';
import { Command } from '@tauri-apps/api/shell';
import { appDataDir } from '@tauri-apps/api/path';

export interface InstallProgress {
  stage: 'checking' | 'downloading-node' | 'downloading-openclaw' | 'installing' | 'configuring' | 'starting' | 'done' | 'error';
  percent: number;
  message: string;
}

export type ProgressCallback = (progress: InstallProgress) => void;

const NODE_VERSION = 'v22.22.0';
const OPENCLAW_VERSION = 'latest';

export async function checkInstallation(): Promise<boolean> {
  try {
    // Check if our managed installation exists
    const dataDir = await appDataDir();
    const openclawPath = `${dataDir}/openclaw`;
    return await exists(openclawPath);
  } catch {
    return false;
  }
}

export async function checkNodeInstalled(): Promise<boolean> {
  try {
    const cmd = new Command('node', ['--version']);
    const output = await cmd.execute();
    return output.code === 0;
  } catch {
    return false;
  }
}

export async function installOpenClaw(onProgress: ProgressCallback): Promise<void> {
  const dataDir = await appDataDir();
  const installDir = `${dataDir}/openclaw`;
  
  try {
    onProgress({ stage: 'checking', percent: 0, message: 'Checking system...' });
    
    // Create install directory
    await createDir(installDir, { recursive: true });
    
    // Check if Node.js is available
    const hasNode = await checkNodeInstalled();
    
    if (!hasNode) {
      onProgress({ stage: 'downloading-node', percent: 10, message: 'Node.js not found. Installing...' });
      await installNode(installDir, onProgress);
    }
    
    onProgress({ stage: 'downloading-openclaw', percent: 40, message: 'Downloading OpenClaw...' });
    
    // Install OpenClaw via npm
    const npmCmd = hasNode ? 'npm' : `${installDir}/node/bin/npm`;
    const installCmd = new Command(npmCmd, ['install', '-g', 'openclaw', '--prefix', installDir]);
    
    const result = await installCmd.execute();
    
    if (result.code !== 0) {
      throw new Error(`npm install failed: ${result.stderr}`);
    }
    
    onProgress({ stage: 'configuring', percent: 70, message: 'Configuring...' });
    
    // Create default config
    await createDefaultConfig(installDir);
    
    onProgress({ stage: 'starting', percent: 90, message: 'Starting gateway...' });
    
    // Start the gateway
    await startGateway(installDir);
    
    onProgress({ stage: 'done', percent: 100, message: 'Installation complete!' });
    
  } catch (error) {
    onProgress({ 
      stage: 'error', 
      percent: 0, 
      message: `Installation failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
    throw error;
  }
}

async function installNode(installDir: string, onProgress: ProgressCallback): Promise<void> {
  const os = await platform();
  
  let nodeUrl: string;
  let nodeBinary: string;
  
  if (os === 'darwin') {
    // macOS - use arm64 for Apple Silicon, x64 for Intel
    const arch = 'arm64'; // TODO: detect actual architecture
    nodeUrl = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-${arch}.tar.gz`;
    nodeBinary = 'node';
  } else if (os === 'win32') {
    nodeUrl = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;
    nodeBinary = 'node.exe';
  } else {
    // Linux
    nodeUrl = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz`;
    nodeBinary = 'node';
  }
  
  onProgress({ stage: 'downloading-node', percent: 15, message: 'Downloading Node.js runtime...' });
  
  // Download using curl/wget
  const downloadCmd = new Command('curl', ['-fsSL', '-o', `${installDir}/node.tar.gz`, nodeUrl]);
  await downloadCmd.execute();
  
  onProgress({ stage: 'downloading-node', percent: 30, message: 'Extracting Node.js...' });
  
  // Extract
  const extractCmd = new Command('tar', ['-xzf', `${installDir}/node.tar.gz`, '-C', installDir, '--strip-components=1']);
  await extractCmd.execute();
}

async function createDefaultConfig(installDir: string): Promise<void> {
  const home = await homedir();
  const configDir = `${home}/.openclaw`;
  const configPath = `${configDir}/openclaw.json`;
  
  // Check if config already exists
  if (await exists(configPath)) {
    return;
  }
  
  await createDir(configDir, { recursive: true });
  
  // Generate a random token
  const token = generateToken();
  
  const config = {
    meta: {
      lastTouchedVersion: "2026.2.0",
      lastTouchedAt: new Date().toISOString()
    },
    gateway: {
      mode: "local",
      auth: {
        mode: "token",
        token: token
      }
    },
    agents: {
      defaults: {
        maxConcurrent: 4
      }
    }
  };
  
  await writeTextFile(configPath, JSON.stringify(config, null, 2));
  
  // Create workspace directory
  await createDir(`${configDir}/workspace`, { recursive: true });
}

function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 48; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

export async function startGateway(installDir?: string): Promise<void> {
  const dataDir = installDir || await appDataDir();
  const openclawBin = `${dataDir}/openclaw/bin/openclaw`;
  
  // Start gateway in background
  const cmd = new Command(openclawBin, ['gateway', 'start']);
  cmd.spawn();
}

export async function stopGateway(): Promise<void> {
  try {
    const cmd = new Command('pkill', ['-f', 'openclaw-gateway']);
    await cmd.execute();
  } catch {
    // Ignore errors if process not running
  }
}

export async function getGatewayToken(): Promise<string | null> {
  try {
    const home = await homedir();
    const configPath = `${home}/.openclaw/openclaw.json`;
    
    // Read config file
    const cmd = new Command('cat', [configPath]);
    const result = await cmd.execute();
    
    if (result.code === 0) {
      const config = JSON.parse(result.stdout);
      return config?.gateway?.auth?.token || null;
    }
  } catch {
    // Config doesn't exist yet
  }
  return null;
}
