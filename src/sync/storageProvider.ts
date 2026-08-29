/**
 * Local Storage Provider Abstraction
 * Supports Chrome File System Access API with in-memory test & sandbox provider
 */
import { ILocalStorageProvider, LocalStorageStatus } from './syncTypes';
import { Logger } from '../shared/logger';

/**
 * In-Memory Virtual Filesystem Provider for automated testing and sandbox environments
 */
export class MemoryStorageProvider implements ILocalStorageProvider {
  private rootName: string | null = null;
  private status: LocalStorageStatus = 'NOT_CONFIGURED';
  private permissionGranted: boolean = false;

  // In-memory directory tree: path string -> Set of child dir names / Map of file names to contents
  private directories: Set<string> = new Set();
  private files: Map<string, string> = new Map(); // "dir1/dir2/file.json" -> content

  constructor(initialRoot: string | null = null) {
    if (initialRoot) {
      this.rootName = initialRoot;
      this.status = 'CONNECTED';
      this.permissionGranted = true;
      this.directories.add('');
    }
  }

  public async selectRoot(customPath?: string): Promise<{ success: boolean; pathName?: string; error?: string }> {
    this.rootName = customPath || 'D:\\UdaanGSTData';
    this.status = 'CONNECTED';
    this.permissionGranted = true;
    this.directories.add('');
    Logger.info(`[MemoryStorageProvider] Root folder set to '${this.rootName}'`);
    return { success: true, pathName: this.rootName };
  }

  public async verifyPermission(): Promise<boolean> {
    if (!this.rootName || !this.permissionGranted) {
      this.status = this.rootName ? 'LOCAL_STORAGE_UNAVAILABLE' : 'NOT_CONFIGURED';
      return false;
    }
    this.status = 'CONNECTED';
    return true;
  }

  public revokePermission(): void {
    this.permissionGranted = false;
    this.status = 'LOCAL_STORAGE_UNAVAILABLE';
    Logger.warn('[MemoryStorageProvider] Permission revoked');
  }

  public restorePermission(): void {
    if (this.rootName) {
      this.permissionGranted = true;
      this.status = 'CONNECTED';
      Logger.info('[MemoryStorageProvider] Permission restored');
    }
  }

  public getRootName(): string | null {
    return this.rootName;
  }

  public getStatus(): LocalStorageStatus {
    return this.status;
  }

  private normalizePath(path: string[]): string {
    return path.filter(Boolean).join('/');
  }

  public async directoryExists(path: string[]): Promise<boolean> {
    if (path.length === 0) return this.status === 'CONNECTED';
    const norm = this.normalizePath(path);
    return this.directories.has(norm);
  }

  public async createDirectory(path: string[], dirName: string): Promise<boolean> {
    if (this.status !== 'CONNECTED' || !this.permissionGranted) {
      throw new Error('Local Storage Root is not configured or permission is revoked.');
    }
    const fullPathSegments = [...path, dirName].filter(Boolean);
    // Recursively add parent directory paths
    for (let i = 1; i <= fullPathSegments.length; i++) {
      const sub = fullPathSegments.slice(0, i).join('/');
      this.directories.add(sub);
    }
    return true;
  }

  public async writeFile(
    path: string[],
    fileName: string,
    content: string | Blob | ArrayBuffer
  ): Promise<{ success: boolean; path: string; error?: string }> {
    if (this.status !== 'CONNECTED' || !this.permissionGranted) {
      return {
        success: false,
        path: '',
        error: 'Local Storage permission is unavailable. Please select the Local Storage Root again.',
      };
    }

    // Ensure all directories in the path exist
    if (path.length > 0) {
      for (let i = 1; i <= path.length; i++) {
        const sub = path.slice(0, i).join('/');
        this.directories.add(sub);
      }
    }

    const normPath = this.normalizePath(path);
    const fullKey = normPath ? `${normPath}/${fileName}` : fileName;

    let stringContent = '';
    if (typeof content === 'string') {
      stringContent = content;
    } else if (content instanceof Blob) {
      stringContent = await content.text();
    } else if (content instanceof ArrayBuffer) {
      stringContent = new TextDecoder().decode(content);
    }

    this.files.set(fullKey, stringContent);
    return { success: true, path: fullKey };
  }

