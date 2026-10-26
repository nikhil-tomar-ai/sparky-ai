/**
 * In-memory settings store. Nothing is written to disk, so it works on
 * read-only/serverless hosts (Vercel). State lives only for the lifetime of the
 * process; persistent defaults should come from environment variables.
 */
export class LocalDatabase {
  private static instance: LocalDatabase;
  private settings: Record<string, any> = {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
    temperature: 0.7
  };

  public static getInstance(): LocalDatabase {
    if (!LocalDatabase.instance) {
      LocalDatabase.instance = new LocalDatabase();
    }
    return LocalDatabase.instance;
  }

  public getSettings() {
    return this.settings;
  }

  public updateSettings(newSettings: Record<string, any>) {
    this.settings = { ...this.settings, ...newSettings };
  }
}

export const getLocalDb = () => LocalDatabase.getInstance();
