/**
 * In-memory settings store. Nothing is written to disk, so it works on
 * read-only/serverless hosts (Vercel). State lives only for the lifetime of the
 * process; persistent defaults should come from environment variables.
 */
export class LocalDatabase {
  private static instance: LocalDatabase;
  // Empty by default so environment variables (LLM_PROVIDER, OLLAMA_API_KEY, ...) apply.
  private settings: Record<string, any> = {};

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
