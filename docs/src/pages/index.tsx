import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

/* ── Data ──────────────────────────────────────────── */

const comparisonRows = [
  { label: 'Price', pawz: 'Free forever (MIT)', them: '$20/mo per provider' },
  { label: 'AI providers', pawz: '10 + any OpenAI-compatible', them: '1 (locked in)' },
  { label: 'Channel bridges', pawz: '10 platforms', them: '0' },
  { label: 'Agent tools', pawz: '72', them: '~5–10' },
  { label: 'Security layers', pawz: '7 (injection scan → Docker sandbox)', them: '1 (basic safety)' },
  { label: 'Multi-agent', pawz: 'Boss/Worker orchestrator', them: 'Single agent only' },
  { label: 'Memory', pawz: 'BM25 + vector + temporal decay + MMR', them: 'Keyword / simple text' },
  { label: 'DeFi trading', pawz: 'Uniswap V3 + Jupiter + Coinbase', them: 'None' },
  { label: 'Task automation', pawz: 'Kanban board + cron jobs', them: 'None' },
  { label: 'Voice (TTS)', pawz: '3 providers (Google, OpenAI, ElevenLabs)', them: '0–1' },
  { label: 'Local/offline', pawz: 'Full offline via Ollama', them: 'Cloud only' },
  { label: 'Privacy', pawz: 'All data on your machine', them: 'Data on their servers' },
  { label: 'Binary size', pawz: '~5 MB (Tauri + Rust)', them: '~200 MB (Electron)' },
  { label: 'Engine', pawz: '22,638 lines of Rust', them: 'Node.js / Python' },
  { label: 'Open source', pawz: 'MIT License', them: 'Proprietary' },
];

const stats = [
  { number: '72', label: 'Agent Tools', sub: 'built-in' },
  { number: '10', label: 'AI Providers', sub: 'with fallback' },
  { number: '10', label: 'Chat Platforms', sub: 'bridged' },
  { number: '7', label: 'Security Layers', sub: 'defense-in-depth' },
  { number: '22K', label: 'Lines of Rust', sub: 'native engine' },
  { number: '$0', label: 'Cost', sub: 'forever' },
];

const pillars = [
  {
    icon: '🛡️',
    title: '7 Security Layers',
    headline: 'Claws scratch. Pawz protect.',
    points: [
      'Dual prompt injection scanner (TypeScript + Rust) — blocks attacks before the LLM sees them',
      'Per-agent tool policies — allowlist, denylist, or sandbox mode per agent',
      'Human-in-the-Loop approval — dangerous tools require your explicit OK',
      'Docker container sandboxing — CAP_DROP ALL, no network, memory limits, auto-kill',
      'Browser network policy — domain allowlist/blocklist blocks data exfiltration',
      'Command risk classifier — detects rm -rf /, fork bombs, curl|sh pipes',
      'Credential vault — OS keychain + encrypted SQLite, keys never in prompts',
    ],
    link: '/docs/reference/security',
  },
  {
    icon: '🤖',
    title: 'Multi-Agent Orchestrator',
    headline: 'One boss. Unlimited workers. Real-time war room.',
    points: [
      'Boss agent with 5 orchestrator tools: delegate, check status, send message, complete, spawn agent',
      'Dynamic agent spawning — boss creates specialists at runtime (coder, researcher, designer)',
      'Per-agent model routing — boss uses Claude Opus, workers use Gemini Flash',
      'Async parallel execution — workers run concurrently via Tokio',
      'Live message bus — watch delegation, progress, and results in real-time',
      'Worker reporting — structured status updates (working, done, error, blocked)',
    ],
    link: '/docs/guides/orchestrator',
  },
  {
    icon: '💬',
    title: '10 Channel Bridges',
    headline: 'Your AI lives everywhere you chat.',
    points: [
      'Telegram, Discord, Slack, Matrix, IRC, Mattermost, Nextcloud, Nostr, Twitch, Webchat',
      'Same brain, same memory, same tools — across every platform',
      'Per-user isolated sessions — no cross-contamination',
      'Prompt injection scanning on every incoming message',
      'First-match routing rules — route users or channels to specific agents',
      'Provider fallback — if one API fails, tries the next automatically',
    ],
    link: '/docs/channels/overview',
  },
  {
    icon: '🧠',
    title: 'Research-Grade Memory',
    headline: 'Hybrid search that would make a PhD jealous.',
    points: [
      'BM25 full-text via SQLite FTS5 + vector cosine via Ollama embeddings',
      'Weighted merge (0.4 BM25 + 0.6 vector) for best-of-both-worlds retrieval',
      'Temporal decay with 30-day half-life — recent memories rank higher',
      'MMR re-ranking (λ=0.7) — diversity without sacrificing relevance',
      'Auto-recall before every message + auto-capture of facts from conversations',
      'Auto-managed Ollama — starts it, pulls the model, runs embeddings, all transparent',
    ],
    link: '/docs/guides/memory',
  },
  {
    icon: '📈',
    title: 'DeFi Trading Suite',
    headline: 'Self-custody DEX trading. On your desktop.',
    points: [
      'Uniswap V3 (Ethereum) — 13 tools including honeypot detection and whale tracking',
      'Jupiter + PumpPortal (Solana) — 7 tools with smart routing',
      'Coinbase CDP — 5 tools for centralized exchange',
      'Self-custody — private keys encrypted in OS keychain, decrypted only in Rust for signing',
      'Smart money analysis — top trader profiles, accumulator/profit-taker classification',
      'Trading policies — max trade size, daily loss cap, allowed pairs, enforced server-side',
    ],
    link: '/docs/guides/trading',
  },
  {
    icon: '⚡',
    title: '72 Tools & Skills',
    headline: 'The PawzHub. Unlimited.',
    points: [
      '22 built-in tools + 50 skill tools across 33 skill definitions',
      'Smart home (Hue, Sonos, Eight Sleep), productivity (Notion, Obsidian, Things)',
      'Communication (WhatsApp, iMessage, email, Slack), media (Spotify, ElevenLabs, Whisper)',
      'Development (tmux, git, ripgrep), system (1Password, Peekaboo, security audit)',
      'Encrypted credential vault — API keys stored in OS keychain, injected server-side',
      'Custom instructions per skill — override any default, stored separately',
    ],
    link: '/docs/guides/skills',
  },
];

