// Centralised WebSocket / engine connection state.
// Import isConnected() where you previously used a local `wsConnected` variable.

let _wsConnected = false;

export function isConnected(): boolean {
  return _wsConnected;
}

export function setConnected(v: boolean): void {
  _wsConnected = v;
}
