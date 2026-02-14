// Paw - Desktop app for OpenClaw

// Check gateway status on load
async function checkGatewayStatus() {
  const gatewayDot = document.getElementById('gateway-dot');
  const gatewayStatus = document.getElementById('gateway-status');
  const agentsDot = document.getElementById('agents-dot');
  const agentsStatus = document.getElementById('agents-status');

  try {
    // Try to connect to local gateway
    const response = await fetch('http://localhost:5757/health', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      gatewayDot?.classList.add('active');
      if (gatewayStatus) gatewayStatus.textContent = 'Running';
      
      // If gateway is running, we could fetch agent count
      agentsDot?.classList.add('active');
      if (agentsStatus) agentsStatus.textContent = 'Available';
    } else {
      gatewayDot?.classList.add('warning');
      if (gatewayStatus) gatewayStatus.textContent = 'Error';
    }
  } catch (error) {
    // Gateway not running
    if (gatewayStatus) gatewayStatus.textContent = 'Not running';
    if (agentsStatus) agentsStatus.textContent = '—';
  }
}

// Button handlers
document.getElementById('setup-btn')?.addEventListener('click', () => {
  // TODO: Open setup wizard
  alert('Setup wizard coming soon!');
});

document.getElementById('docs-btn')?.addEventListener('click', () => {
  // Open docs in browser
  window.open('https://docs.openclaw.ai', '_blank');
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkGatewayStatus();
  
  // Refresh status every 10 seconds
  setInterval(checkGatewayStatus, 10000);
});
