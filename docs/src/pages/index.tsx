import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

/* ── Data ──────────────────────────────────────────── */

const vsFeatures = [
  { feature: 'AI providers', pawz: 'Unlimited', pawzSub: 'Any OpenAI-compatible API', oc: '30+ via gateway', desk: '1 locked-in' },
  { feature: 'Skills / plugins', pawz: 'Unlimited', pawzSub: 'PawzHub — community marketplace', oc: '~10 built-in', desk: '~5 basic' },
  { feature: 'Chat bridges', pawz: '10+ platforms', pawzSub: 'Telegram · Discord · Slack · Matrix · +6', oc: 'Plugin-based', desk: 'None' },
  { feature: 'Multi-agent', pawz: 'Boss/Worker', pawzSub: 'Real-time orchestrator + 8 specialties', oc: 'Routing only', desk: 'Single agent' },
  { feature: 'Memory', pawz: '6-stage hybrid', pawzSub: 'BM25 + vector + decay + MMR', oc: 'Basic context', desk: 'Simple text' },
  { feature: 'Security', pawz: '7 layers', pawzSub: 'Injection scan → Docker sandbox', oc: '~2 layers', desk: '1 basic' },
  { feature: 'DeFi trading', pawz: 'ETH + Solana', pawzSub: '7 EVM chains · honeypot · whale tracking', oc: 'None', desk: 'None' },
  { feature: 'Offline', pawz: 'Full', pawzSub: 'Ollama — zero cloud dependency', oc: 'Partial', desk: 'Cloud only' },
  { feature: 'Cost', pawz: '$0 forever', pawzSub: 'MIT licensed — no limits', oc: 'Free / self-host', desk: '$20/mo/provider' },
  { feature: 'Binary', pawz: '~5 MB', pawzSub: 'Tauri + Rust — native webview', oc: 'Server deploy', desk: '~200 MB Electron' },
];

const stats = [
  { number: '22', label: 'Built-in Tools', sub: 'core engine tools' },
  { number: '∞', label: 'Skills', sub: 'plugin-based — PawzHub' },
  { number: '∞', label: 'AI Providers', sub: 'any OpenAI-compatible' },
  { number: '10+', label: 'Chat Platforms', sub: 'bridged channels' },
  { number: '7', label: 'Security Layers', sub: 'defense-in-depth' },
  { number: '8', label: 'DeFi Chains', sub: 'EVM + Solana' },
  { number: '16', label: 'Views', sub: 'full desktop app' },
  { number: '$0', label: 'Cost', sub: 'forever' },
];

const avatarSprites = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

