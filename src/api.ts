// Paw — HTTP helpers (used only for pre-connection health probes)
// All runtime communication goes through the WebSocket gateway in gateway.ts

let gatewayUrl = '';
let gatewayToken = '';

export function setGatewayConfig(url: string, token: string) {
  gatewayUrl = url;
  gatewayToken = token;
}

export function getGatewayUrl(): string {
  return gatewayUrl;
}

export function getGatewayToken(): string {
  return gatewayToken;
}

/**
 * Quick HTTP health probe — works before the WebSocket is up.
 * Returns true if the gateway HTTP endpoint responds at all.
 */
export async function probeHealth(): Promise<boolean> {
  if (!gatewayUrl) return false;
  try {
    // Use a simple GET without custom headers to avoid CORS preflight (OPTIONS).
    // The gateway's HTTP endpoint may return 405 for OPTIONS requests.
    const response = await fetch(`${gatewayUrl}/health`, {
      method: 'GET',
      mode: 'no-cors',
      signal: AbortSignal.timeout(3000),
    });
    // In no-cors mode, response.type is 'opaque' and status is 0,
    // but a successful fetch means the server is reachable.
    return response.ok || response.type === 'opaque';
  } catch {
    return false;
  }
}
