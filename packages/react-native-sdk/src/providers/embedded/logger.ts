import type { DebugLogger } from "@phantom/embedded-provider-core";

export class ExpoLogger implements DebugLogger {
  private readonly enabled: boolean;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  info(message: string, ...args: unknown[]): void {
    if (this.enabled) {
      console.info(`[PHANTOM] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.enabled) {
      console.warn(`[PHANTOM] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.enabled) {
      console.error(`[PHANTOM] ${message}`, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.enabled) {
      console.log(`[PHANTOM] ${message}`, ...args);
    }
  }
}