const worldFirsts = [
  { title: 'Dual-language injection scanning', desc: 'TypeScript frontend + Rust backend — the only desktop AI with pre-routing injection defense on external channels' },
  { title: 'Self-custody DeFi + AI agents', desc: 'Honeypot detection, whale tracking, and smart money analysis — keys never leave your machine' },
  { title: '10-channel bridge architecture', desc: 'No consumer AI app connects to Telegram, Discord, Slack, Matrix, IRC, Mattermost, Nextcloud, Nostr, Twitch, and Webchat' },
  { title: 'BM25 + vector + decay + MMR memory', desc: 'Research-grade hybrid retrieval in a desktop app — with auto-managed local Ollama embeddings' },
  { title: 'Multi-agent orchestrator with live bus', desc: 'Boss/worker delegation with async parallel execution, dynamic agent spawning, and real-time message tracking' },
  { title: '7-layer security stack', desc: 'From prompt injection scanning to Docker sandboxing to command risk classification — in a free, open-source app' },
];

/* ── Components ────────────────────────────────────── */

function HeroSection() {
  return (
    <header className="hero-section">
      <div className="hero-glow" />
      <div className="hero-glow-2" />
      <div className="container">
        <div className="hero-content">
          <div className="hero-badge">Open Source &middot; MIT License &middot; Free Forever</div>
          <h1 className="hero-title">
            Pawz are safer<br />than claws.
          </h1>
          <p className="hero-tagline">
            The most secure, capable, and extensible AI agent platform ever built for the desktop.
          </p>
          <p className="hero-description">
            72 tools. 10 providers. 10 chat platforms. 7 security layers. 22,000 lines of Rust.
            Multi-agent orchestration. DeFi trading. Research-grade memory.
            All running natively on your machine for $0.
          </p>
          <div className="hero-buttons">
            <Link className="hero-btn hero-btn-primary" to="/docs/start/installation">
              Install Pawz
            </Link>
            <Link className="hero-btn hero-btn-secondary" to="https://github.com/elisplash/paw">
              Star on GitHub
            </Link>
          </div>
          <div className="hero-sub">
            One-click DMG install coming soon &middot; macOS, Linux, Windows
          </div>
        </div>
      </div>
    </header>
  );
}

