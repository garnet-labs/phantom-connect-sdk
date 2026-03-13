// Main provider and context
export { PhantomProvider } from "./PhantomProvider";
export { usePhantom } from "./PhantomContext";
export { useModal } from "./ModalContext";

// Individual hooks
export * from "./hooks";

// Types
export type {
  PhantomSDKConfig,
  PhantomDebugConfig,
  ConnectOptions,
  ConnectResult,
  WalletAddress,
  SignMessageParams,
  SignMessageResult,
  SignAndSendTransactionParams,
  SignedTransaction,
} from "./types";

// Event types for typed event handlers
export type {
  EmbeddedProviderEvent,
  ConnectEventData,
  ConnectStartEventData,
  ConnectErrorEventData,
  DisconnectEventData,
  EmbeddedProviderEventMap,
  EventCallback,
} from "@phantom/embedded-provider-core";

export { AddressType } from "@phantom/client";
export type { PresignTransactionContext } from "@phantom/client";
export type { SignAndSendTransactionOptions } from "@phantom/chain-interfaces";
export { NetworkId } from "@phantom/constants";

// Base64url utilities for working with transaction bytes in hooks
export { base64urlEncode, base64urlDecode } from "@phantom/base64url";

// Theme exports - re-export from UI package for convenience
export { darkTheme, lightTheme } from "@phantom/wallet-sdk-ui";
export type { PhantomTheme } from "@phantom/wallet-sdk-ui";
