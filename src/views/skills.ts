// Skills View — Stub
// The old plugin-manager UI (721 lines) was 100% stubbed out — every action
// returned early with "coming soon".  Skill management now lives in
// settings-skills.ts.  This file only exists to satisfy the main.ts import
// of setWsConnected / loadSkills until the import can be removed.

let wsConnected = false;

export function setWsConnected(connected: boolean) {
  wsConnected = connected;
}

export async function loadSkills() {
  // No-op — skill management is handled by settings-skills.ts
  void wsConnected;
}

export function initSkillsEvents() {
  // No-op — event wiring is handled by settings-skills.ts
}