const pillars = [
  {
    icon: 'shield',
    title: '7 Security Layers',
    headline: 'Claws scratch. Pawz protect.',
    points: [
      'Dual prompt injection scanner (TypeScript + Rust) — 16+ patterns, blocks attacks before the LLM sees them',
      'Per-agent tool policies — allowlist, denylist, or unrestricted mode per agent',
      'Human-in-the-Loop approval — dangerous tools require your explicit OK',
      'Docker container sandboxing — CAP_DROP ALL, no network, memory limits, auto-kill',
      'Browser network policy — domain allowlist/blocklist blocks data exfiltration',
      'Command risk classifier — detects rm -rf /, fork bombs, curl|sh pipes',
      'Credential vault — OS keychain + AES-GCM encrypted SQLite, keys never in prompts',
    ],
    link: '/docs/reference/security',
  },
  {
    icon: 'hub',
    title: 'Multi-Agent Orchestrator',
    headline: 'One boss. Unlimited workers. Real-time war room.',
    points: [
      'Boss agent with 5 orchestrator tools: delegate, check status, send message, complete, spawn agent',
      'Dynamic agent spawning — boss creates specialists at runtime (coder, researcher, designer, writer, analyst)',
      'Per-agent model routing — boss uses Claude Opus, workers use Gemini Flash (auto_tier)',
      'Async parallel execution — workers run concurrently via Tokio',
      'Live message bus — watch delegation, progress, and results in real-time UI',
      'Worker reporting — structured status updates (working, done, error, blocked)',
    ],
    link: '/docs/guides/orchestrator',
  },
  {
    icon: 'forum',
    title: '10 Channel Bridges',
    headline: 'Your AI lives everywhere you chat.',
    points: [
      'Telegram, Discord, Slack, Matrix, IRC, Mattermost, Nextcloud, Nostr, Twitch, Webchat',
      'Same brain, same memory, same tools — across every platform',
      'Per-user isolated sessions with pairing/allowlist/open access policies',
      'Prompt injection scanning on every incoming message',
      'First-match routing rules — route users or channels to specific agents',
      'Provider fallback — billing/auth/rate-limit errors auto-retry next provider',
    ],
    link: '/docs/channels/overview',
  },
  {
    icon: 'psychology',
    title: 'Research-Grade Memory',
    headline: 'Hybrid search that would make a PhD jealous.',
    points: [
      'BM25 full-text via SQLite FTS5 + vector cosine via Ollama embeddings',
      'Weighted merge (0.4 BM25 + 0.6 vector) for best-of-both-worlds retrieval',
      'Temporal decay with 30-day half-life — recent memories rank higher',
      'MMR re-ranking (lambda=0.7) — diversity without sacrificing relevance',
      'Auto-recall before every message + auto-capture of facts from conversations',
      'Memory Palace UI — search, store, graph visualization, JSON export',
    ],
    link: '/docs/guides/memory',
  },
  {
    icon: 'trending_up',
    title: 'DeFi Trading Suite',
    headline: 'Self-custody DEX on ETH + Solana. On your desktop.',
    points: [
      'Uniswap V3 — 13 tools on 7 EVM chains (Ethereum, Polygon, Arbitrum, Optimism, Base, Goerli, Sepolia)',
      'Jupiter + PumpPortal — 7 tools on Solana with Ed25519 signing & SPL token support',
      'Coinbase CDP — 5 tools for centralized exchange with encrypted wallet keys',
      'Honeypot detection — simulated buy+sell, round-trip tax, ownership audit, risk score 0-30',
      'Whale tracking + smart money analysis — top trader profiles, accumulator/profit-taker classification',
      'Trading policies — max trade size, daily loss cap, allowed pairs, enforced server-side in Rust',
    ],
    link: '/docs/guides/trading',
  },
  {
    icon: 'extension',
    title: 'PawzHub — Unlimited Skills',
    headline: 'Plugin-based. Modular. If it has an API, it works.',
    points: [
      '30+ skills ship today — but the architecture is plugin-based, so anyone can build and share more',
      'PawzHub: community skill marketplace where contributors publish skills for everyone',
      'Modular by design: install only the skills you need — trading, smart home, dev tools, or all of them',
      'Vault skills: Email, Slack, Telegram, Discord, GitHub, REST API, Webhooks, Coinbase, Uniswap, Jupiter, Image Gen',
      'Smart Home: Hue, Sonos, Eight Sleep — Media: Whisper, TTS, Spotify, Camera',
      'All credentials encrypted in OS keychain vault, injected server-side, never exposed in prompts',
    ],
    link: '/docs/guides/skills',
  },
];

const moreFeatures = [
  { icon: 'task_alt', title: 'Kanban Tasks', desc: '6-column drag-and-drop board with multi-agent assignment, lead/collaborator roles, and cron scheduling', link: '/docs/guides/tasks' },
  { icon: 'schedule', title: 'Cron Automations', desc: 'Scheduled task execution with dedup guard, heartbeat monitoring, and morning brief template', link: '/docs/guides/automations' },
  { icon: 'science', title: 'Deep Research', desc: 'Quick and deep modes with live source feed, credibility ratings, and findings grid', link: '/docs/guides/research' },
  { icon: 'record_voice_over', title: '35+ TTS Voices', desc: 'Google Cloud, OpenAI, and ElevenLabs with speed, language, stability, and similarity controls', link: '/docs/guides/voice' },
  { icon: 'mail', title: 'Email System', desc: 'Himalaya IMAP/SMTP with per-account permissions, credential audit trail, and OS keychain storage', link: '/docs/guides/email' },
  { icon: 'web', title: 'Browser Engine', desc: 'Headless Chrome with 9 action types, persistent profiles, screenshot gallery, and network policy', link: '/docs/guides/browser' },
  { icon: 'edit_document', title: 'Content Studio', desc: 'Document editor with markdown/HTML/plaintext, word count, and one-click AI improvement', link: '/docs/guides/content-studio' },
  { icon: 'folder_open', title: 'Projects Browser', desc: 'Local file tree with git integration, branch status, and 17 sensitive path protections', link: '/docs/guides/projects' },
  { icon: 'tune', title: 'Foundry', desc: 'Models dashboard and chat mode presets with temperature, thinking level, and system prompt', link: '/docs/guides/foundry' },
  { icon: 'dashboard', title: 'Dashboard', desc: 'Weather, tasks, quick actions, and time-based greeting with agent avatar display', link: '/docs/guides/dashboard' },
  { icon: 'compress', title: 'Session Compaction', desc: 'AI-powered context compression — auto-summarizes older messages when tokens exceed 60K', link: '/docs/guides/sessions' },
  { icon: 'inventory_2', title: 'Container Sandbox', desc: 'Docker isolation with CAP_DROP ALL, memory/CPU limits, network disabled, command risk scoring', link: '/docs/guides/container-sandbox' },
  { icon: 'account_balance_wallet', title: 'Budget Control', desc: 'Per-model pricing, daily budget cap, warnings at 50/75/90%, auto_tier for cost-efficient routing', link: '/docs/guides/pricing' },
  { icon: 'vpn_lock', title: 'Tailscale Integration', desc: 'Expose Pawz within your tailnet or publicly via Funnel — status monitoring, auth key support', link: '/docs/guides/tailscale' },
  { icon: 'terminal', title: '15 Slash Commands', desc: '/model, /think, /agent, /remember, /recall, /web, /img, /exec, /compact, and more', link: '/docs/guides/slash-commands' },
  { icon: 'face', title: '50 Agent Avatars', desc: 'Sprite-based avatars with 7-color palette, soul files (IDENTITY.md, SOUL.md, USER.md)', link: '/docs/guides/agents' },
];

