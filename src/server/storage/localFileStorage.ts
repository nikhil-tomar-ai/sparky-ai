import fs from 'fs';
import path from 'path';

export class LocalFileStorage {
  private static instance: LocalFileStorage;
  private uploadsDir: string;
  private outputsDir: string;

  private constructor() {
    this.uploadsDir = path.join(process.env.VERCEL ? '/tmp' : process.cwd(), 'storage', 'uploads');
    this.outputsDir = path.join(process.env.VERCEL ? '/tmp' : process.cwd(), 'storage', 'outputs');

    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(this.outputsDir)) {
      fs.mkdirSync(this.outputsDir, { recursive: true });
    }
  }

  public static getInstance(): LocalFileStorage {
    if (!LocalFileStorage.instance) {
      LocalFileStorage.instance = new LocalFileStorage();
    }
    return LocalFileStorage.instance;
  }

  public saveUploadFile(filename: string, content: string): { id: string; filePath: string } {
    const fileId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const sanitizedName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = path.join(this.uploadsDir, `${fileId}_${sanitizedName}`);

    fs.writeFileSync(filePath, content, 'utf-8');
    return { id: fileId, filePath };
  }

  public saveOutputFile(jobId: string, filename: string, content: string): string {
    const sanitizedName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = path.join(this.outputsDir, `humanized_${jobId}_${sanitizedName}`);

    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  public getFilePath(fileType: 'upload' | 'output', filename: string): string | null {
    const dir = fileType === 'upload' ? this.uploadsDir : this.outputsDir;
    const fullPath = path.join(dir, filename);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    return null;
  }
}

export const getLocalStorage = () => LocalFileStorage.getInstance();
