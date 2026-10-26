import fs from 'fs';
import path from 'path';
import { writableRoot, isServerless } from '../config/index.js';

export interface LocalJobRecord {
  id: string;
  filename: string;
  status: 'created' | 'processing' | 'completed' | 'cancelled' | 'failed';
  totalRows: number;
  completedRows: number;
  successfulRows: number;
  failedRows: number;
  createdAt: string;
  updatedAt: string;
  config: Record<string, any>;
  rows: Array<Record<string, any>>;
  auditLogs: Array<Record<string, any>>;
}

export interface LocalDbData {
  jobs: Record<string, LocalJobRecord>;
  uploads: Record<string, { id: string; filename: string; originalPath: string; headers: string[]; totalRows: number; createdAt: string }>;
  settings: Record<string, any>;
}

export class LocalDatabase {
  private static instance: LocalDatabase;
  private dbPath: string;
  private data: LocalDbData;

  private constructor() {
    const dataDir = path.join(writableRoot, 'data');
    // Serverless: keep state in memory only, nothing is written to disk.
    if (!isServerless && !fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = path.join(dataDir, 'sparkyai_local_db.json');
    this.data = this.loadData();
  }

  public static getInstance(): LocalDatabase {
    if (!LocalDatabase.instance) {
      LocalDatabase.instance = new LocalDatabase();
    }
    return LocalDatabase.instance;
  }

  private loadData(): LocalDbData {
    if (!isServerless && fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        return JSON.parse(raw);
      } catch (e) {
        console.warn('Failed to parse local database file, initializing fresh:', e);
      }
    }
    return {
      jobs: {},
      uploads: {},
      settings: {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2',
        temperature: 0.7
      }
    };
  }

  private save(): void {
    if (isServerless) return;
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error persisting local database:', err);
    }
  }

  public listUploads() {
    return Object.values(this.data.uploads);
  }

  public saveUpload(id: string, metadata: { filename: string; originalPath: string; headers: string[]; totalRows: number }) {
    this.data.uploads[id] = {
      id,
      ...metadata,
      createdAt: new Date().toISOString()
    };
    this.save();
  }

  public getUpload(id: string) {
    return this.data.uploads[id] || null;
  }

  public createJob(job: LocalJobRecord) {
    this.data.jobs[job.id] = job;
    this.save();
    return job;
  }

  public getJob(id: string): LocalJobRecord | null {
    return this.data.jobs[id] || null;
  }

  public listJobs(): LocalJobRecord[] {
    return Object.values(this.data.jobs).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public updateJob(id: string, updates: Partial<LocalJobRecord>) {
    if (this.data.jobs[id]) {
      this.data.jobs[id] = {
        ...this.data.jobs[id],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this.save();
    }
  }

  public getSettings() {
    return this.data.settings;
  }

  public updateSettings(newSettings: Record<string, any>) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
  }
}

export const getLocalDb = () => LocalDatabase.getInstance();