const worldFirsts = [
  { title: 'Dual-language injection scanning', desc: 'TypeScript frontend + Rust backend — 16+ patterns, 4 severity levels — the only desktop AI with pre-routing injection defense on external channels' },
  { title: 'Self-custody DeFi on ETH + Solana', desc: 'Honeypot detection, whale tracking, smart money analysis on 7 EVM chains + Solana — private keys encrypted in OS keychain, decrypted only in Rust for signing' },
  { title: '10-channel bridge with agent routing', desc: 'Telegram, Discord, Slack, Matrix, IRC, Mattermost, Nextcloud, Nostr, Twitch, Webchat — all with same memory, tools, and per-user isolated sessions' },
  { title: 'BM25 + vector + decay + MMR memory', desc: '6-stage hybrid retrieval pipeline with auto-managed local Ollama embeddings, keyword fallback, and Memory Palace visualization' },
  { title: 'Multi-agent orchestrator with live bus', desc: 'Boss/worker delegation with 8 agent specialties, async parallel Tokio execution, dynamic agent spawning, and real-time message tracking' },
  { title: '7-layer security in a free app', desc: 'Prompt injection scanner, agent policies, HIL approval, Docker sandbox, browser network policy, command risk classifier, encrypted credential vault — all MIT licensed' },
];

/* ── Components ────────────────────────────────────── */

