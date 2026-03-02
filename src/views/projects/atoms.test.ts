import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isSensitivePath,
  isOutOfProjectScope,
  getFileIcon,
  getLanguageClass,
  shortenPath,
  shortenRemote,
  getDepth,
  getProjectRoot,
  loadSavedProjects,
  savePersistProjects,
  BINARY_EXTENSIONS,
} from './atoms';
import type { ProjectFolder } from './atoms';

// ── isSensitivePath ────────────────────────────────────────────────────

describe('isSensitivePath', () => {
  it('blocks .ssh', () => {
    expect(isSensitivePath('/home/user/.ssh')).toBeTruthy();
    expect(isSensitivePath('/home/user/.ssh/id_rsa')).toBeTruthy();
  });

  it('blocks .aws', () => {
    expect(isSensitivePath('/home/user/.aws/credentials')).toBeTruthy();
  });

  it('blocks /etc', () => {
    expect(isSensitivePath('/etc/passwd')).toBeTruthy();
  });

  it('blocks home root', () => {
    expect(isSensitivePath('/home/user')).toBe('Home directory root (too broad)');
  });

  it('blocks filesystem root', () => {
    expect(isSensitivePath('/')).toBe('Filesystem root');
  });

  it('allows normal project paths', () => {
    expect(isSensitivePath('/home/user/projects/myapp')).toBeNull();
  });

  it('blocks .openclaw config', () => {
    expect(isSensitivePath('/home/user/.openclaw/tokens')).toBeTruthy();
  });
});

// ── isOutOfProjectScope ────────────────────────────────────────────────

describe('isOutOfProjectScope', () => {
  it('returns null when no project is active', () => {
    expect(isOutOfProjectScope('/any/path', null)).toBeNull();
  });

  it('allows files within project', () => {
    expect(isOutOfProjectScope('/home/user/proj/src/main.ts', '/home/user/proj')).toBeNull();
  });

  it('blocks files outside project', () => {
    const result = isOutOfProjectScope('/etc/passwd', '/home/user/proj');
    expect(result).toBeTruthy();
    expect(result).toContain('outside');
  });

  it('blocks directory traversal', () => {
    const result = isOutOfProjectScope('/home/user/proj/../../../etc/passwd', '/home/user/proj');
    expect(result).toBeTruthy();
  });

  it('allows the project root itself', () => {
    expect(isOutOfProjectScope('/home/user/proj', '/home/user/proj')).toBeNull();
  });
});

// ── getFileIcon ────────────────────────────────────────────────────────

describe('getFileIcon', () => {
  it('returns code for TypeScript', () => {
    expect(getFileIcon('ts')).toBe('code');
  });

  it('returns terminal for shell scripts', () => {
    expect(getFileIcon('sh')).toBe('terminal');
  });

  it('returns image for png', () => {
    expect(getFileIcon('png')).toBe('image');
  });

  it('returns default for unknown extensions', () => {
    expect(getFileIcon('xyz')).toBe('insert_drive_file');
  });
});

// ── getLanguageClass ───────────────────────────────────────────────────

describe('getLanguageClass', () => {
  it('returns typescript for ts/tsx', () => {
    expect(getLanguageClass('ts')).toBe('language-typescript');
    expect(getLanguageClass('tsx')).toBe('language-typescript');
  });

  it('returns rust for rs', () => {
    expect(getLanguageClass('rs')).toBe('language-rust');
  });

  it('returns plaintext for unknown', () => {
    expect(getLanguageClass('xyz')).toBe('language-plaintext');
  });
});

// ── shortenPath ────────────────────────────────────────────────────────

describe('shortenPath', () => {
  it('replaces /Users/x with ~', () => {
    expect(shortenPath('/Users/john/projects')).toBe('~/projects');
  });

  it('replaces /home/x with ~', () => {
    expect(shortenPath('/home/john/src')).toBe('~/src');
  });

  it('leaves other paths unchanged', () => {
    expect(shortenPath('/opt/app')).toBe('/opt/app');
  });
});

// ── shortenRemote ──────────────────────────────────────────────────────

describe('shortenRemote', () => {
  it('shortens SSH remote', () => {
    expect(shortenRemote('git@github.com:user/repo.git')).toBe('user/repo');
  });

  it('shortens HTTPS remote', () => {
    expect(shortenRemote('https://github.com/user/repo.git')).toBe('user/repo');
  });

  it('returns raw for unknown format', () => {
    expect(shortenRemote('local-path')).toBe('local-path');
  });
});

// ── getDepth ───────────────────────────────────────────────────────────

describe('getDepth', () => {
  it('returns 0 for root-level file', () => {
    expect(getDepth('/proj/file.ts', '/proj')).toBe(1);
  });

  it('returns depth for nested files', () => {
    expect(getDepth('/proj/src/utils/file.ts', '/proj')).toBe(3);
  });
});

// ── BINARY_EXTENSIONS ──────────────────────────────────────────────────

describe('BINARY_EXTENSIONS', () => {
  it('includes common binary types', () => {
    expect(BINARY_EXTENSIONS).toContain('png');
    expect(BINARY_EXTENSIONS).toContain('wasm');
    expect(BINARY_EXTENSIONS).toContain('pdf');
  });

  it('does not include text types', () => {
    expect(BINARY_EXTENSIONS).not.toContain('ts');
    expect(BINARY_EXTENSIONS).not.toContain('json');
  });
});

// ── getProjectRoot ─────────────────────────────────────────────────────

describe('getProjectRoot', () => {
  const projects: ProjectFolder[] = [
    { path: '/home/user/proj-a', name: 'Proj A' } as ProjectFolder,
    { path: '/home/user/proj-b', name: 'Proj B' } as ProjectFolder,
  ];

  it('returns matching project path', () => {
    expect(getProjectRoot('/home/user/proj-a/src/main.ts', projects)).toBe('/home/user/proj-a');
  });

  it('returns null for files outside all projects', () => {
    expect(getProjectRoot('/etc/passwd', projects)).toBeNull();
  });

  it('returns null for empty projects list', () => {
    expect(getProjectRoot('/home/user/proj-a/file.ts', [])).toBeNull();
  });

  it('matches first project when overlapping', () => {
    const overlapping: ProjectFolder[] = [
      { path: '/home/user', name: 'Home' } as ProjectFolder,
      { path: '/home/user/proj-a', name: 'Proj A' } as ProjectFolder,
    ];
    expect(getProjectRoot('/home/user/proj-a/file.ts', overlapping)).toBe('/home/user');
  });
});

// ── loadSavedProjects / savePersistProjects ────────────────────────────

describe('loadSavedProjects / savePersistProjects', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
  });

  it('returns empty array when nothing saved', () => {
    expect(loadSavedProjects()).toEqual([]);
  });

  it('round-trips through save and load', () => {
    const projects: ProjectFolder[] = [{ path: '/home/user/proj', name: 'Proj' } as ProjectFolder];
    savePersistProjects(projects);
    const loaded = loadSavedProjects();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].path).toBe('/home/user/proj');
  });

  it('returns empty array on corrupt JSON', () => {
    store.set('paw-project-folders', '{broken');
    expect(loadSavedProjects()).toEqual([]);
  });
});
