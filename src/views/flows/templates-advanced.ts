// ─────────────────────────────────────────────────────────────────────────────
// Flow Templates — Advanced (Finance, Support, AI Patterns, AI Superpowers)
// Pure data, no DOM, no IPC.
// ─────────────────────────────────────────────────────────────────────────────

import type { FlowTemplate } from './atoms';

export const TEMPLATES_ADVANCED: FlowTemplate[] = [
  // ── Finance & Trading ────────────────────────────────────────────────────

  {
    id: 'tpl-price-alert',
    name: 'Price Alert',
    description: 'Monitor asset prices, trigger alerts on thresholds.',
    category: 'finance',
    tags: ['trading', 'price', 'alert', 'crypto', 'defi'],
    icon: 'candlestick_chart',
    nodes: [
      {
        kind: 'trigger',
        label: 'Price Check',
        description: 'Every 5 minutes',
        config: { prompt: 'Check prices every 5 minutes' },
      },
      {
        kind: 'tool',
        label: 'Fetch Prices',
        description: 'API call',
        config: { prompt: 'Fetch current prices for monitored assets' },
      },
      {
        kind: 'condition',
        label: 'Threshold Hit?',
        config: { conditionExpr: 'Has any asset crossed a price threshold?' },
      },
      {
        kind: 'agent',
        label: 'Analyze Move',
        description: 'Context analysis',
        config: {
          prompt:
            'Analyze the price movement: recent trend, volume, potential cause. Assess if action is warranted.',
        },
      },
      {
        kind: 'output',
        label: 'Alert',
        description: 'Notification',
        config: { outputTarget: 'chat' },
      },
      {
        kind: 'output',
        label: 'Normal',
        description: 'No action',
        config: { outputTarget: 'log' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3, label: 'Yes' },
      { fromIdx: 2, toIdx: 5, label: 'No' },
      { fromIdx: 3, toIdx: 4 },
    ],
  },

  {
    id: 'tpl-portfolio-report',
    name: 'Portfolio Report',
    description: 'Daily portfolio summary with P&L, allocation, and risk assessment.',
    category: 'finance',
    tags: ['portfolio', 'report', 'trading', 'risk'],
    icon: 'account_balance',
    nodes: [
      {
        kind: 'trigger',
        label: 'Daily Close',
        description: 'End of day',
        config: { prompt: 'Run at market close daily' },
      },
      {
        kind: 'tool',
        label: 'Fetch Positions',
        description: 'Get all holdings',
        config: {
          prompt: 'Fetch all current positions, balances, and transaction history for the day',
        },
      },
      {
        kind: 'data',
        label: 'Calculate P&L',
        description: 'Profit & loss',
        config: {
          transform:
            'Calculate daily P&L, overall returns, allocation percentages, and exposure levels.',
        },
      },
      {
        kind: 'agent',
        label: 'Risk Assessment',
        description: 'Analyze risk',
        config: {
          prompt:
            'Assess portfolio risk: concentration risk, volatility exposure, correlation analysis. Flag any positions exceeding limits.',
        },
      },
      {
        kind: 'output',
        label: 'Report',
        description: 'Daily summary',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4 },
    ],
  },

  // ── Support ──────────────────────────────────────────────────────────────

  {
    id: 'tpl-support-triage',
    name: 'Support Triage',
    description: 'Classify support tickets, route to the right agent or team.',
    category: 'support',
    tags: ['support', 'tickets', 'triage', 'routing'],
    icon: 'support_agent',
    nodes: [
      { kind: 'trigger', label: 'New Ticket', description: 'Incoming request', config: {} },
      {
        kind: 'agent',
        label: 'Classify',
        description: 'Category & priority',
        config: {
          prompt:
            'Classify the support ticket: category (billing, technical, feature request, bug), priority (urgent, high, normal, low).',
        },
      },
      {
        kind: 'condition',
        label: 'Auto-Resolvable?',
        config: { conditionExpr: 'Can this be resolved with existing documentation or FAQ?' },
      },
      {
        kind: 'agent',
        label: 'Auto-Resolve',
        description: 'Generate response',
        config: {
          prompt:
            'Generate a helpful response using the knowledge base. Include relevant docs/links.',
        },
      },
      {
        kind: 'output',
        label: 'Send Response',
        description: 'Auto-reply',
        config: { outputTarget: 'chat' },
      },
      {
        kind: 'output',
        label: 'Escalate',
        description: 'Route to human',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3, label: 'Yes' },
      { fromIdx: 2, toIdx: 5, label: 'No' },
      { fromIdx: 3, toIdx: 4 },
    ],
  },

  {
    id: 'tpl-feedback-analyzer',
    name: 'Feedback Analyzer',
    description: 'Collect user feedback, categorize themes, generate improvement suggestions.',
    category: 'support',
    tags: ['feedback', 'analysis', 'improvement', 'ux'],
    icon: 'rate_review',
    nodes: [
      {
        kind: 'trigger',
        label: 'Feedback Batch',
        description: 'Weekly collection',
        config: { prompt: 'Collect feedback from the past week' },
      },
      {
        kind: 'data',
        label: 'Aggregate',
        description: 'Combine sources',
        config: {
          transform:
            'Aggregate feedback from all sources: surveys, support tickets, social mentions, in-app feedback.',
        },
      },
      {
        kind: 'agent',
        label: 'Categorize',
        description: 'Theme extraction',
        config: {
          prompt:
            'Categorize feedback into themes. Identify recurring patterns, pain points, and feature requests. Quantify by frequency.',
        },
      },
      {
        kind: 'agent',
        label: 'Recommendations',
        description: 'Action items',
        config: {
          prompt:
            'Based on the themes, recommend specific improvements. Prioritize by impact and effort. Include supporting quotes.',
        },
      },
      {
        kind: 'output',
        label: 'Report',
        description: 'Feedback report',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4 },
    ],
  },

  // ── More AI Patterns ─────────────────────────────────────────────────────

  {
    id: 'tpl-rag-pipeline',
    name: 'RAG Pipeline',
    description: 'Retrieval-augmented generation: search memory, augment context, generate.',
    category: 'ai',
    tags: ['rag', 'memory', 'retrieval', 'augmented'],
    icon: 'search_insights',
    nodes: [
      { kind: 'trigger', label: 'User Query', description: 'Incoming question', config: {} },
      {
        kind: 'tool',
        label: 'Search Memory',
        description: 'Vector + BM25',
        config: { prompt: 'Search the memory palace for relevant context using the query' },
      },
      {
        kind: 'data',
        label: 'Rank & Filter',
        description: 'MMR re-ranking',
        config: {
          transform:
            'Re-rank results by relevance. Filter to top 5 most relevant chunks. Deduplicate.',
        },
      },
      {
        kind: 'agent',
        label: 'Generate Answer',
        description: 'Augmented response',
        config: {
          prompt:
            'Answer the query using the retrieved context. Cite specific memory entries. If context is insufficient, say so.',
        },
      },
      {
        kind: 'output',
        label: 'Response',
        description: 'With citations',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4 },
    ],
  },

  {
    id: 'tpl-skill-builder',
    name: 'Skill Builder',
    description: 'Agent creates, tests, and installs new skills automatically.',
    category: 'ai',
    tags: ['skills', 'skill', 'generate', 'foundry'],
    icon: 'build',
    nodes: [
      {
        kind: 'trigger',
        label: 'Skill Request',
        description: 'User describes capability',
        config: {},
      },
      {
        kind: 'agent',
        label: 'Design Skill',
        description: 'Plan SKILL.md',
        config: {
          prompt:
            'Design the skill: identify required tools, credentials, instructions, and example prompts. Plan the SKILL.md structure.',
        },
      },
      {
        kind: 'agent',
        label: 'Write Skill',
        description: 'Generate SKILL.md',
        config: {
          prompt:
            'Write the complete SKILL.md file with clear instructions, tool definitions, and usage examples.',
        },
      },
      {
        kind: 'agent',
        label: 'Test Skill',
        description: 'Dry run',
        config: {
          prompt:
            'Test the skill by running through the example prompts. Verify the instructions are clear and the tools work.',
        },
      },
      {
        kind: 'condition',
        label: 'Tests Pass?',
        config: { conditionExpr: 'Did the skill tests pass?' },
      },
      {
        kind: 'output',
        label: 'Install',
        description: 'Save to skills/',
        config: { outputTarget: 'store' },
      },
      {
        kind: 'output',
        label: 'Fix Issues',
        description: 'Iterate',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4 },
      { fromIdx: 4, toIdx: 5, label: 'Pass' },
      { fromIdx: 4, toIdx: 6, label: 'Fail' },
    ],
  },

  {
    id: 'tpl-translation-pipeline',
    name: 'Translation Pipeline',
    description: 'Translate content through multiple passes for quality.',
    category: 'ai',
    tags: ['translation', 'i18n', 'language', 'localization'],
    icon: 'translate',
    nodes: [
      { kind: 'trigger', label: 'Source Text', description: 'Input content', config: {} },
      {
        kind: 'agent',
        label: 'Translate',
        description: 'First pass',
        config: {
          prompt:
            'Translate the text to the target language. Preserve meaning, tone, and technical terms.',
        },
      },
      {
        kind: 'agent',
        label: 'Back-Translate',
        description: 'Quality check',
        config: {
          prompt: 'Translate back to the original language. This is for quality verification.',
        },
      },
      {
        kind: 'agent',
        label: 'Compare & Fix',
        description: 'Resolve differences',
        config: {
          prompt:
            'Compare original and back-translation. Fix any semantic drift in the target translation.',
        },
      },
      {
        kind: 'output',
        label: 'Final Translation',
        description: 'Verified output',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4 },
    ],
  },

  // ── Phase 4: AI Superpowers Templates ────────────────────────────────────

  {
    id: 'tpl-squad-research',
    name: 'Squad Research Team',
    description:
      'A multi-agent squad collaborates to research a topic and produce a comprehensive report.',
    category: 'ai',
    tags: ['squad', 'research', 'multi-agent', 'collaboration'],
    icon: 'groups',
    nodes: [
      {
        kind: 'trigger',
        label: 'Research Topic',
        description: 'User provides topic',
        config: { prompt: 'Enter a research topic or question' },
      },
      {
        kind: 'memory-recall' as 'trigger',
        label: 'Recall Prior Research',
        description: 'Check for existing knowledge',
        config: { memoryQuerySource: 'input', memoryLimit: 5, memoryOutputFormat: 'text' },
      },
      {
        kind: 'squad' as 'trigger',
        label: 'Research Squad',
        description: 'Multi-agent research team',
        config: {
          squadObjective: 'Research the topic thoroughly, considering multiple perspectives',
          squadMaxRounds: 5,
        },
      },
      {
        kind: 'memory' as 'trigger',
        label: 'Save Findings',
        description: 'Store research results',
        config: { memorySource: 'output', memoryCategory: 'insight', memoryImportance: 0.8 },
      },
      {
        kind: 'output',
        label: 'Research Report',
        description: 'Deliver findings',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4 },
    ],
  },

  {
    id: 'tpl-memory-qa',
    name: 'Memory-Augmented Q&A',
    description: 'Answer questions using long-term memory for context, then store new insights.',
    category: 'ai',
    tags: ['memory', 'question-answering', 'context', 'learning'],
    icon: 'manage_search',
    nodes: [
      {
        kind: 'trigger',
        label: 'User Question',
        description: 'Incoming question',
        config: { prompt: 'User asks a question' },
      },
      {
        kind: 'memory-recall' as 'trigger',
        label: 'Recall Context',
        description: 'Search memory',
        config: {
          memoryQuerySource: 'input',
          memoryLimit: 10,
          memoryThreshold: 0.3,
          memoryOutputFormat: 'text',
        },
      },
      {
        kind: 'agent',
        label: 'Answer with Context',
        description: 'Generate informed answer',
        config: {
          prompt:
            "Answer the user's question using the recalled context above. Cite specific memories when relevant. If no relevant memories exist, answer from general knowledge.",
        },
      },
      {
        kind: 'memory' as 'trigger',
        label: 'Save Insight',
        description: 'Remember this Q&A',
        config: { memorySource: 'output', memoryCategory: 'fact', memoryImportance: 0.6 },
      },
      {
        kind: 'output',
        label: 'Send Answer',
        description: 'Deliver to user',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4 },
    ],
  },

  {
    id: 'tpl-self-healing-pipeline',
    name: 'Self-Healing Data Pipeline',
    description: 'Fetch data from an API with automatic error recovery and retries.',
    category: 'ai',
    tags: ['self-healing', 'api', 'pipeline', 'error-recovery'],
    icon: 'healing',
    nodes: [
      {
        kind: 'trigger',
        label: 'Schedule / Event',
        description: 'Pipeline trigger',
        config: { prompt: 'Pipeline triggered' },
      },
      {
        kind: 'http' as 'trigger',
        label: 'Fetch Data',
        description: 'API request with retry',
        config: {
          httpMethod: 'GET',
          httpUrl: 'https://api.example.com/data',
          maxRetries: 3,
          retryDelayMs: 2000,
          selfHealEnabled: true,
        },
      },
      {
        kind: 'code' as 'trigger',
        label: 'Transform',
        description: 'Parse & clean data',
        config: {
          code: '// Transform the API response\nconst data = JSON.parse(input);\nreturn JSON.stringify(data.results || data, null, 2);',
        },
      },
      {
        kind: 'condition',
        label: 'Valid Data?',
        description: 'Check quality',
        config: { conditionExpr: 'input.length > 10' },
      },
      {
        kind: 'memory' as 'trigger',
        label: 'Cache Result',
        description: 'Store for later use',
        config: { memorySource: 'output', memoryCategory: 'task_result', memoryImportance: 0.7 },
      },
      {
        kind: 'output',
        label: 'Pipeline Result',
        description: 'Deliver data',
        config: { outputTarget: 'store' },
      },
      {
        kind: 'error',
        label: 'Log Failure',
        description: 'Handle pipeline errors',
        config: { errorTargets: ['log', 'toast'] },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2 },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4, label: 'true' },
      { fromIdx: 4, toIdx: 5 },
      { fromIdx: 3, toIdx: 6, label: 'false' },
    ],
  },

  // ── Convergent Mesh Templates ──────────────────────────────────────────

  {
    id: 'tpl-agent-debate',
    name: 'Agent Debate',
    description: 'Two agents argue opposing viewpoints until they converge on a consensus answer.',
    category: 'ai',
    tags: ['debate', 'mesh', 'bidirectional', 'convergent', 'consensus'],
    icon: 'forum',
    nodes: [
      {
        kind: 'trigger',
        label: 'Topic Input',
        description: 'Question or topic',
        config: { prompt: 'Provide a topic or question for the debate' },
      },
      {
        kind: 'agent',
        label: 'Advocate',
        description: 'Argues FOR',
        config: {
          prompt:
            "You argue IN FAVOUR of the proposition. Read the other agent's latest rebuttal and refine your argument. Be rigorous and cite evidence.",
        },
      },
      {
        kind: 'agent',
        label: 'Critic',
        description: 'Argues AGAINST',
        config: {
          prompt:
            "You argue AGAINST the proposition. Read the other agent's latest argument and provide a counter-argument. Be rigorous and cite evidence.",
        },
      },
      {
        kind: 'condition',
        label: 'Consensus?',
        config: {
          conditionExpr: 'Both agents agree or max rounds reached',
        },
      },
      {
        kind: 'output',
        label: 'Verdict',
        description: 'Final synthesis',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 0, toIdx: 2 },
      { fromIdx: 1, toIdx: 2, kind: 'bidirectional' as const },
      { fromIdx: 1, toIdx: 3 },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4, label: 'Yes' },
      { fromIdx: 3, toIdx: 1, label: 'No', kind: 'reverse' as const },
    ],
  },

  {
    id: 'tpl-draft-review-loop',
    name: 'Draft & Review Loop',
    description:
      'A writer agent drafts content while an editor agent reviews and requests revisions in a convergent loop.',
    category: 'ai',
    tags: ['review', 'loop', 'mesh', 'bidirectional', 'editing', 'writing'],
    icon: 'rate_review',
    nodes: [
      {
        kind: 'trigger',
        label: 'Brief',
        description: 'Writing brief',
        config: { prompt: 'Provide the writing brief or topic' },
      },
      {
        kind: 'agent',
        label: 'Writer',
        description: 'Drafts content',
        config: {
          prompt:
            'Write or revise the content based on the brief and any editor feedback. Produce a complete draft.',
        },
      },
      {
        kind: 'agent',
        label: 'Editor',
        description: 'Reviews & critiques',
        config: {
          prompt:
            "Review the writer's draft for clarity, accuracy, tone, and completeness. Return specific revision requests or approve.",
        },
      },
      {
        kind: 'condition',
        label: 'Approved?',
        config: { conditionExpr: 'Editor approved the draft' },
      },
      {
        kind: 'output',
        label: 'Final Draft',
        description: 'Polished content',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2, kind: 'bidirectional' as const },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4, label: 'Yes' },
      { fromIdx: 3, toIdx: 1, label: 'Revise', kind: 'reverse' as const },
    ],
  },

  {
    id: 'tpl-self-correcting-pipeline',
    name: 'Self-Correcting Pipeline',
    description:
      'An agent produces output that a validator checks; failures loop back for correction until the output passes.',
    category: 'ai',
    tags: ['self-correcting', 'validation', 'mesh', 'bidirectional', 'loop', 'quality'],
    icon: 'auto_fix_high',
    nodes: [
      {
        kind: 'trigger',
        label: 'Task',
        description: 'Input task',
        config: { prompt: 'Describe the task to be completed with quality constraints' },
      },
      {
        kind: 'agent',
        label: 'Generator',
        description: 'Produces output',
        config: {
          prompt:
            'Generate or revise output for the given task. If validator feedback is provided, fix the identified issues.',
        },
      },
      {
        kind: 'agent',
        label: 'Validator',
        description: 'Checks quality',
        config: {
          prompt:
            'Validate the generator output against quality criteria. List specific issues if any, or approve if it meets all requirements.',
        },
      },
      {
        kind: 'condition',
        label: 'Passes?',
        config: { conditionExpr: 'Validator approved the output' },
      },
      {
        kind: 'output',
        label: 'Verified Output',
        description: 'Quality-assured result',
        config: { outputTarget: 'chat' },
      },
      {
        kind: 'error',
        label: 'Max Retries',
        description: 'Exceeded retry limit',
        config: { errorTargets: ['chat', 'log'] },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 1, toIdx: 2, kind: 'bidirectional' as const },
      { fromIdx: 2, toIdx: 3 },
      { fromIdx: 3, toIdx: 4, label: 'Pass' },
      { fromIdx: 3, toIdx: 1, label: 'Fix', kind: 'reverse' as const },
      { fromIdx: 3, toIdx: 5, label: 'Max retries', kind: 'error' as const },
    ],
  },

  // ── Tesseract Templates ────────────────────────────────────────────────

  {
    id: 'tpl-tesseract-research',
    name: 'Tesseract Research Pipeline',
    description:
      'Two independent research cells (exploration + analysis) operating in parallel, converging at an event horizon to synthesize findings.',
    category: 'ai',
    tags: ['tesseract', '4d', 'research', 'event-horizon', 'parallel-cells', 'convergent'],
    icon: 'blur_on',
    nodes: [
      {
        kind: 'trigger',
        label: 'Research Brief',
        description: 'Topic input',
        config: { prompt: 'Provide the research topic and objectives' },
      },
      {
        kind: 'agent',
        label: 'Explorer A',
        description: 'Domain search',
        config: {
          prompt:
            'Search and gather information from domain A. Iterate with your reviewer to improve coverage.',
          cellId: 'cell-explore',
          phase: 0,
        },
      },
      {
        kind: 'agent',
        label: 'Explorer B',
        description: 'Alt domain',
        config: {
          prompt:
            'Search and gather information from domain B independently. Iterate with your reviewer.',
          cellId: 'cell-explore',
          phase: 0,
        },
      },
      {
        kind: 'agent',
        label: 'Analyst',
        description: 'Pattern finder',
        config: {
          prompt:
            'Analyze available data for patterns, contradictions, and gaps. Debate findings with the critic.',
          cellId: 'cell-analyze',
          phase: 1,
        },
      },
      {
        kind: 'agent',
        label: 'Critic',
        description: 'Challenges findings',
        config: {
          prompt:
            'Challenge the analyst conclusions. Identify weak evidence, biases, and missing perspectives.',
          cellId: 'cell-analyze',
          phase: 1,
        },
      },
      {
        kind: 'event-horizon' as 'trigger',
        label: 'Synthesis Horizon',
        description: 'Cells converge',
        config: { mergePolicy: 'synthesize', phaseAfter: 2 },
      },
      {
        kind: 'agent',
        label: 'Synthesizer',
        description: 'Final report',
        config: {
          prompt:
            'Synthesize all research and analysis into a comprehensive, balanced report with citations.',
          phase: 2,
        },
      },
      {
        kind: 'output',
        label: 'Report',
        description: 'Final output',
        config: { outputTarget: 'chat' },
      },
    ],
    edges: [
      { fromIdx: 0, toIdx: 1 },
      { fromIdx: 0, toIdx: 2 },
      { fromIdx: 1, toIdx: 2, kind: 'bidirectional' as const },
      { fromIdx: 3, toIdx: 4, kind: 'bidirectional' as const },
      { fromIdx: 1, toIdx: 5 },
      { fromIdx: 2, toIdx: 5 },
      { fromIdx: 3, toIdx: 5 },
      { fromIdx: 4, toIdx: 5 },
      { fromIdx: 5, toIdx: 6 },
      { fromIdx: 6, toIdx: 7 },
    ],
  },
];