function HeroSection() {
  return (
    <header className="hero-section">
      <div className="hero-glow" />
      <div className="hero-glow-2" />
      <div className="container">
        <div className="hero-content">
          <div className="hero-logo-row">
            <img src="/paw/img/pawz-logo.png" alt="Pawz" className="hero-logo" />
          </div>
          <div className="hero-badge">Open Source &middot; MIT License &middot; Free Forever</div>
          <h1 className="hero-title">
            Pawz are safer<br />than claws.
          </h1>
          <p className="hero-tagline">
            The most secure, capable, and extensible AI agent platform ever built for the desktop.
          </p>
          <p className="hero-description">
            Unlimited providers. Unlimited skills via PawzHub.
            10+ channel bridges. 7 security layers. 22,000 lines of Rust.
            Multi-agent orchestration. DeFi trading. Research-grade memory.
            Modular — install only what you need. $0 forever.
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
          <div className="hero-avatars">
            {avatarSprites.map((id) => (
              <img key={id} src={`/paw/img/avatars/${id}.png`} alt={`Agent ${id}`} className="hero-avatar" />
            ))}
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
          <p>We don't just beat ChatGPT Desktop — we take on OpenClaw too.</p>
        </div>

        {/* VS Header */}
        <div className="vs-header">
          <div className="vs-col-label">&nbsp;</div>
          <div className="vs-col-pawz">
            <img src="/paw/img/pawz-logo.png" alt="" className="vs-logo" />
            <span className="vs-name">Pawz</span>
          </div>
          <div className="vs-col-oc">
            <span className="vs-name-dim">OpenClaw</span>
          </div>
          <div className="vs-col-desk">
            <span className="vs-name-dim">ChatGPT / Claude</span>
          </div>
        </div>

        {/* VS Rows */}
        <div className="vs-rows">
          {vsFeatures.map((row, i) => (
            <div key={i} className="vs-row">
              <div className="vs-col-label">{row.feature}</div>
              <div className="vs-col-pawz vs-cell-pawz">
                <span className="vs-val-pawz">{row.pawz}</span>
                <span className="vs-sub">{row.pawzSub}</span>
              </div>
              <div className="vs-col-oc vs-cell-dim">{row.oc}</div>
              <div className="vs-col-desk vs-cell-dim">{row.desk}</div>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="vs-bottom">
          <span className="ms vs-bottom-icon">verified</span>
          Pawz ships 30+ skills today — and with the PawzHub, anyone can add more.
          If it has an API key, we can make it work.
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
          <p>Not marketing promises — real features backed by 22,638 lines of Rust. Plugin architecture means it keeps growing.</p>
        </div>
        <div className="pillars-grid">
          {pillars.map((p, i) => (
            <div key={i} className="pillar-card">
              <div className="pillar-icon"><span className="ms">{p.icon}</span></div>
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

function MoreFeaturesSection() {
  return (
    <section className="more-section">
      <div className="container">
        <div className="section-header">
          <div className="section-badge">Everything Else</div>
          <h2>And we're just getting started.</h2>
          <p>16 views, unlimited skills, 15 slash commands, 50 avatars — every feature backed by real code.</p>
        </div>
        <div className="more-grid">
          {moreFeatures.map((f, i) => (
            <Link key={i} to={f.link} className="more-card">
              <span className="ms more-icon">{f.icon}</span>
              <div>
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
              </div>
            </Link>
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
          <h2>How Pawz works</h2>
          <p>A native Tauri app with an async Rust engine — not an Electron wrapper with a Node.js backend.</p>
        </div>
        <div className="flow">
          <div className="flow-col">
            <div className="flow-node flow-node-input">
              <span className="ms">desktop_windows</span>
              <strong>Desktop App</strong>
              <span className="flow-sub">Tauri v2 · ~5 MB</span>
            </div>
            <div className="flow-node flow-node-input">
              <span className="ms">forum</span>
              <strong>10 Channels</strong>
              <span className="flow-sub">Telegram · Discord · Slack · Matrix · IRC · +5 more</span>
            </div>
          </div>
          <div className="flow-arrow-col">
            <span className="flow-arr">→</span>
            <span className="flow-arr">→</span>
          </div>
          <div className="flow-col">
            <div className="flow-node flow-node-core">
              <span className="ms">memory</span>
              <strong>Pawz Engine</strong>
              <span className="flow-sub">22,638 lines of async Rust + Tokio</span>
              <div className="flow-modules">
                <span>Agent Loop</span><span>Memory</span><span>Security</span>
                <span>Orchestrator</span><span>Trading</span><span>Skills</span>
                <span>Channels</span><span>Sessions</span><span>Compaction</span>
              </div>
            </div>
          </div>
          <div className="flow-arrow-col">
            <span className="flow-arr">→</span>
            <span className="flow-arr">→</span>
          </div>
          <div className="flow-col">
            <div className="flow-node flow-node-output">
              <span className="ms">cloud</span>
              <strong>∞ AI Providers</strong>
              <span className="flow-sub">Any OpenAI-compatible API</span>
            </div>
            <div className="flow-node flow-node-output">
              <span className="ms">build</span>
              <strong>22 Tools · ∞ Skills</strong>
              <span className="flow-sub">PawzHub plugin marketplace</span>
            </div>
          </div>
        </div>
        <div className="flow-down">
          <span className="flow-arr">↓</span>
        </div>
        <div className="flow-storage">
          <div className="flow-node flow-node-store">
            <span className="ms">storage</span>
            <strong>2×SQLite + OS Keychain</strong>
            <span className="flow-sub">AES-GCM encrypted credentials · BM25 + vector memory index</span>
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
          <img src="/paw/img/pawz-logo.png" alt="Pawz" className="cta-logo" />
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
    <Layout description="Pawz — the most secure, capable, and extensible AI agent platform for the desktop. Unlimited providers and skills via PawzHub. 10+ channels, 7 security layers. Free, open source, MIT licensed.">
      <HeroSection />
      <StatsSection />
      <ComparisonSection />
      <PillarsSection />
      <MoreFeaturesSection />
      <WorldFirstsSection />
      <ArchSection />
      <CTASection />
    </Layout>
  );
}
