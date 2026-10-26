import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  uploadDir: string;
  exportDir: string;
  tempDir: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  maxFileSizeMb: number;
  defaultBatchSize: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  fallbackAiEnabled: boolean;
}

// Serverless platforms (Vercel/Lambda) have a read-only project dir; only /tmp is writable.
export const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.cwd() === '/var/task');
export const writableRoot = isServerless ? '/tmp' : process.cwd();
const rootDir = writableRoot;

export const config: ServerConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'file:./storage/dev.db',
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || './storage/uploads'),
  exportDir: path.resolve(rootDir, process.env.EXPORT_DIR || './storage/exports'),
  tempDir: path.resolve(rootDir, process.env.TEMP_DIR || './storage/temporary'),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1:8b',
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10),
  defaultBatchSize: parseInt(process.env.DEFAULT_BATCH_SIZE || '10', 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  retryBaseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10),
  fallbackAiEnabled: process.env.FALLBACK_AI_ENABLED !== 'false'
};

export default config;