  public async readFile(path: string[], fileName: string): Promise<string | null> {
    const normPath = this.normalizePath(path);
    const fullKey = normPath ? `${normPath}/${fileName}` : fileName;
    return this.files.get(fullKey) ?? null;
  }

  public async fileExists(path: string[], fileName: string): Promise<boolean> {
    const normPath = this.normalizePath(path);
    const fullKey = normPath ? `${normPath}/${fileName}` : fileName;
    return this.files.has(fullKey);
  }

  public async listFiles(path: string[]): Promise<string[]> {
    const normPath = this.normalizePath(path);
    const prefix = normPath ? `${normPath}/` : '';
    const results: string[] = [];

    for (const key of this.files.keys()) {
      if (prefix === '' && !key.includes('/')) {
        results.push(key);
      } else if (prefix && key.startsWith(prefix)) {
        const remainder = key.slice(prefix.length);
        if (!remainder.includes('/')) {
          results.push(remainder);
        }
      }
    }
    return results;
  }

  public async listDirectories(path: string[]): Promise<string[]> {
    const normPath = this.normalizePath(path);
    const prefix = normPath ? `${normPath}/` : '';
    const results = new Set<string>();

    for (const dir of this.directories) {
      if (prefix === '' && dir && !dir.includes('/')) {
        results.add(dir);
      } else if (prefix && dir.startsWith(prefix)) {
        const remainder = dir.slice(prefix.length);
        if (remainder && !remainder.includes('/')) {
          results.add(remainder);
        }
      }
    }
    return Array.from(results);
  }

  public async reset(): Promise<void> {
    this.rootName = null;
    this.status = 'NOT_CONFIGURED';
    this.permissionGranted = false;
    this.directories.clear();
    this.files.clear();
  }
}

/**
 * Real Chrome Native File System Access API Provider (with fallback to memory in unsupported contexts)
 */
export class FileSystemAccessProvider implements ILocalStorageProvider {
  private rootHandle: any = null;
  private rootName: string | null = null;
  private status: LocalStorageStatus = 'NOT_CONFIGURED';
  private memoryFallback: MemoryStorageProvider = new MemoryStorageProvider();