function StatsSection() {
  return (
    <section className="stats-section">
      <div className="container">
        <div className="stats-grid">
          {stats.map((s, i) => (
            <div key={i} className="stat">
              <div className="stat-number">{s.number}</div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ComparisonSection() {
  return (
    <section className="comparison-section">
      <div className="container">
        <div className="section-header">
          <div className="section-badge">Why Pawz?</div>
          <h2>The competition isn't even close.</h2>
          <p>Every major AI desktop app locked you into one provider, zero channels, and minimal tools. We built the opposite.</p>
        </div>
        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th></th>
                <th className="col-pawz">Pawz</th>
                <th className="col-them">Claude / ChatGPT Desktop</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((r, i) => (
                <tr key={i}>
                  <td className="comp-label">{r.label}</td>
                  <td className="comp-pawz">{r.pawz}</td>
                  <td className="comp-them">{r.them}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PillarsSection() {
  return (
    <section className="pillars-section">
      <div className="container">
        <div className="section-header">
          <div className="section-badge">Deep Dive</div>
          <h2>Built different. Proven in code.</h2>
          <p>Not marketing promises — real features backed by 22,638 lines of Rust.</p>
        </div>
        <div className="pillars-grid">
          {pillars.map((p, i) => (
            <div key={i} className="pillar-card">
              <div className="pillar-icon">{p.icon}</div>
              <h3>{p.title}</h3>
              <p className="pillar-headline">{p.headline}</p>
              <ul>
                {p.points.map((pt, j) => (
                  <li key={j}>{pt}</li>
                ))}
              </ul>
              <Link to={p.link} className="pillar-link">Read the docs &rarr;</Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorldFirstsSection() {
  return (
    <section className="firsts-section">
      <div className="container">
        <div className="section-header">
          <div className="section-badge">World Firsts</div>
          <h2>Things no other desktop AI app has done.</h2>
          <p>We checked. Seriously.</p>
        </div>
        <div className="firsts-grid">
          {worldFirsts.map((f, i) => (
            <div key={i} className="first-card">
              <div className="first-number">#{i + 1}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ArchSection() {
  return (
    <section className="arch-section">
      <div className="container">
        <div className="section-header">
          <div className="section-badge">Architecture</div>
          <h2>Native performance. Not an Electron wrapper.</h2>
          <p>Built on Tauri 2 + Rust — the same engine that powers the DeFi trading, memory search, and channel bridges.</p>
        </div>
        <div className="arch-grid">
          <div className="arch-card">
            <div className="arch-label">Frontend</div>
            <div className="arch-value">TypeScript</div>
            <div className="arch-detail">Vanilla DOM, zero framework overhead</div>
          </div>
          <div className="arch-card">
            <div className="arch-label">Backend</div>
            <div className="arch-value">Rust + Tokio</div>
            <div className="arch-detail">22,638 lines of async native code</div>
          </div>
          <div className="arch-card">
            <div className="arch-label">Shell</div>
            <div className="arch-value">Tauri v2</div>
            <div className="arch-detail">~5 MB binary, native webview</div>
          </div>
          <div className="arch-card">
            <div className="arch-label">Database</div>
            <div className="arch-value">SQLite</div>
            <div className="arch-detail">FTS5, vector search, all local</div>
          </div>
          <div className="arch-card">
            <div className="arch-label">Crypto</div>
            <div className="arch-value">OS Keychain</div>
            <div className="arch-detail">Keys never in RAM longer than needed</div>
          </div>
          <div className="arch-card">
            <div className="arch-label">Containers</div>
            <div className="arch-value">Docker / Bollard</div>
            <div className="arch-detail">CAP_DROP ALL, ephemeral, auto-kill</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="cta-section">
      <div className="container">
        <div className="cta-content">
          <h2>Ready to switch?</h2>
          <p>
            Install Pawz, add a provider (or just start Ollama), and create your first agent.
            Under 5 minutes. Free forever.
          </p>
          <div className="hero-buttons">
            <Link className="hero-btn hero-btn-primary" to="/docs/start/installation">
              Get Started
            </Link>
            <Link className="hero-btn hero-btn-secondary" to="/docs/start/first-agent">
              Create Your First Agent
            </Link>
          </div>
          <div className="cta-sub">
            MIT Licensed &middot; macOS, Linux, Windows &middot; DMG installer coming soon
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Page ──────────────────────────────────────────── */

export default function Home() {
  return (
    <Layout description="Pawz — the most secure, capable, and extensible AI agent platform for the desktop. Free, open source, MIT licensed.">
      <HeroSection />
      <StatsSection />
      <ComparisonSection />
      <PillarsSection />
      <WorldFirstsSection />
      <ArchSection />
      <CTASection />
    </Layout>
  );
}
