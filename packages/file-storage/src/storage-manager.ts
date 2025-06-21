import { FileStorageAdapter, FileNode, FileMetadata, StorageStats, AdapterStatus } from './adapters/storage-adapter'
import { LocalAdapter } from './adapters/local-adapter'
import { S3Adapter } from './adapters/s3-adapter'
// Import { SupabaseAdapter } from './adapters/supabase-adapter' // Future implementation

// Utility function to safely extract error message
const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error)
}

export type StorageProvider = 'local' | 's3' | 'supabase'

export interface StorageConfig {
  provider: StorageProvider
  config: Record<string, any>
  fallback?: {
    provider: StorageProvider
    config: Record<string, any>
  }
}

/**
 * StorageManager - Unified interface for file storage
 * 
 * Provides automatic adapter selection and fallback support.
 * Handles initialization and provides a consistent API across all storage backends.
 */
export class StorageManager implements FileStorageAdapter {
  private adapter: FileStorageAdapter | null = null
  private fallbackAdapter: FileStorageAdapter | null = null
  private config: StorageConfig | null = null
  private initialized = false

  /**
   * Initialize storage with automatic provider selection and fallback
   */
  async initialize(config: StorageConfig): Promise<void> {
    this.config = config

    // Initialize primary adapter
    this.adapter = this.createAdapter(config.provider)
    await this.adapter.initialize(config.config)

    // Initialize fallback adapter if configured
    if (config.fallback) {
      try {
        this.fallbackAdapter = this.createAdapter(config.fallback.provider)
        await this.fallbackAdapter.initialize(config.fallback.config)
        console.log(`📦 Storage fallback initialized: ${config.fallback.provider}`)
      } catch (error) {
        console.warn(`Failed to initialize fallback storage: ${getErrorMessage(error)}`)
        this.fallbackAdapter = null
      }
    }

    this.initialized = true
    console.log(`✅ Storage manager initialized with ${config.provider} adapter`)
  }

  /**
   * Create storage from environment variables for zero-config setup
   */
  static async createFromEnv(): Promise<StorageManager> {
    const manager = new StorageManager()
    const config = StorageManager.getConfigFromEnv()
    await manager.initialize(config)
    return manager
  }

  /**
   * Get storage configuration from environment variables
   */
  static getConfigFromEnv(): StorageConfig {
    const provider = (process.env.STORAGE_PROVIDER as StorageProvider) || 'local'
    
    let config: Record<string, any> = {}
    let fallback: { provider: StorageProvider; config: Record<string, any> } | undefined

    switch (provider) {
      case 'local':
        config = {
          rootPath: process.env.STORAGE_LOCAL_PATH || './workspace-files',
          maxFileSize: parseInt(process.env.STORAGE_MAX_FILE_SIZE || '52428800'), // 50MB
          allowedTypes: process.env.STORAGE_ALLOWED_TYPES?.split(',') || []
        }
        break

      case 's3':
        config = {
          bucket: process.env.STORAGE_S3_BUCKET,
          region: process.env.STORAGE_S3_REGION || 'us-east-1',
          endpoint: process.env.STORAGE_S3_ENDPOINT,
          accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
          prefix: process.env.STORAGE_S3_PREFIX || 'workspace-files',
          maxFileSize: parseInt(process.env.STORAGE_MAX_FILE_SIZE || '104857600'), // 100MB
          allowedTypes: process.env.STORAGE_ALLOWED_TYPES?.split(',') || [],
          forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE === 'true'
        }

        if (!config.bucket) {
          console.warn('S3 bucket not configured, falling back to local storage')
          fallback = {
            provider: 'local',
            config: {
              rootPath: './workspace-files',
              maxFileSize: 52428800
            }
          }
        }
        break

      case 'supabase':
        config = {
          url: process.env.NEXT_PUBLIC_SUPABASE_URL,
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          bucket: process.env.STORAGE_SUPABASE_BUCKET || 'workspace-files',
          maxFileSize: parseInt(process.env.STORAGE_MAX_FILE_SIZE || '52428800'), // 50MB
          allowedTypes: process.env.STORAGE_ALLOWED_TYPES?.split(',') || []
        }

        if (!config.url || !config.anonKey) {
          console.warn('Supabase not configured, falling back to local storage')
          fallback = {
            provider: 'local',
            config: {
              rootPath: './workspace-files',
              maxFileSize: 52428800
            }
          }
        }
        break
    }

    return { provider, config, fallback }
  }

