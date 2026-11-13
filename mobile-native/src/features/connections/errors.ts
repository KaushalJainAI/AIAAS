/**
 * A capability lookup or OAuth step that failed, carrying the server's own
 * explanation. Mirrors `MCPToolsError` in better-n8n-frontend/src/api/mcp.ts.
 *
 * The reason is the one thing a non-technical user can act on: "add a
 * credential", "reconnect your account" and "this connector is broken, not
 * you" are three different next steps. The web reads it from an Axios error;
 * here it comes from the mobile client's `ApiError`, which carries the same
 * `status` and `code` the backend sends.
 */

import { ApiError } from '../../api/client';
import type { MCPToolsErrorCode } from './types';

export class ConnectionToolsError extends Error {
  readonly code: MCPToolsErrorCode;
  readonly status?: number;

  constructor(message: string, code: MCPToolsErrorCode, status?: number) {
    super(message);
    this.name = 'ConnectionToolsError';
    this.code = code;
    this.status = status;
  }

  /** Wrap anything thrown by `api()`. Unknown shapes still produce a usable message. */
  static from(err: unknown): ConnectionToolsError {
    if (err instanceof ConnectionToolsError) return err;
    if (err instanceof ApiError) {
      const code = (err.code ?? 'unknown') as MCPToolsErrorCode;
      return new ConnectionToolsError(
        err.message?.trim() || 'Could not reach this connection.',
        code,
        err.status,
      );
    }
    const message = err instanceof Error && err.message.trim()
      ? err.message
      : 'Could not reach this connection.';
    return new ConnectionToolsError(message, 'unknown');
  }

  /** Whether the user can fix this themselves, and how. */
  get isCredentialProblem(): boolean {
    return this.code === 'credential_missing' || this.code === 'credential_invalid';
  }
}
