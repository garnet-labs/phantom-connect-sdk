import type { DebugLogger } from "@phantom/embedded-provider-core";
import { debug } from "../../../debug";

export class BrowserLogger implements DebugLogger {
  info(message: string, ...args: unknown[]): void {
    debug.info(message, args.length > 0 ? String(args[0]) : "", args[1]);
  }

  warn(message: string, ...args: unknown[]): void {
    debug.warn(message, args.length > 0 ? String(args[0]) : "", args[1]);
  }

  error(message: string, ...args: unknown[]): void {
    debug.error(message, args.length > 0 ? String(args[0]) : "", args[1]);
  }

  debug(message: string, ...args: unknown[]): void {
    debug.log(message, args.length > 0 ? String(args[0]) : "", args[1]);
  }
}