  // FileStorageAdapter implementation with fallback support
  async listFiles(path: string): Promise<FileNode[]> {
    return this.executeWithFallback(adapter => adapter.listFiles(path))
  }

  async readFile(path: string): Promise<{ content: string; metadata: FileMetadata }> {
    return this.executeWithFallback(adapter => adapter.readFile(path))
  }

  async writeFile(
    path: string, 
    content: string | Buffer, 
    metadata?: Partial<FileMetadata>
  ): Promise<FileNode> {
    return this.executeWithFallback(adapter => adapter.writeFile(path, content, metadata))
  }

  async deleteFile(path: string): Promise<void> {
    return this.executeWithFallback(adapter => adapter.deleteFile(path))
  }

  async createFolder(path: string): Promise<FileNode> {
    return this.executeWithFallback(adapter => adapter.createFolder(path))
  }

  async uploadFile(
    path: string, 
    file: File | Buffer, 
    onProgress?: (progress: number) => void
  ): Promise<FileNode> {
    return this.executeWithFallback(adapter => adapter.uploadFile(path, file, onProgress))
  }

  async searchFiles(query: string, path?: string): Promise<FileNode[]> {
    return this.executeWithFallback(adapter => adapter.searchFiles(query, path))
  }

  async getStorageStats(): Promise<StorageStats> {
    return this.executeWithFallback(adapter => adapter.getStorageStats())
  }

  async isHealthy(): Promise<boolean> {
    if (!this.adapter) return false
    return this.adapter.isHealthy()
  }

  async getStatus(): Promise<AdapterStatus> {
    if (!this.adapter) {
      return {
        provider: 'none',
        configured: false,
        healthy: false,
        lastCheck: new Date().toISOString(),
        capabilities: []
      }
    }

    const primaryStatus = await this.adapter.getStatus()
    
    if (this.fallbackAdapter) {
      const fallbackStatus = await this.fallbackAdapter.getStatus()
      return {
        ...primaryStatus,
        capabilities: [...primaryStatus.capabilities, 'fallback'],
        fallback: fallbackStatus
      } as AdapterStatus & { fallback: AdapterStatus }
    }

    return primaryStatus
  }

  // Storage manager specific methods
  async getCurrentAdapter(): Promise<FileStorageAdapter | null> {
    return this.adapter
  }

  async getFallbackAdapter(): Promise<FileStorageAdapter | null> {
    return this.fallbackAdapter
  }

  async switchToFallback(): Promise<boolean> {
    if (!this.fallbackAdapter) return false

    console.log('🔄 Switching to fallback storage adapter')
    this.adapter = this.fallbackAdapter
    this.fallbackAdapter = null
    return true
  }

  getProviderInfo(): { 
    primary: string; 
    fallback: string | null; 
    config: StorageConfig | null 
  } {
    return {
      primary: this.config?.provider || 'none',
      fallback: this.config?.fallback?.provider || null,
      config: this.config
    }
  }

  // Private methods
  private createAdapter(provider: StorageProvider): FileStorageAdapter {
    switch (provider) {
      case 'local':
        return new LocalAdapter()
      case 's3':
        return new S3Adapter()
      case 'supabase':
        // return new SupabaseAdapter() // Future implementation
        throw new Error('Supabase adapter not yet implemented')
      default:
        throw new Error(`Unsupported storage provider: ${provider}`)
    }
  }

  private async executeWithFallback<T>(
    operation: (adapter: FileStorageAdapter) => Promise<T>
  ): Promise<T> {
    if (!this.adapter) {
      throw new Error('Storage manager not initialized')
    }

    try {
      return await operation(this.adapter)
    } catch (error) {
      console.warn(`Primary storage failed: ${getErrorMessage(error)}`)
      
      // Try fallback if available
      if (this.fallbackAdapter) {
        console.log('🔄 Attempting operation with fallback storage')
        try {
          const result = await operation(this.fallbackAdapter)
          console.log('✅ Fallback operation succeeded')
          return result
        } catch (fallbackError) {
          console.error(`Fallback storage also failed: ${getErrorMessage(fallbackError)}`)
          throw new Error(`Both primary and fallback storage failed: ${getErrorMessage(error)}`)
        }
      }
      
      throw error
    }
  }
}

// Export singleton instance for convenience
let globalStorageManager: StorageManager | null = null

export async function getStorageManager(): Promise<StorageManager> {
  if (!globalStorageManager) {
    globalStorageManager = await StorageManager.createFromEnv()
  }
  return globalStorageManager
}

export function resetStorageManager(): void {
  globalStorageManager = null
} 