/**
 * Session management for Phantom OpenClaw plugin
 * Wraps the SessionManager from @phantom/mcp-server
 */

import { SessionManager } from "@phantom/mcp-server";
import type { PhantomClient, SessionData, DeviceCodeAuthDisplayOptions } from "@phantom/mcp-server";

/**
 * Configuration options for PluginSession
 */
export interface PluginSessionOptions {
  /** OAuth callback port (default: 8080) */
  callbackPort?: number;
  /** Authentication flow for the embedded wallet session */
  authFlow?: "sso" | "device-code";
  /** Directory to store session data (default: ~/.phantom-mcp) */
  sessionDir?: string;
}

/**
 * Plugin session manager
 * Handles authentication and provides access to PhantomClient
 */
export class PluginSession {
  private sessionManager: SessionManager;
  private initialized = false;
  private initializingPromise: Promise<void> | null = null;
  private pendingPrompt: string | null = null;

  constructor(options: PluginSessionOptions = {}) {
    // Initialize SessionManager with configuration
    this.sessionManager = new SessionManager({
      appId: "phantom-openclaw",
      callbackPort: options.callbackPort,
      authFlow: options.authFlow,
      sessionDir: options.sessionDir,
    });
  }

  /**
   * Initialize the session (authenticate if needed)
   * Thread-safe: concurrent calls will await the same initialization promise
   */
  async initialize(displayOptions?: DeviceCodeAuthDisplayOptions): Promise<void> {
    if (this.initialized) {
      return;
    }

    // If already initializing, return the existing promise
    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    // Create and store the initialization promise
    const initPromise = this.sessionManager
      .initialize(displayOptions)
      .then(() => {
        this.initialized = true;
        this.pendingPrompt = null;
      })
      .catch((error: unknown) => {
        // Clear promise on error so subsequent calls can retry
        this.initializingPromise = null;
        throw error;
      });
    this.initializingPromise = initPromise;

    return initPromise;
  }

  async startTextModeAuthentication(): Promise<{ status: "ready" } | { status: "pending"; prompt: string }> {
    if (this.initialized) {
      return { status: "ready" };
    }

    if (this.initializingPromise) {
      return {
        status: "pending",
        prompt: this.pendingPrompt ?? "Authentication is already in progress. Complete the pending Phantom login flow.",
      };
    }

    let resolvePrompt!: (prompt: string) => void;
    const promptPromise = new Promise<string>(resolve => {
      resolvePrompt = resolve;
    });

    const initPromise = this.initialize({
      openBrowser: false,
      onPrompt: prompt => {
        this.pendingPrompt = prompt;
        resolvePrompt(prompt);
      },
    });

    void initPromise.catch(() => {});

    const raceResult = await Promise.race([
      initPromise.then(() => ({ status: "ready" as const })),
      promptPromise.then(prompt => ({ status: "pending" as const, prompt })),
    ]);

    return raceResult;
  }

  async resetSession(displayOptions?: DeviceCodeAuthDisplayOptions): Promise<void> {
    this.initializingPromise = null;
    this.initialized = false;
    this.pendingPrompt = null;
    await this.sessionManager.resetSession(displayOptions);
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the authenticated PhantomClient
   */
  getClient(): PhantomClient {
    if (!this.initialized) {
      throw new Error("Session not initialized. Call initialize() first.");
    }
    return this.sessionManager.getClient();
  }

  /**
   * Get the current session data
   */
  getSession(): SessionData {
    if (!this.initialized) {
      throw new Error("Session not initialized. Call initialize() first.");
    }
    return this.sessionManager.getSession();
  }

  /**
   * Get dynamic OAuth headers for authenticated Phantom API requests.
   */
  getOAuthHeaders(): Record<string, string | undefined> {
    if (!this.initialized) {
      throw new Error("Session not initialized. Call initialize() first.");
    }
    return this.sessionManager.getOAuthHeaders();
  }
}