  public async selectRoot(): Promise<{ success: boolean; pathName?: string; error?: string }> {
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker({
          mode: 'readwrite',
        });
        this.rootHandle = handle;
        this.rootName = handle.name || 'Selected Folder';
        this.status = 'CONNECTED';
        Logger.info(`[FileSystemAccessProvider] Selected directory: ${this.rootName}`);
        return { success: true, pathName: this.rootName };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return { success: false, error: 'User cancelled folder selection.' };
        }
        Logger.error(`[FileSystemAccessProvider] showDirectoryPicker error: ${String(err)}`);
        return { success: false, error: `Failed to access folder: ${err.message}` };
      }
    } else {
      // Fallback for Node.js / non-FSA environments
      return this.memoryFallback.selectRoot();
    }
  }

  public async verifyPermission(): Promise<boolean> {
    if (!this.rootHandle) {
      if (this.memoryFallback.getRootName()) {
        return this.memoryFallback.verifyPermission();
      }
      this.status = 'NOT_CONFIGURED';
      return false;
    }

    try {
      if (this.rootHandle.queryPermission) {
        const query = await this.rootHandle.queryPermission({ mode: 'readwrite' });
        if (query === 'granted') {
          this.status = 'CONNECTED';
          return true;
        }
        const request = await this.rootHandle.requestPermission({ mode: 'readwrite' });
        if (request === 'granted') {
          this.status = 'CONNECTED';
          return true;
        }
      }
      this.status = 'LOCAL_STORAGE_UNAVAILABLE';
      return false;
    } catch {
      this.status = 'LOCAL_STORAGE_UNAVAILABLE';
      return false;
    }
  }

  public getRootName(): string | null {
    return this.rootName || this.memoryFallback.getRootName();
  }

  public getStatus(): LocalStorageStatus {
    return this.rootHandle ? this.status : this.memoryFallback.getStatus();
  }

  public async directoryExists(path: string[]): Promise<boolean> {
    if (!this.rootHandle) return this.memoryFallback.directoryExists(path);
    try {
      let current = this.rootHandle;
      for (const segment of path) {
        current = await current.getDirectoryHandle(segment, { create: false });
      }
      return true;
    } catch {
      return false;
    }
  }

  public async createDirectory(path: string[], dirName: string): Promise<boolean> {
    if (!this.rootHandle) return this.memoryFallback.createDirectory(path, dirName);
    try {
      let current = this.rootHandle;
      for (const segment of path) {
        current = await current.getDirectoryHandle(segment, { create: true });
      }
      await current.getDirectoryHandle(dirName, { create: true });
      return true;
    } catch (err) {
      Logger.error(`[FileSystemAccessProvider] Failed to create dir ${dirName}: ${String(err)}`);
      throw err;
    }
  }

  public async writeFile(
    path: string[],
    fileName: string,
    content: string | Blob | ArrayBuffer
  ): Promise<{ success: boolean; path: string; error?: string }> {
    if (!this.rootHandle) return this.memoryFallback.writeFile(path, fileName, content);
    try {
      let current = this.rootHandle;
      for (const segment of path) {
        current = await current.getDirectoryHandle(segment, { create: true });
      }
      const fileHandle = await current.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      const relativePath = [...path, fileName].join('/');
      return { success: true, path: relativePath };
    } catch (err: any) {
      Logger.error(`[FileSystemAccessProvider] Failed to write file ${fileName}: ${String(err)}`);
      return {
        success: false,
        path: '',
        error: `File write failed: ${err?.message || String(err)}`,
      };
    }
  }

  public async readFile(path: string[], fileName: string): Promise<string | null> {
    if (!this.rootHandle) return this.memoryFallback.readFile(path, fileName);
    try {
      let current = this.rootHandle;
      for (const segment of path) {
        current = await current.getDirectoryHandle(segment, { create: false });
      }
      const fileHandle = await current.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  public async fileExists(path: string[], fileName: string): Promise<boolean> {
    if (!this.rootHandle) return this.memoryFallback.fileExists(path, fileName);
    try {
      let current = this.rootHandle;
      for (const segment of path) {
        current = await current.getDirectoryHandle(segment, { create: false });
      }
      await current.getFileHandle(fileName, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  public async listFiles(path: string[]): Promise<string[]> {
    if (!this.rootHandle) return this.memoryFallback.listFiles(path);
    try {
      let current = this.rootHandle;
      for (const segment of path) {
        current = await current.getDirectoryHandle(segment, { create: false });
      }
      const files: string[] = [];
      for await (const [name, handle] of current.entries()) {
        if (handle.kind === 'file') {
          files.push(name);
        }
      }
      return files;
    } catch {
      return [];
    }
  }

  public async listDirectories(path: string[]): Promise<string[]> {
    if (!this.rootHandle) return this.memoryFallback.listDirectories(path);
    try {
      let current = this.rootHandle;
      for (const segment of path) {
        current = await current.getDirectoryHandle(segment, { create: false });
      }
      const dirs: string[] = [];
      for await (const [name, handle] of current.entries()) {
        if (handle.kind === 'directory') {
          dirs.push(name);
        }
      }
      return dirs;
    } catch {
      return [];
    }
  }

  public async reset(): Promise<void> {
    this.rootHandle = null;
    this.rootName = null;
    this.status = 'NOT_CONFIGURED';
    await this.memoryFallback.reset();
  }
}

/**
 * Universal Local Storage Manager Singleton
 */
export class LocalStorageManager {
  private static instance: LocalStorageManager | null = null;
  private provider: ILocalStorageProvider;

  private constructor() {
    this.provider = new FileSystemAccessProvider();
  }

  public static getInstance(): LocalStorageManager {
    if (!LocalStorageManager.instance) {
      LocalStorageManager.instance = new LocalStorageManager();
    }
    return LocalStorageManager.instance;
  }

  public setProvider(customProvider: ILocalStorageProvider): void {
    this.provider = customProvider;
  }

  public getProvider(): ILocalStorageProvider {
    return this.provider;
  }
}
