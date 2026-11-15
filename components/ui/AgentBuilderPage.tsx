/**
 * AgentBuilderPage.tsx — Standalone, self-contained Agent Builder page component.
 *
 * Required npm packages in target project:
 *   npm install react react-dom motion lucide-react react-markdown @phosphor-icons/react @hugeicons/react @hugeicons/core-free-icons
 *
 * Usage:
 *   import AgentBuilderPage from './AgentBuilderPage';
 *   <AgentBuilderPage />
 */

'use client';

import React, {
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from 'motion/react';
import ReactMarkdown from 'react-markdown';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Key,
  Pencil,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Attachment01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChartLineData01Icon,
  File02Icon,
  Globe02Icon,
  Mail01Icon,
  Mic01Icon,
  PlusSignIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import LunarRoverScene from './LunarRoverScene';
import PlannerHudOverlay from './PlannerHudOverlay';
import LunaMascot from './LunaMascot';
import DecryptedText from './DecryptedText';
import IconSlidersVertical from './IconSlidersVertical';
import SpecularButton from './SpecularButton';
import nvidiaIconUrl from '../../src/assets/nvidia-icon.png';
import {
  missionPlannerStore,
  useMissionPlannerStore,
} from '../manual-planner/missionStore';
import {
  advanceDiscoveryConversation,
  buildCheckResultTurn,
  createInitialLunaDraft,
  formatAlternativesResponse,
  processFreeformLunaMessage,
  processPostCheckMessage,
  type LunaActionButton,
  type LunaBrainTurnResult,
  type LunaDraftState,
} from '../manual-planner/lunaPlannerBrain';
import {
  NEMOTRON_DISPLAY_NAME,
  NEMOTRON_MODEL_ID,
  NEMOTRON_MODEL_PAGE_URL,
  OPENROUTER_KEYS_URL,
  fetchServerAiStatus,
  type ServerAiStatus,
} from '../manual-planner/openrouterClient';

// ---------------------------------------------------------------------------
// Standalone Embedded Styles (DotGrid, StatusMark, PromptBar, AiLoader, Shimmer)
// ---------------------------------------------------------------------------
const STANDALONE_STYLES = `
/* DotGrid */
.dot-grid {
  position: relative;
  width: 100%;
  height: 100%;
}
.dot-grid__canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* StatusMark */
.status-mark {
  --sm-size: 20px;
  --sm-stroke: 2;
  --sm-color: currentColor;
  --sm-done: #22c55e;
  --sm-error: #ef4444;
  --sm-fill: 0.06;
  --sm-font: 14px;
  --sm-draw: 240ms;
  --sm-strike-delay: 180ms;
  --sm-muted: 0.55;
  --sm-check-delay: 120ms;
  --sm-label-o: 0.65;
  --sm-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --sm-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);

  position: relative;
  display: inline-flex;
  align-items: center;
  gap: calc(var(--sm-size) * 0.5);
  vertical-align: middle;
  line-height: 1;
}
.status-mark__glyph {
  flex: none;
  overflow: visible;
  color: var(--sm-color);
  transition: color 200ms ease;
}
.status-mark[data-status='done'] .status-mark__glyph { color: var(--sm-done); }
.status-mark[data-status='failed'] .status-mark__glyph { color: var(--sm-error); }
.status-mark__track {
  fill: currentColor;
  stroke: currentColor;
  stroke-width: var(--sm-stroke);
  fill-opacity: 0;
  stroke-opacity: 0;
  transition: fill-opacity 180ms ease, stroke-opacity 200ms ease;
}
.status-mark[data-status='running'] .status-mark__track { stroke-opacity: 0.2; }
.status-mark[data-status='done'] .status-mark__track,
.status-mark[data-status='failed'] .status-mark__track { fill-opacity: var(--sm-fill); }
.status-mark__ring {
  fill: none;
  stroke: currentColor;
  stroke-width: var(--sm-stroke);
  stroke-linecap: round;
  opacity: var(--sm-muted);
  transition: opacity 200ms ease;
}
.status-mark[data-status='done'] .status-mark__ring,
.status-mark[data-status='failed'] .status-mark__ring { opacity: 1; }
.status-mark__check {
  fill: none;
  stroke: var(--sm-done);
  stroke-width: var(--sm-stroke);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset var(--sm-draw) var(--sm-ease-out) var(--sm-check-delay);
}
.status-mark[data-status='done'] .status-mark__check { stroke-dashoffset: 0; }
.status-mark__cross {
  fill: none;
  stroke: var(--sm-error);
  stroke-width: var(--sm-stroke);
  stroke-linecap: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset var(--sm-draw) var(--sm-ease-out);
}
.status-mark[data-status='failed'] .status-mark__cross { stroke-dashoffset: 0; }
.status-mark[data-status='cancelled'] .status-mark__cross {
  stroke: var(--sm-color);
  stroke-dashoffset: 0;
}
.status-mark__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
.status-mark__label {
  position: relative;
  font-size: var(--sm-font);
  color: var(--sm-color);
  transition: opacity 200ms ease;
  user-select: none;
}
.status-mark[data-status='done'] .status-mark__label,
.status-mark[data-status='cancelled'] .status-mark__label { opacity: var(--sm-label-o); }
.status-mark__strike {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background-color: currentColor;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--sm-draw) var(--sm-ease-out) var(--sm-strike-delay);
  pointer-events: none;
}
.status-mark[data-strike][data-status='done'] .status-mark__strike,
.status-mark[data-strike][data-status='cancelled'] .status-mark__strike { transform: scaleX(1); }

/* PromptBar */
.prompt-bar {
  --pb-bg: #27272a;
  --pb-ink: #f5f5f5;
  --pb-menu: #323236;
  --pb-w: 400px;
  --pb-radius: 16px;
  --pb-press: 0.96;
  --pb-spark: #b39dff;
  --pb-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --pb-muted: color-mix(in srgb, var(--pb-ink) 55%, transparent);
  --pb-hover: color-mix(in srgb, var(--pb-ink) 8%, transparent);

  position: relative;
  width: min(var(--pb-w), 100%);
  color: var(--pb-ink);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
}
.prompt-bar__menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 2;
  padding: 4px;
  border-radius: 12px;
  background: var(--pb-menu);
  box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.08);
  transform-origin: bottom center;
  animation: prompt-bar-pop 180ms var(--pb-ease-out) both;
}
@keyframes prompt-bar-pop {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
}
.prompt-bar__glow {
  position: absolute;
  right: 4px;
  left: 4px;
  border-radius: 8px;
  background: var(--pb-hover);
  opacity: 0;
  pointer-events: none;
  transition: top 220ms var(--pb-ease-out), height 220ms var(--pb-ease-out), opacity 150ms ease;
}
.prompt-bar__row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}
.prompt-bar__row-icon {
  display: inline-flex;
  flex: none;
  justify-content: center;
  width: 20px;
  color: color-mix(in srgb, var(--pb-ink) 70%, transparent);
}
.prompt-bar__row-name { flex: none; font-size: 13px; font-weight: 500; }
.prompt-bar__row-desc {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--pb-muted);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.prompt-bar__row-tag { flex: none; margin-left: auto; color: var(--pb-muted); font-size: 11px; }
.prompt-bar__row-check { display: inline-flex; flex: none; justify-content: center; width: 16px; opacity: 0; }
.prompt-bar__row-check[data-on] { opacity: 1; }
.prompt-bar__empty {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  color: var(--pb-muted);
  font-size: 12px;
}
.prompt-bar__field {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 94px;
  gap: 14px;
  padding: 15px 12px;
  border-radius: var(--pb-radius);
  background: var(--pb-bg);
  cursor: text;
}
.prompt-bar__field::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: radial-gradient(140% 120% at 0% 100%, color-mix(in srgb, var(--pb-spark) 26%, transparent), transparent 62%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 500ms ease;
}
.prompt-bar__field[data-max]::before { opacity: 1; }
.prompt-bar__sparks {
  position: absolute;
  inset: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  pointer-events: none;
}
.prompt-bar__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.prompt-bar__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 4px 0 8px;
  border-radius: 8px;
  background: var(--pb-hover);
  font-size: 12px;
  animation: prompt-bar-pop 200ms var(--pb-ease-out) both;
}
.prompt-bar__chip-name { max-width: 144px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.prompt-bar__chip-x {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  outline: none;
  transition: opacity 120ms ease, background-color 120ms ease;
}
.prompt-bar__chip-x:hover { background: color-mix(in srgb, var(--pb-ink) 10%, transparent); opacity: 1; }
.prompt-bar__input {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  resize: none;
  outline: none;
  overflow-wrap: anywhere;
}
.prompt-bar__input::placeholder { color: color-mix(in srgb, var(--pb-ink) 45%, transparent); }
@media (pointer: coarse) { .prompt-bar__input { font-size: 16px; } }
.prompt-bar__bar { display: flex; align-items: center; gap: 4px; }
.prompt-bar__spacer { flex: 1 1 auto; }
.prompt-bar__tool,
.prompt-bar__send {
  flex: none;
  border: 0;
  font: inherit;
  cursor: pointer;
  outline: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.prompt-bar__tool {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--pb-ink) 60%, transparent);
  transition: background-color 150ms ease, color 150ms ease, transform 160ms var(--pb-ease-out);
}
.prompt-bar__tool:active { transform: scale(0.94); }
.prompt-bar__model-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--pb-ink) 70%, transparent);
  font-size: 12px;
  font-weight: 500;
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}
.prompt-bar__pick-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 14px;
  height: 14px;
}
.prompt-bar__tool[data-on] { background: var(--pb-hover); color: var(--pb-ink); }
@media (hover: hover) and (pointer: fine) {
  .prompt-bar__tool:hover { background: var(--pb-hover); color: var(--pb-ink); }
}
.prompt-bar__eq { display: flex; align-items: center; gap: 2.5px; height: 14px; }
.prompt-bar__eq i {
  display: block;
  width: 2.5px;
  height: 100%;
  border-radius: 999px;
  background: currentColor;
  transform-origin: center;
  animation: prompt-bar-eq 900ms ease-in-out infinite;
}
.prompt-bar__eq i:nth-child(2) { animation-delay: 150ms; }
.prompt-bar__eq i:nth-child(3) { animation-delay: 300ms; }
@keyframes prompt-bar-eq {
  0%, 100% { transform: scaleY(0.35); }
  50% { transform: scaleY(1); }
}
.prompt-bar__send {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  background: color-mix(in srgb, var(--pb-ink) 12%, var(--pb-bg));
  color: color-mix(in srgb, var(--pb-ink) 55%, var(--pb-bg));
  transition: background-color 200ms ease, color 200ms ease, transform 160ms var(--pb-ease-out);
}
.prompt-bar__send:disabled { cursor: default; }
.prompt-bar__send[data-armed] { background: var(--pb-ink); color: var(--pb-bg); }
.prompt-bar__send[data-pressed] { transform: scale(var(--pb-press)); }
.prompt-bar__glyph { display: block; width: 16px; height: 16px; transform-origin: 50% 50%; }

/* AiLoader & Builder Animations */
@keyframes aiThinkingShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@keyframes lunaGreetingRwbShimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.luna-greeting-row-shimmer {
  display: inline-block;
  white-space: nowrap;
  background-image: linear-gradient(
    105deg,
    #e3e3e3 0%,
    #e3e3e3 33%,
    #fc3d21 40%,
    #ffffff 50%,
    #3b82f6 60%,
    #e3e3e3 67%,
    #e3e3e3 100%
  );
  background-size: 300% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation-name: lunaGreetingRwbShimmer;
  animation-timing-function: linear;
  animation-iteration-count: 1;
  animation-fill-mode: both;
}
.shimmer-text {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.35) 0%,
    rgba(255, 255, 255, 0.65) 30%,
    #ffffff 50%,
    rgba(255, 255, 255, 0.65) 70%,
    rgba(255, 255, 255, 0.35) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: aiThinkingShimmer 3.05s linear infinite;
  display: inline-block;
}
@keyframes loaderCircle {
  0% {
    transform: rotate(90deg);
    box-shadow:
      0 6px 12px 0 rgba(13, 161, 178, 0.4) inset,
      0 12px 18px 0 rgba(13, 161, 178, 0.6) inset,
      0 36px 36px 0 rgba(13, 161, 178, 0.8) inset,
      0 0 3px 1.2px rgba(13, 161, 178, 0.3),
      0 0 6px 1.8px rgba(13, 161, 178, 0.2);
  }
  50% {
    transform: rotate(270deg);
    box-shadow:
      0 6px 12px 0 rgba(13, 161, 178, 0.6) inset,
      0 12px 6px 0 rgba(13, 161, 178, 0.4) inset,
      0 24px 36px 0 rgba(13, 161, 178, 0.8) inset,
      0 0 3px 1.2px rgba(13, 161, 178, 0.3),
      0 0 6px 1.8px rgba(13, 161, 178, 0.2);
  }
  100% {
    transform: rotate(450deg);
    box-shadow:
      0 6px 12px 0 rgba(13, 161, 178, 0.4) inset,
      0 12px 18px 0 rgba(13, 161, 178, 0.6) inset,
      0 36px 36px 0 rgba(13, 161, 178, 0.8) inset,
      0 0 3px 1.2px rgba(13, 161, 178, 0.3),
      0 0 6px 1.8px rgba(13, 161, 178, 0.2);
  }
}
.chat-scrollbar-hidden::-webkit-scrollbar {
  width: 0px;
  height: 0px;
  background: transparent;
  opacity: 0;
}
.chat-scrollbar-hidden {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
`;

// ---------------------------------------------------------------------------
// Types & Default Agent Data
// ---------------------------------------------------------------------------
export type StatusMarkStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface AgentBuilderTool {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
}

export interface AgentBuilderData {
  id?: string;
  title: string;
  category: string;
  description: string;
  prompt: string;
  tools?: AgentBuilderTool[];
  icons?: React.ComponentType<{ className?: string }>[];
  dotColor1?: string;
  dotColor2?: string;
}

export const DEFAULT_AGENT_BUILDER_DATA: AgentBuilderData = {
  id: 'planner',
  title: 'Planner',
  category: 'Sales Execution',
  description: 'A cold calling agent to automate outreach and qualify leads.',
  prompt:
    "Hi I'm Luna, your mission planner guide. I help you evaluate landing sites, launch dates, power margins, and direct to Earth communication. Select an option below to continue.",
  dotColor1: '#0da1b2',
  dotColor2: '#0da1b2',
};

interface QuestionCardData {
  title: string;
  options: { id: string; label: string }[];
  allowCustom?: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isInitialGreeting?: boolean;
  reasoning?: string;
  modelLabel?: string;
  planStatus?: string;
  tasksCount?: string;
  questionPendingText?: string;
  questionCard?: QuestionCardData;
  actions?: LunaActionButton[];
  timestamp: number;
  tasks?: { id: string; label: string; status: StatusMarkStatus; progress?: number }[];
}

interface ByokModelOption {
  id: string;
  name: string;
  provider: string;
  tag: string;
  placeholder: string;
  keyPrefixNotice: string;
  description: string;
  helpUrl: string;
}

const BYOK_MODELS: ByokModelOption[] = [
  {
    id: NEMOTRON_MODEL_ID,
    name: NEMOTRON_DISPLAY_NAME,
    provider: 'OpenRouter · NVIDIA',
    tag: 'Default · OpenRouter Free (550B)',
    placeholder: 'sk-or-v1-...',
    keyPrefixNotice: 'Starts with sk-or- (or set $OPENROUTER_API_KEY in .env.local)',
    description:
      'NVIDIA Nemotron 3 Ultra (550B A55B) via OpenRouter — powers Luna mission reasoning, streaming analysis, and NASA tool execution.',
    helpUrl: OPENROUTER_KEYS_URL,
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    tag: 'Recommended for Workflows',
    placeholder: 'sk-ant-api03-...',
    keyPrefixNotice: 'Starts with sk-ant-',
    description: 'Industry-leading reasoning and structured agent execution with nuanced instruction following.',
    helpUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'claude-3-opus',
    name: 'Claude 3 Opus',
    provider: 'Anthropic',
    tag: 'Deep Reasoning & Synthesis',
    placeholder: 'sk-ant-api03-...',
    keyPrefixNotice: 'Starts with sk-ant-',
    description: 'High-capability foundational model for complex multi-step reasoning, extensive analysis, and comprehensive writing.',
    helpUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    provider: 'OpenAI',
    tag: 'Flagship Astra Intelligence',
    placeholder: 'sk-proj-...',
    keyPrefixNotice: 'Starts with sk-proj- or sk-',
    description: 'Next-generation flagship intelligence with deep multimodal synthesis and reliable autonomous tool execution.',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gpt-6-1-sol',
    name: 'GPT-6.1 Sol',
    provider: 'OpenAI',
    tag: 'Next-Gen Sol Architecture',
    placeholder: 'sk-proj-...',
    keyPrefixNotice: 'Starts with sk-proj- or sk-',
    description: 'High-throughput ultra-low-latency model built for rapid agent coordination, real-time reasoning, and instant responses.',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini-1-5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'Google DeepMind',
    tag: '2M Context Window',
    placeholder: 'AIzaSy...',
    keyPrefixNotice: 'Starts with AIzaSy',
    description: 'Massive context window for analyzing deep account history, long transcripts, and complex CRM tables.',
    helpUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    tag: 'Flagship Reasoning (R1)',
    placeholder: 'sk-...',
    keyPrefixNotice: 'Starts with sk-',
    description: 'Advanced open reasoning model with state-of-the-art chain-of-thought analysis and problem-solving.',
    helpUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    provider: 'Perplexity',
    tag: 'Real-time Web Search & Synthesis',
    placeholder: 'pplx-...',
    keyPrefixNotice: 'Starts with pplx-',
    description: 'Real-time web-grounded research, multi-source intelligence, and live factual synthesis.',
    helpUrl: 'https://www.perplexity.ai/settings/api',
  },
];

// ---------------------------------------------------------------------------
// StatusMark Parser & Guidelines
// ---------------------------------------------------------------------------
interface ParsedStatusMark {
  status: StatusMarkStatus;
  progress?: number;
  label: string;
  originalText: string;
}

function parseStatusMarkLine(line: string): ParsedStatusMark | null {
  const trimmed = line.trim();
  const tokenMatch = trimmed.match(/^\[STATUS:([a-zA-Z]+)(?::([0-9.]+))?\]\s*(.*)$/i);
  if (tokenMatch) {
    const rawStatus = tokenMatch[1].toLowerCase();
    const progressVal = tokenMatch[2] ? parseFloat(tokenMatch[2]) : undefined;
    const label = tokenMatch[3].trim();

    let status: StatusMarkStatus = 'pending';
    if (rawStatus === 'running' || rawStatus === 'in_progress' || rawStatus === 'active') status = 'running';
    else if (rawStatus === 'done' || rawStatus === 'completed' || rawStatus === 'success') status = 'done';
    else if (rawStatus === 'failed' || rawStatus === 'error') status = 'failed';
    else if (rawStatus === 'cancelled' || rawStatus === 'canceled' || rawStatus === 'stopped') status = 'cancelled';

    return { status, progress: progressVal, label, originalText: line };
  }

  const mdMatch = trimmed.match(/^[-*]\s*\[([ xX/!~-])(?:\s*(\d+)%)?\]\s*(.*)$/);
  if (mdMatch) {
    const mark = mdMatch[1];
    const pct = mdMatch[2] ? parseInt(mdMatch[2], 10) / 100 : undefined;
    const label = mdMatch[3].trim();

    let status: StatusMarkStatus = 'pending';
    if (mark === '/' || mark === '~') status = 'running';
    else if (mark === 'x' || mark === 'X') status = 'done';
    else if (mark === '!') status = 'failed';
    else if (mark === '-') status = 'cancelled';

    return { status, progress: pct, label, originalText: line };
  }

  return null;
}

const STATUS_MARK_AGENT_GUIDELINES = `
Use StatusMark markdown syntax for task steps:
- \`- [ ] Task\` (pending)
- \`- [/] Task\` (running)
- \`- [/ 65%] Task\` (running with progress)
- \`- [x] Task\` (done)
- \`- [!] Task\` (failed)
- \`- [-] Task\` (cancelled)
`;

const extractNodeText = (node: ReactNode): string => {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractNodeText).join('');
  if (React.isValidElement(node) && (node.props as { children?: ReactNode })?.children) {
    return extractNodeText((node.props as { children?: ReactNode }).children);
  }
  return '';
};

// ---------------------------------------------------------------------------
// Inlined Subcomponents: AgentDotIcon, AiLoader, DotGrid, StatusMark, PromptBar
// ---------------------------------------------------------------------------
const AGENT_BASE_OPACITY = 0.22;
const P1_SWEEP_CYCLE_MS = 3060;
const P1_CYCLES = 3;
const DURATION_PHASE_1 = P1_CYCLES * P1_SWEEP_CYCLE_MS;
const P2_SWEEP_1_MS = 1970;
const P2_SWEEP_2_MS = 1970;
const DURATION_PHASE_2 = P2_SWEEP_1_MS + P2_SWEEP_2_MS;
const TOTAL_SEQUENCE_MS = DURATION_PHASE_1 + DURATION_PHASE_2;

const AgentDotIcon = ({
  primaryColor = '#0da1b2',
  isHovered = false,
  alwaysPlay = false,
}: {
  primaryColor?: string;
  secondaryColor?: string;
  isHovered?: boolean;
  alwaysPlay?: boolean;
}) => {
  const isRunning = alwaysPlay || isHovered;
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      setElapsedMs(0);
      return;
    }
    let animId: number;
    let lastTime = performance.now();
    let accumulated = 0;

    const loop = (now: number) => {
      const dt = now - lastTime;
      lastTime = now;
      accumulated = (accumulated + dt) % TOTAL_SEQUENCE_MS;
      setElapsedMs(accumulated);
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isRunning]);

  const opacities = useMemo(() => {
    const result = Array<number>(16).fill(AGENT_BASE_OPACITY);
    if (!isRunning) return result;

    let t = elapsedMs;
    if (t < DURATION_PHASE_1) {
      const cycleTime = t % P1_SWEEP_CYCLE_MS;
      const halfCycle = P1_SWEEP_CYCLE_MS / 2;
      const waveCol =
        cycleTime < halfCycle
          ? -0.6 + (cycleTime / halfCycle) * 4.2
          : 3.6 - ((cycleTime - halfCycle) / halfCycle) * 4.2;

      for (let idx = 0; idx < 16; idx++) {
        const col = idx % 4;
        const wave = Math.max(0, 1 - Math.abs(col - waveCol) / 1.25);
        result[idx] = AGENT_BASE_OPACITY + Math.sin(wave * (Math.PI / 2)) * (1.0 - AGENT_BASE_OPACITY);
      }
      return result;
    }

    t -= DURATION_PHASE_1;
    if (t < DURATION_PHASE_2) {
      if (t < P2_SWEEP_1_MS) {
        const waveCoord = 3.8 - (t / P2_SWEEP_1_MS) * 7.6;
        for (let idx = 0; idx < 16; idx++) {
          const row = Math.floor(idx / 4);
          const col = idx % 4;
          const wave = Math.max(0, 1 - Math.abs(col - row - waveCoord) / 1.4);
          result[idx] = AGENT_BASE_OPACITY + Math.sin(wave * (Math.PI / 2)) * (1.0 - AGENT_BASE_OPACITY);
        }
        return result;
      }
      const subT = t - P2_SWEEP_1_MS;
      const waveCoord = -0.4 + (subT / P2_SWEEP_2_MS) * 4.0;
      for (let idx = 0; idx < 16; idx++) {
        const row = Math.floor(idx / 4);
        const col = idx % 4;
        const wave = Math.max(0, 1 - Math.abs(row + col * 0.35 - waveCoord) / 1.35);
        result[idx] = AGENT_BASE_OPACITY + Math.sin(wave * (Math.PI / 2)) * (1.0 - AGENT_BASE_OPACITY);
      }
      return result;
    }

    return result;
  }, [elapsedMs, isRunning]);

  return (
    <div className="w-7 h-7 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 16 16" className="w-full h-full overflow-visible">
        {Array.from({ length: 16 }).map((_, idx) => {
          const row = Math.floor(idx / 4);
          const col = idx % 4;
          const opacity = opacities[idx] ?? AGENT_BASE_OPACITY;
          const isBright = opacity > 0.6;
          return (
            <circle
              key={idx}
              cx={2 + col * 4}
              cy={2 + row * 4}
              r={1.45}
              fill={primaryColor}
              className="transition-all duration-150 ease-linear"
              style={{
                opacity,
                filter: isBright ? `drop-shadow(0 0 3px ${primaryColor})` : 'none',
              }}
            />
          );
        })}
      </svg>
    </div>
  );
};

const AiLoader: React.FC<{ size?: number; text?: string }> = ({
  size = 200,
  text = 'Setting up your plan',
}) => (
  <div className="flex items-center justify-center p-8">
    <div
      className="relative flex items-center justify-center font-sans select-none"
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 flex items-center justify-center z-10 text-[8px] uppercase tracking-widest font-semibold whitespace-nowrap px-4">
        <AnimatePresence mode="wait">
          <motion.span
            key={text}
            initial={{ opacity: 0, scale: 0.94, filter: 'blur(3px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.04, filter: 'blur(3px)' }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            className="shimmer-text inline-block text-center"
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </div>
      <div
        className="absolute inset-0 rounded-full"
        style={{ animation: 'loaderCircle 5s linear infinite' }}
      />
    </div>
  </div>
);

// WebGL2 Interactive DotGrid
const DOT_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aMotion;
layout(location = 2) in vec2 aState;
uniform vec2 uResolution;
uniform float uSize;
uniform float uSwell;
uniform float uStretch;
uniform float uGlow;
out vec2 vLocal;
out vec2 vPoint;
out float vLength;
out float vRadius;
out float vEnergy;
void main() {
  float energy = aState.x;
  float radius = 0.5 * uSize * aState.y * (1.0 + uSwell * energy);
  float speed = length(aMotion.zw);
  float angle = speed > 0.001 ? atan(aMotion.w, aMotion.z) : 0.0;
  float axis = floor(angle / 1.5707963 + 0.5) * 1.5707963;
  angle = axis + (angle - axis) * smoothstep(8.0, 70.0, speed);
  vec2 dir = vec2(cos(angle), sin(angle));
  float halfLength = min(uSize * 2.0, speed * uStretch * 0.02);
  float pad = radius * (1.0 + uGlow * energy * 2.5) + 2.0;
  vec2 local = aCorner * vec2(halfLength + pad, pad);
  vec2 point = aMotion.xy + dir * local.x + vec2(-dir.y, dir.x) * local.y;
  vLocal = local;
  vPoint = point;
  vLength = halfLength;
  vRadius = radius;
  vEnergy = energy;
  vec2 clip = point / uResolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const DOT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vPoint;
in float vLength;
in float vRadius;
in float vEnergy;
uniform vec2 uResolution;
uniform vec3 uBase;
uniform vec3 uActive;
uniform float uGlow;
uniform float uOpacity;
uniform float uFade;
uniform int uShape;
out vec4 outColor;
float smootherstep01(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
void main() {
  float d;
  if (uShape == 1) {
    float corner = vRadius * 0.3;
    vec2 q = abs(vLocal) - vec2(vLength + vRadius, vRadius) + corner;
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
  } else {
    d = length(vec2(max(abs(vLocal.x) - vLength, 0.0), vLocal.y)) - vRadius;
  }
  float aa = max(fwidth(d), 0.0001);
  float body = clamp(0.5 - d / aa, 0.0, 1.0);
  float halo = uGlow * vEnergy * 0.5 * exp(-max(d, 0.0) / max(vRadius * 1.3, 0.6));
  float alpha = body + (1.0 - body) * halo;
  vec3 color = mix(uBase, uActive, clamp(vEnergy * 1.2, 0.0, 1.0));
  float fade = 1.0;
  if (uFade > 0.0) {
    vec2 edge = min(vPoint, uResolution - vPoint) / (uFade * 0.4 * min(uResolution.x, uResolution.y));
    fade = smootherstep01(edge.x) * smootherstep01(edge.y);
  }
  alpha *= uOpacity * fade;
  outColor = vec4(color * alpha, alpha);
}`;

interface DotGridProps {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  strength?: number;
  bounce?: number;
  tension?: number;
  returnDuration?: number;
  shockRadius?: number;
  shockStrength?: number;
  swell?: number;
  stretch?: number;
  glow?: number;
  shape?: 'circle' | 'square';
  fade?: number;
  opacity?: number;
  intro?: boolean;
  introLoops?: number;
  mouseInteraction?: boolean;
  clickShock?: boolean;
  paused?: boolean;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
}

const toRgb = (color: string): [number, number, number] => {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!match) return [1, 1, 1];
  const hex = match[1].length === 3 ? match[1].replace(/./g, digit => digit + digit) : match[1];
  return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number];
};

const smootherstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const backOut = (t: number) => {
  const s = 1.9;
  const x = t - 1;
  return 1 + x * x * ((s + 1) * x + s);
};

const compileShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type) as WebGLShader;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
};

const DotGrid: React.FC<DotGridProps> = ({
  dotSize = 5,
  gap = 18,
  baseColor = '#3a3446',
  activeColor = '#ffffff',
  proximity = 140,
  strength = 1,
  bounce = 0.6,
  tension = 0.4,
  returnDuration = 0.8,
  shockRadius = 320,
  shockStrength = 5,
  swell = 0.8,
  stretch = 0.5,
  glow = 0.5,
  shape = 'circle',
  fade = 0,
  opacity = 1,
  intro = true,
  introLoops = 1,
  mouseInteraction = true,
  clickShock = true,
  paused = false,
  dpr,
  className = '',
  style,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<{ rebuild: () => void; refresh: () => void } | null>(null);
  const settingsRef = useRef({
    dotSize,
    gap,
    baseColor,
    activeColor,
    proximity,
    strength,
    bounce,
    tension,
    returnDuration,
    shockRadius,
    shockStrength,
    swell,
    stretch,
    glow,
    shape,
    fade,
    opacity,
    intro,
    introLoops: Math.max(1, introLoops || 1),
    mouseInteraction,
    clickShock,
    paused,
    dpr,
  });
  settingsRef.current = {
    dotSize,
    gap,
    baseColor,
    activeColor,
    proximity,
    strength,
    bounce,
    tension,
    returnDuration,
    shockRadius,
    shockStrength,
    swell,
    stretch,
    glow,
    shape,
    fade,
    opacity,
    intro,
    introLoops: Math.max(1, introLoops || 1),
    mouseInteraction,
    clickShock,
    paused,
    dpr,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return;

    const program = gl.createProgram() as WebGLProgram;
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, DOT_VERTEX));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, DOT_FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of [
      'uResolution',
      'uSize',
      'uSwell',
      'uStretch',
      'uGlow',
      'uBase',
      'uActive',
      'uOpacity',
      'uFade',
      'uShape',
    ]) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const cornerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const view = { width: 0, height: 0, left: 0, top: 0, ratio: 1 };
    const grid = { count: 0, cols: 1, rows: 1, cell: 1, centerX: 0, centerY: 0, reach: 1 };
    let rest = new Float32Array(0);
    let offset = new Float32Array(0);
    let velocity = new Float32Array(0);
    let force = new Float32Array(0);
    let next = new Float32Array(0);
    let wave = new Float32Array(0);
    let energy = new Float32Array(0);
    let instances = new Float32Array(0);
    const pointer = { x: 0, y: 0, vx: 0, vy: 0, time: 0, inside: false, presence: 0 };
    const shocks: { x: number; y: number; start: number }[] = [];
    let introStart: number | null = settingsRef.current.intro && !reduced ? -1 : null;
    let introIteration = 0;
    const visible = true;
    let raf = 0;
    let last = 0;

    const rebuild = () => {
      introIteration = 0;
      const { dotSize: size, gap: spacing } = settingsRef.current;
      const cell = Math.max(2, size + spacing);
      const cols = Math.max(1, Math.floor((view.width + spacing) / cell));
      const rows = Math.max(1, Math.floor((view.height + spacing) / cell));
      const startX = (view.width - (cols * cell - spacing)) / 2 + size / 2;
      const startY = (view.height - (rows * cell - spacing)) / 2 + size / 2;
      const count = cols * rows;
      rest = new Float32Array(count * 2);
      offset = new Float32Array(count * 2);
      velocity = new Float32Array(count * 2);
      force = new Float32Array(count * 2);
      next = new Float32Array(count * 2);
      wave = new Float32Array(count * 4);
      energy = new Float32Array(count);
      instances = new Float32Array(count * 6);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = (row * cols + col) * 2;
          rest[index] = startX + col * cell;
          rest[index + 1] = startY + row * cell;
        }
      }
      Object.assign(grid, {
        count,
        cols,
        rows,
        cell,
        centerX: view.width / 2,
        centerY: view.height / 2,
        reach: Math.hypot(view.width, view.height) / 2,
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, instances.byteLength, gl.DYNAMIC_DRAW);
    };

    const render = (now: number) => {
      const s = settingsRef.current;
      const radius = Math.max(1, s.proximity);
      const introAge = introStart === null ? Infinity : introStart < 0 ? 0 : (now - introStart) / 1000;
      const introFront = introAge * grid.reach * 1.25;
      const introBand = grid.cell * 4;
      for (let i = 0; i < grid.count; i++) {
        const index = i * 2;
        const source = i * 4;
        const x = rest[index] + offset[index] + wave[source];
        const y = rest[index + 1] + offset[index + 1] + wave[source + 1];
        let glowing = energy[i];
        if (pointer.presence > 0.001) {
          const distance = Math.hypot(x - pointer.x, y - pointer.y);
          if (distance < radius)
            glowing = Math.max(glowing, smootherstep(1 - distance / radius) * 0.4 * pointer.presence);
        }
        let scale = 1;
        if (introStart !== null) {
          const distance = Math.hypot(rest[index] - grid.centerX, rest[index + 1] - grid.centerY);
          const appear = Math.min(1, Math.max(0, (introFront - distance) / introBand));
          if (introIteration === 0) {
            scale = appear >= 1 ? 1 : Math.max(0, backOut(appear));
            glowing = Math.max(glowing, Math.sin(appear * Math.PI) * 0.6);
          } else {
            const wavePulse = Math.sin(appear * Math.PI);
            scale = 1 + wavePulse * 0.35;
            glowing = Math.max(glowing, wavePulse * 0.7);
          }
        }
        const target = i * 6;
        instances[target] = x;
        instances[target + 1] = y;
        instances[target + 2] = velocity[index] + wave[source + 2];
        instances[target + 3] = velocity[index + 1] + wave[source + 3];
        instances[target + 4] = glowing;
        instances[target + 5] = scale;
      }
      const base = toRgb(s.baseColor);
      const accent = toRgb(s.activeColor);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.uniform2f(uniforms.uResolution, view.width, view.height);
      gl.uniform1f(uniforms.uSize, Math.max(0.5, s.dotSize));
      gl.uniform1f(uniforms.uSwell, reduced ? 0 : Math.max(0, s.swell));
      gl.uniform1f(uniforms.uStretch, reduced ? 0 : Math.max(0, s.stretch));
      gl.uniform1f(uniforms.uGlow, Math.max(0, s.glow));
      gl.uniform3f(uniforms.uBase, base[0], base[1], base[2]);
      gl.uniform3f(uniforms.uActive, accent[0], accent[1], accent[2]);
      gl.uniform1f(uniforms.uOpacity, Math.min(1, Math.max(0, s.opacity)));
      gl.uniform1f(uniforms.uFade, Math.min(1, Math.max(0, s.fade)));
      gl.uniform1i(uniforms.uShape, s.shape === 'square' ? 1 : 0);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, grid.count);
      gl.bindVertexArray(null);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(settingsRef.current.dpr ?? window.devicePixelRatio ?? 1, 2);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      Object.assign(view, { width, height, left: rect.left, top: rect.top, ratio });
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      rebuild();
      render(performance.now());
    };

    const step = (dt: number, now: number) => {
      const s = settingsRef.current;
      const motionVal = reduced ? 0 : 1;
      const zeta = 1 - 0.85 * Math.min(1, Math.max(0, s.bounce));
      const omega = 4 / (zeta * Math.max(0.2, s.returnDuration));
      const stiffness = omega * omega;
      const damping = 2 * zeta * omega;
      const radius = Math.max(1, s.proximity);
      const speed = Math.hypot(pointer.vx, pointer.vy);
      const drive = s.mouseInteraction && pointer.inside ? 6500 * Math.tanh(speed / 900) * s.strength * motionVal : 0;
      const dirX = speed > 0.001 ? pointer.vx / speed : 0;
      const dirY = speed > 0.001 ? pointer.vy / speed : 0;
      const width = grid.cell * 1.4;
      const travel = 650;
      const active = shocks.map(shock => {
        const front = ((now - shock.start) / 1000) * travel;
        const power = smootherstep(1 - front / Math.max(1, s.shockRadius));
        return { ...shock, front, amplitude: power * s.shockStrength * grid.cell * 0.24 * motionVal };
      });
      const coupling = (Math.max(0, s.tension) * 900) ** 2 / (grid.cell * grid.cell);
      const viscosity = Math.sqrt(coupling) * 0.06;
      const limit = Math.sqrt(stiffness + 8 * coupling) + damping + 8 * viscosity;
      const steps = Math.min(24, Math.max(1, Math.ceil(dt / Math.min(1 / 120, 1.2 / limit))));
      const h = dt / steps;
      for (let i = 0; i < grid.count; i++) {
        const index = i * 2;
        const rx = rest[index];
        const ry = rest[index + 1];
        let ax = 0;
        let ay = 0;
        if (drive > 0) {
          const ex = rx + offset[index] - pointer.x;
          const ey = ry + offset[index + 1] - pointer.y;
          const distance = Math.hypot(ex, ey);
          if (distance < radius) {
            const weight = smootherstep(1 - distance / radius) * drive;
            const nx = distance > 0.001 ? ex / distance : 0;
            const ny = distance > 0.001 ? ey / distance : 0;
            ax += weight * (dirX + nx * 0.6);
            ay += weight * (dirY + ny * 0.6);
          }
        }
        let wx = 0;
        let wy = 0;
        let wvx = 0;
        let wvy = 0;
        for (const shock of active) {
          if (shock.amplitude <= 0) continue;
          const ex = rx - shock.x;
          const ey = ry - shock.y;
          const distance = Math.hypot(ex, ey);
          const u = (distance - shock.front) / width;
          if (Math.abs(u) < 3 && distance > 0.001) {
            const nx = ex / distance;
            const ny = ey / distance;
            const profile = Math.exp(-u * u);
            const push = shock.amplitude * profile;
            const rate = ((shock.amplitude * 2 * u * profile) / width) * travel;
            wx += nx * push;
            wy += ny * push;
            wvx += nx * rate;
            wvy += ny * rate;
            ax += nx * push * stiffness * 0.35;
            ay += ny * push * stiffness * 0.35;
          }
        }
        force[index] = ax;
        force[index + 1] = ay;
        const target = i * 4;
        wave[target] = wx;
        wave[target + 1] = wy;
        wave[target + 2] = wvx;
        wave[target + 3] = wvy;
      }
      const { cols, rows } = grid;
      const stride = cols * 2;
      for (let n = 0; n < steps; n++) {
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const index = (row * cols + col) * 2;
            let ax = force[index] - stiffness * offset[index] - damping * velocity[index];
            let ay = force[index + 1] - stiffness * offset[index + 1] - damping * velocity[index + 1];
            if (coupling > 0) {
              let lx = -4 * offset[index];
              let ly = -4 * offset[index + 1];
              let mx = -4 * velocity[index];
              let my = -4 * velocity[index + 1];
              if (col > 0) {
                lx += offset[index - 2];
                ly += offset[index - 1];
                mx += velocity[index - 2];
                my += velocity[index - 1];
              }
              if (col < cols - 1) {
                lx += offset[index + 2];
                ly += offset[index + 3];
                mx += velocity[index + 2];
                my += velocity[index + 3];
              }
              if (row > 0) {
                lx += offset[index - stride];
                ly += offset[index - stride + 1];
                mx += velocity[index - stride];
                my += velocity[index - stride + 1];
              }
              if (row < rows - 1) {
                lx += offset[index + stride];
                ly += offset[index + stride + 1];
                mx += velocity[index + stride];
                my += velocity[index + stride + 1];
              }
              ax += coupling * lx + viscosity * mx;
              ay += coupling * ly + viscosity * my;
            }
            next[index] = velocity[index] + ax * h;
            next[index + 1] = velocity[index + 1] + ay * h;
          }
        }
        for (let i = 0; i < offset.length; i++) {
          velocity[i] = next[i];
          offset[i] += velocity[i] * h;
        }
      }
      for (let i = 0; i < grid.count; i++) {
        const index = i * 2;
        const target = i * 4;
        energy[i] = Math.min(
          1,
          (Math.hypot(velocity[index] + wave[target + 2], velocity[index + 1] + wave[target + 3]) / 380) * 0.85 +
          (Math.hypot(offset[index] + wave[target], offset[index + 1] + wave[target + 1]) / (grid.cell * 2.2)) * 0.35
        );
      }
      for (let i = shocks.length - 1; i >= 0; i--) {
        if (active[i].front > s.shockRadius + width * 3) shocks.splice(i, 1);
      }
      const decay = 1 - Math.exp(-dt / 0.08);
      pointer.vx -= pointer.vx * decay;
      pointer.vy -= pointer.vy * decay;
      const presenceTarget = s.mouseInteraction && pointer.inside ? 1 : 0;
      pointer.presence += (presenceTarget - pointer.presence) * (1 - Math.exp(-dt / 0.2));
    };

    const settled = (now: number) => {
      if (shocks.length) return false;
      if (introStart !== null) {
        if (introStart < 0 || (now - introStart) / 1000 < 1.6) return false;
        introIteration++;
        if (introIteration < settingsRef.current.introLoops) {
          introStart = now;
          return false;
        }
        introStart = null;
      }
      if (Math.abs(pointer.vx) + Math.abs(pointer.vy) > 1) return false;
      const presenceTarget = settingsRef.current.mouseInteraction && pointer.inside ? 1 : 0;
      if (Math.abs(presenceTarget - pointer.presence) > 0.002) return false;
      for (let i = 0; i < offset.length; i++) {
        if (Math.abs(offset[i]) > 0.02 || Math.abs(velocity[i]) > 0.5) return false;
      }
      return true;
    };

    const frame = (now: number) => {
      raf = 0;
      if (settingsRef.current.paused || !visible) return;
      if (introStart !== null && introStart < 0) introStart = now;
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      step(dt, now);
      render(now);
      if (!settled(now)) raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (raf || settingsRef.current.paused || !visible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const locate = (event: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      view.left = rect.left;
      view.top = rect.top;
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    const onMove = (event: PointerEvent) => {
      if (!settingsRef.current.mouseInteraction) return;
      const [x, y] = locate(event);
      const inside = x >= 0 && y >= 0 && x <= view.width && y <= view.height;
      const time = event.timeStamp || performance.now();
      if (inside && pointer.inside && pointer.time) {
        const elapsed = Math.max(4, time - pointer.time) / 1000;
        pointer.vx += ((x - pointer.x) / elapsed - pointer.vx) * 0.6;
        pointer.vy += ((y - pointer.y) / elapsed - pointer.vy) * 0.6;
      } else {
        pointer.vx = 0;
        pointer.vy = 0;
      }
      pointer.x = x;
      pointer.y = y;
      pointer.time = time;
      if (inside !== pointer.inside || inside) {
        pointer.inside = inside;
        wake();
      }
    };

    const onLeave = () => {
      pointer.inside = false;
      pointer.time = 0;
      wake();
    };

    const onOut = (event: PointerEvent) => {
      if (!event.relatedTarget) onLeave();
    };

    const onDown = (event: PointerEvent) => {
      if (!settingsRef.current.clickShock || reduced) return;
      const [x, y] = locate(event);
      if (x < 0 || y < 0 || x > view.width || y > view.height) return;
      shocks.push({ x, y, start: performance.now() });
      if (shocks.length > 6) shocks.shift();
      wake();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerout', onOut);
    window.addEventListener('blur', onLeave);

    const resizeObserver = new ResizeObserver(() => {
      resize();
      wake();
    });
    resizeObserver.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        wake();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    resize();
    wake();

    engineRef.current = {
      rebuild: () => {
        rebuild();
        render(performance.now());
        wake();
      },
      refresh: () => {
        render(performance.now());
        wake();
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteBuffer(cornerBuffer);
      gl.deleteBuffer(instanceBuffer);
      if (vao) gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.rebuild();
  }, [dotSize, gap]);

  useEffect(() => {
    engineRef.current?.refresh();
  }, [baseColor, activeColor, swell, stretch, glow, shape, fade, opacity, paused, proximity, mouseInteraction]);

  return (
    <div className={`dot-grid ${className}`.trim()} style={style}>
      <canvas ref={canvasRef} className="dot-grid__canvas" />
    </div>
  );
};

// StatusMark Component
const SM_UI = { type: 'spring' as const, duration: 0.3, bounce: 0 };
const SM_MORPH = { duration: 0.3, ease: [0.77, 0, 0.175, 1] as [number, number, number, number] };
const SM_CHECK = 'M7.5 12.25 10.5 15.25 16.75 8.75';
const SM_CROSS = 'M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5';
const SM_TEXT: Record<StatusMarkStatus, string> = {
  pending: 'Pending',
  running: 'In progress',
  done: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const SM_IDLE_DASH = 0.3;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const StatusMark: React.FC<{
  status?: StatusMarkStatus;
  progress?: number;
  label?: ReactNode;
  color?: string;
  doneColor?: string;
  errorColor?: string;
  size?: number;
  strokeWidth?: number;
  dashes?: number;
  fontSize?: number;
  spinDuration?: number;
  arcLength?: number;
  drawDuration?: number;
  fillOpacity?: number;
  strike?: boolean;
  strikeDelay?: number;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}> = ({
  status = 'pending',
  progress,
  label,
  color = 'currentColor',
  doneColor = '#22c55e',
  errorColor = '#ef4444',
  size = 20,
  strokeWidth = 2,
  dashes = 8,
  fontSize = 14,
  spinDuration = 1100,
  arcLength = 0.68,
  drawDuration = 240,
  fillOpacity = 0.06,
  strike = true,
  strikeDelay = 60,
  className = '',
  style,
  onClick,
}) => {
    const reduce = useReducedMotion();
    const r = 10 - strokeWidth / 2;
    const C = 2 * Math.PI * r;
    const P = C / Math.max(1, dashes);
    const determinate = status === 'running' && typeof progress === 'number' && Number.isFinite(progress);
    const indeterminate = status === 'running' && !determinate;
    const solid = status === 'running' || status === 'done' || status === 'failed';
    const targetArc = indeterminate ? arcLength : determinate ? clamp01(progress as number) : 1;

    const mode = useMotionValue(solid ? 1 : 0);
    const arc = useMotionValue(targetArc);
    const travel = useMotionValue(0);
    const ringRef = useRef<SVGCircleElement>(null);
    const geo = useRef({ C, P });
    geo.current = { C, P };
    const gen = useRef(0);

    const writeDash = () => {
      const g = geo.current;
      const m = mode.get();
      const a = arc.get();
      const dash = SM_IDLE_DASH * g.P + (a * g.C - SM_IDLE_DASH * g.P) * m;
      const gap = (1 - SM_IDLE_DASH) * g.P + ((1 - a) * g.C - (1 - SM_IDLE_DASH) * g.P) * m;
      ringRef.current?.setAttribute('stroke-dasharray', `${Math.max(0, dash)} ${Math.max(0, gap)}`);
    };

    useLayoutEffect(() => {
      writeDash();
      ringRef.current?.setAttribute('stroke-dashoffset', String(travel.get()));
    }, [C, P]);

    useEffect(() => {
      const offs = [
        mode.on('change', writeDash),
        arc.on('change', writeDash),
        travel.on('change', (v: number) => ringRef.current?.setAttribute('stroke-dashoffset', String(v))),
      ];
      return () => {
        offs.forEach(off => off());
        mode.stop();
        arc.stop();
        travel.stop();
      };
    }, []);

    useEffect(() => {
      const g = ++gen.current;
      if (reduce) {
        mode.jump(solid ? 1 : 0);
        arc.jump(targetArc);
        travel.jump(0);
        return;
      }
      if (mode.get() === 0) arc.jump(targetArc);
      animate(mode, solid ? 1 : 0, SM_MORPH);
      animate(arc, targetArc, SM_UI);
      if (indeterminate) {
        const t0 = travel.get();
        animate(travel, [t0, t0 - C], { duration: spinDuration / 1000, ease: 'linear', repeat: Infinity });
        return;
      }
      const unit = determinate ? C : P;
      const to = Math.floor(travel.get() / unit) * unit;
      animate(travel, to, SM_UI).then(() => {
        if (gen.current === g) travel.jump(0);
      });
    }, [status, determinate, targetArc, reduce, C, P, spinDuration]);

    const spoken = SM_TEXT[status] + (determinate ? `, ${Math.round(clamp01(progress as number) * 100)}%` : '');
    const hasLabel = label !== undefined && label !== null;

    return (
      <span
        className={`status-mark${className ? ` ${className}` : ''}`}
        data-status={status}
        data-indeterminate={indeterminate ? '' : undefined}
        data-strike={strike ? '' : undefined}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        style={
          {
            '--sm-size': `${size}px`,
            '--sm-stroke': strokeWidth,
            '--sm-color': color,
            '--sm-done': doneColor,
            '--sm-error': errorColor,
            '--sm-fill': fillOpacity,
            '--sm-font': `${fontSize}px`,
            '--sm-draw': `${drawDuration}ms`,
            '--sm-strike-delay': `${120 + strikeDelay}ms`,
            cursor: onClick ? 'pointer' : undefined,
            ...style,
          } as CSSProperties
        }
      >
        <svg
          className="status-mark__glyph"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          role={hasLabel ? undefined : 'img'}
          aria-label={hasLabel ? undefined : spoken}
          aria-hidden={hasLabel || undefined}
        >
          <circle className="status-mark__track" cx="12" cy="12" r={r} transform="rotate(-90 12 12)" />
          <circle ref={ringRef} className="status-mark__ring" cx="12" cy="12" r={r} transform="rotate(-90 12 12)" />
          <path className="status-mark__check" d={SM_CHECK} pathLength="1" />
          <path className="status-mark__cross" d={SM_CROSS} pathLength="1" />
        </svg>
        {hasLabel ? <span className="status-mark__sr">{spoken}: </span> : null}
        {hasLabel ? (
          <span className="status-mark__label">
            {label}
            <span className="status-mark__strike" aria-hidden="true" />
          </span>
        ) : null}
      </span>
    );
  };

// PromptBar Component
interface PromptBarSource {
  key: string;
  name: string;
  description?: string;
  icon?: ReactNode | IconSvgElement;
  attach?: boolean;
}
interface PromptBarCommand {
  key: string;
  name: string;
  description?: string;
}
interface PromptBarModel {
  key: string;
  name: string;
  tag?: string;
  icon?: ReactNode | IconSvgElement;
}

const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];
const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1];
const PB_LINE = 22;

const DEFAULT_PB_SOURCES: PromptBarSource[] = [
  { key: 'files', name: 'Photos & files', description: 'Upload from this device', icon: Attachment01Icon, attach: true },
  { key: 'web', name: 'Web search', description: 'Live results', icon: Globe02Icon },
  { key: 'sales', name: 'Sales data', description: 'Revenue and churn', icon: ChartLineData01Icon },
  { key: 'docs', name: 'Documents', description: 'Specs, notes, briefs', icon: File02Icon },
  { key: 'mail', name: 'Mail', description: 'Read and draft mail', icon: Mail01Icon },
  { key: 'calendar', name: 'Calendar', description: 'Events and availability', icon: Calendar03Icon },
];

const DEFAULT_PB_COMMANDS: PromptBarCommand[] = [
  { key: 'summarize', name: '/summarize', description: 'Digest the thread so far' },
  { key: 'compare', name: '/compare', description: 'Two options side by side' },
  { key: 'draft', name: '/draft', description: 'Write a first version' },
  { key: 'explain', name: '/explain', description: 'A plain-language walkthrough' },
  { key: 'tasks', name: '/tasks', description: 'Turn this into a to-do list' },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pathAt = (a: number[], b: number[], t: number) => {
  let d = '';
  for (let i = 0; i < a.length; i += 2) {
    d += `${i ? 'L' : 'M'}${mix(a[i], b[i], t).toFixed(2)} ${mix(a[i + 1], b[i + 1], t).toFixed(2)}`;
  }
  return `${d}Z`;
};
const parsePromptToken = (draft: string): { kind: 'at' | 'slash'; query: string; start: number } | null => {
  const m = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!m) return null;
  return { kind: m[2] === '@' ? 'at' : 'slash', query: m[3].toLowerCase(), start: m.index + m[1].length };
};
const renderPbIcon = (icon: ReactNode | IconSvgElement, size: number) =>
  isValidElement(icon) ? icon : <HugeiconsIcon icon={icon as IconSvgElement} size={size} strokeWidth={1.8} />;

function SendGlyph({
  busy,
  morphDuration,
  squash,
  tilt,
}: {
  busy: boolean;
  morphDuration: number;
  squash: number;
  tilt: number;
}) {
  const reduce = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dir = useRef(busy ? 1 : -1);
  const t = useMotionValue(busy ? 1 : 0);

  useEffect(() => {
    const target = busy ? 1 : 0;
    dir.current = busy ? 1 : -1;
    if (t.get() === target) return undefined;
    const controls = animate(
      t,
      target,
      reduce ? { duration: 0 } : { duration: morphDuration / 1000, ease: EASE_IN_OUT }
    );
    return () => controls.stop();
  }, [busy, morphDuration, reduce, t]);

  useMotionValueEvent(t, 'change', v => {
    pathRef.current?.setAttribute('d', pathAt(ARROW_UP, SQUARE, v));
    const goo = reduce ? 0 : Math.sin(v * Math.PI);
    const sx = 1 - squash * goo;
    if (svgRef.current) {
      svgRef.current.style.transform = goo ? `rotate(${dir.current * tilt * goo}deg) scale(${sx}, ${1 / sx})` : '';
    }
  });

  return (
    <svg
      ref={svgRef}
      className="prompt-bar__glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path ref={pathRef} d={pathAt(ARROW_UP, SQUARE, t.get())} />
    </svg>
  );
}

const PromptBar: React.FC<{
  placeholder?: string;
  sources?: PromptBarSource[];
  commands?: PromptBarCommand[];
  models?: PromptBarModel[];
  selectedModel?: string;
  busy?: boolean;
  onSend?: (text: string, detail: { attachments: string[]; model?: PromptBarModel }) => void;
  onStop?: () => void;
  onAttach?: () => string | string[] | void | Promise<string | string[] | void>;
  onDictate?: () => string | void | Promise<string | void>;
  background?: string;
  color?: string;
  menuBackground?: string;
  sparkColor?: string;
  width?: number;
  radius?: number;
  maxRows?: number;
  morphDuration?: number;
  squash?: number;
  tilt?: number;
  pressScale?: number;
}> = ({
  placeholder = 'Ask anything',
  sources = DEFAULT_PB_SOURCES,
  commands = DEFAULT_PB_COMMANDS,
  models = [],
  selectedModel,
  busy = false,
  onSend,
  onStop,
  onAttach,
  onDictate,
  background = '#27272a',
  color = '#f5f5f5',
  menuBackground = '#323236',
  sparkColor = '#b39dff',
  width = 400,
  radius = 16,
  maxRows = 5,
  morphDuration = 240,
  squash = 0.12,
  tilt = 8,
  pressScale = 0.96,
}) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const glowRef = useRef<HTMLSpanElement>(null);
    const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const lastOpen = useRef<string | null>(null);
    const dictation = useRef(0);
    const latest = useRef({ onSend, onStop, onAttach, onDictate });
    latest.current = { onSend, onStop, onAttach, onDictate };

    const [draft, setDraft] = useState('');
    const [attachments, setAttachments] = useState<string[]>([]);
    const [plusOpen, setPlusOpen] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState(0);
    const [listening, setListening] = useState(false);
    const [pressed, setPressed] = useState(false);

    const model = models.find(m => m.key === selectedModel) ?? models[0];
    const token = dismissed ? null : parsePromptToken(draft);
    const open = plusOpen ? 'at' : (token?.kind ?? null);
    const query = plusOpen ? '' : (token?.query ?? '');
    const list = useMemo(() => {
      if (open === 'at') return sources.filter(s => s.name.toLowerCase().includes(query));
      if (open === 'slash') return commands.filter(c => c.name.replace(/^\//, '').toLowerCase().startsWith(query));
      return [];
    }, [open, query, sources, commands]);
    const cursor = Math.min(active, Math.max(0, list.length - 1));
    const canSend = draft.trim().length > 0 || attachments.length > 0;
    const armed = busy || canSend;

    const focusInput = () => inputRef.current?.focus({ preventScroll: true });
    const closeMenus = useCallback(() => setPlusOpen(false), []);

    useLayoutEffect(() => {
      const glow = glowRef.current;
      if (!glow || !open) return;
      const row = rowRefs.current[cursor];
      if (!row) {
        glow.style.opacity = '0';
        return;
      }
      const fresh = lastOpen.current !== open;
      lastOpen.current = open;
      if (fresh) glow.style.transition = 'none';
      glow.style.top = `${row.offsetTop}px`;
      glow.style.height = `${row.offsetHeight}px`;
      glow.style.opacity = '1';
      if (fresh) {
        void glow.offsetHeight;
        glow.style.transition = '';
      }
    }, [open, cursor, list]);

    useEffect(() => {
      if (!open) lastOpen.current = null;
    }, [open]);

    useEffect(() => {
      if (!plusOpen) return undefined;
      const onDown = (e: globalThis.PointerEvent) => {
        if (!rootRef.current?.contains(e.target as Node)) closeMenus();
      };
      document.addEventListener('pointerdown', onDown);
      return () => document.removeEventListener('pointerdown', onDown);
    }, [plusOpen, closeMenus]);

    useLayoutEffect(() => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = '0px';
      const max = PB_LINE * maxRows;
      el.style.height = `${Math.min(el.scrollHeight, max)}px`;
      el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
    }, [draft, maxRows]);

    useEffect(() => () => { dictation.current += 1; }, []);

    const pick = (row: PromptBarSource | PromptBarCommand) => {
      const head = token ? draft.slice(0, token.start) : draft;
      if ('attach' in row && row.attach) {
        setDraft(head);
        Promise.resolve(latest.current.onAttach?.()).then(files => {
          if (!files) return;
          setAttachments(a => [...a, ...(Array.isArray(files) ? files : [files])]);
        });
      } else if (open === 'at') {
        setDraft(`${head}@${row.name} `);
      } else {
        setDraft(`${head}${row.name} `);
      }
      setPlusOpen(false);
      setDismissed(false);
      focusInput();
    };

    const send = () => {
      if (!canSend || busy) return;
      latest.current.onSend?.(draft.trim(), { attachments, model });
      setDraft('');
      setAttachments([]);
      setDismissed(false);
      closeMenus();
      focusInput();
    };

    const toggleListen = () => {
      if (listening) {
        dictation.current += 1;
        setListening(false);
        return;
      }
      const seq = ++dictation.current;
      setListening(true);
      Promise.resolve(latest.current.onDictate?.()).then(
        text => {
          if (seq !== dictation.current) return;
          setListening(false);
          if (text) setDraft(d => (d.trim() ? `${d.trimEnd()} ${text}` : text));
          focusInput();
        },
        () => {
          if (seq === dictation.current) setListening(false);
        }
      );
    };

    const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (open && list.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setActive((cursor + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
          return;
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          e.preventDefault();
          pick(list[cursor]);
          return;
        }
      }
      if (e.key === 'Escape') {
        if (open) {
          e.preventDefault();
          setDismissed(true);
          closeMenus();
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        send();
      }
    };

    const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || !armed) return;
      setPressed(true);
    };
    const up = () => setPressed(false);

    return (
      <div
        ref={rootRef}
        className="prompt-bar"
        data-busy={busy ? '' : undefined}
        style={
          {
            '--pb-bg': background,
            '--pb-ink': color,
            '--pb-menu': menuBackground,
            '--pb-w': `${width}px`,
            '--pb-radius': `${radius}px`,
            '--pb-spark': sparkColor,
            '--pb-press': pressScale,
          } as CSSProperties
        }
      >
        {open ? (
          <div
            className="prompt-bar__menu"
            role="listbox"
            aria-label={open === 'at' ? 'Sources' : 'Commands'}
            data-kind={open}
          >
            <span ref={glowRef} className="prompt-bar__glow" aria-hidden="true" />
            {list.map((row, i) => (
              <button
                key={row.key}
                ref={el => { rowRefs.current[i] = el; }}
                type="button"
                role="option"
                aria-selected={i === cursor}
                className="prompt-bar__row"
                onMouseDown={e => e.preventDefault()}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(row)}
              >
                {open === 'at' && (row as PromptBarSource).icon ? (
                  <span className="prompt-bar__row-icon">{renderPbIcon((row as PromptBarSource).icon, 15)}</span>
                ) : null}
                <span className="prompt-bar__row-name">{row.name}</span>
                {row.description ? <span className="prompt-bar__row-desc">{row.description}</span> : null}
              </button>
            ))}
            {list.length === 0 ? <div className="prompt-bar__empty">No matches for “{query}”</div> : null}
          </div>
        ) : null}

        <div
          className="prompt-bar__field"
          role="presentation"
          onPointerDown={e => {
            if (e.target === e.currentTarget || e.target === inputRef.current) closeMenus();
          }}
          onClick={focusInput}
        >
          {attachments.length > 0 ? (
            <div className="prompt-bar__chips">
              {attachments.map((file, i) => (
                <span key={`${file}-${i}`} className="prompt-bar__chip">
                  <HugeiconsIcon icon={File02Icon} size={12} strokeWidth={2} />
                  <span className="prompt-bar__chip-name">{file}</span>
                  <button
                    type="button"
                    className="prompt-bar__chip-x"
                    aria-label={`Remove ${file}`}
                    onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            ref={inputRef}
            className="prompt-bar__input"
            rows={1}
            value={draft}
            placeholder={listening ? 'Listening…' : placeholder}
            aria-label="Prompt"
            onChange={e => {
              setDraft(e.target.value);
              setDismissed(false);
              closeMenus();
              setActive(0);
            }}
            onFocus={closeMenus}
            onKeyDown={onKeyDown}
          />

          <div className="prompt-bar__bar">
            <button
              type="button"
              className="prompt-bar__tool"
              aria-label="Add files and sources"
              aria-expanded={plusOpen}
              data-on={plusOpen ? '' : undefined}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                setActive(0);
                setPlusOpen(v => !v);
                focusInput();
              }}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
            </button>
            {models.length > 0 && model ? (
              <span className="prompt-bar__model-badge" aria-label={`Active model: ${model.name}`}>
                {model.icon ? <span className="prompt-bar__pick-icon">{renderPbIcon(model.icon, 14)}</span> : null}
                <span>{model.name}</span>
              </span>
            ) : null}
            <span className="prompt-bar__spacer" />
            {onDictate ? (
              <button
                type="button"
                className="prompt-bar__tool"
                aria-label={listening ? 'Stop dictation' : 'Dictate'}
                aria-pressed={listening}
                data-on={listening ? '' : undefined}
                onMouseDown={e => e.preventDefault()}
                onClick={toggleListen}
              >
                {listening ? (
                  <span className="prompt-bar__eq" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <HugeiconsIcon icon={Mic01Icon} size={15} strokeWidth={2} />
                )}
              </button>
            ) : null}
            <button
              type="button"
              className="prompt-bar__send"
              disabled={!armed}
              aria-label={busy ? 'Stop' : 'Send'}
              data-armed={armed ? '' : undefined}
              data-pressed={pressed ? '' : undefined}
              onMouseDown={e => e.preventDefault()}
              onPointerDown={down}
              onPointerUp={up}
              onPointerCancel={up}
              onPointerLeave={up}
              onClick={() => {
                if (busy) latest.current.onStop?.();
                else send();
              }}
            >
              <SendGlyph busy={busy} morphDuration={morphDuration} squash={squash} tilt={tilt} />
            </button>
          </div>
        </div>
      </div>
    );
  };

// ---------------------------------------------------------------------------
// Provider Brand Icons
// ---------------------------------------------------------------------------
const ApiKeyCustomIcon = ({ className = 'w-[14.7px] h-[14.7px]' }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" className={className}>
    <path d="M323-160q-11 0-20.5-5.5T288-181l-78-139h58l40 80h92v-40h-68l-40-80H188l-57-100q-2-5-3.5-10t-1.5-10q0-4 5-20l57-100h104l40-80h68v-40h-92l-40 80h-58l78-139q5-10 14.5-15.5T323-800h97q17 0 28.5 11.5T460-760v160h-60l-40 40h100v120h-88l-40-80h-92l-40 40h108l40 80h112v200q0 17-11.5 28.5T420-160h-97Zm180.5-23.5Q480-207 480-240q0-23 11-40.5t29-28.5v-342q-18-11-29-28.5T480-720q0-33 23.5-56.5T560-800q33 0 56.5 23.5T640-720q0 23-11 40.5T600-651v101l80-48q0-34 23.5-58t56.5-24q33 0 56.5 23.5T840-600q0 33-23.5 56.5T760-520q-11 0-20.5-2.5T721-530l-91 55 101 80q7-3 14-4t15-1q33 0 56.5 23.5T840-320q0 33-23.5 56.5T760-240q-37 0-60.5-28T681-332l-81-65v89q18 11 28.5 28.5T639-240q0 33-23 56.5T560-160q-33 0-56.5-23.5Z" />
  </svg>
);

const AnthropicClaudeIcon = ({ className = 'w-3.5 h-3.5', color = '#ccccc7' }: { className?: string; color?: string }) => (
  <svg viewBox="0 0 35 24" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path
      fill={color || '#ccccc7'}
      stroke="none"
      d="M 24.547 0 L 19.338 0 L 28.837997 24 L 34.047 24 Z M 9.499 0 L 0 24 L 5.311 24 L 7.254 18.96 L 17.191 18.96 L 19.134 24 L 24.445 24 L 14.946001 0 Z M 8.972 14.503 L 12.222001 6.069 L 15.473999 14.503 Z"
    />
  </svg>
);

const OpenAIIcon = ({ className = 'w-3.5 h-3.5', color = '#10A37F' }: { className?: string; color?: string }) => (
  <svg viewBox="0 0 24 24" fill={color} className={className}>
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
  </svg>
);

const GoogleGeminiIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => {
  const uid = useId().replace(/:/g, '_');
  return (
    <svg fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 65 65" className={className}>
      <path
        d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z"
        fill={`url(#gemini_grad_${uid})`}
      />
      <defs>
        <linearGradient id={`gemini_grad_${uid}`} x1={18.4} y1={43.4} x2={52.1} y2={15} gradientUnits="userSpaceOnUse">
          <stop stopColor="#4893FC" />
          <stop offset={0.5} stopColor="#969DFF" />
          <stop offset={1} stopColor="#BD99FE" />
        </linearGradient>
      </defs>
    </svg>
  );
};

const DeepSeekIcon = ({ className = 'w-3.5 h-3.5', color = '#526CFD' }: { className?: string; color?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" className={className}>
    <path
      d="M0 0 C1.88 0.25 1.88 0.25 4 1 C4.29 1.6 4.58 2.2 4.88 2.81 C6.49 5.95 9.1 7.09 12 9 C12.5 10.48 12.5 10.48 13 12 C13.99 11.34 14.98 10.68 16 10 C18.27 9.41 20.54 8.99 22.84 8.56 C25.27 8.05 25.27 8.05 28 6 C28.99 6 29.98 6 31 6 C31.37 11.23 31.27 14.97 28.41 19.46 C25.84 22.27 22.58 23.82 19 25 C18.01 25 17.02 25 16 25 C16.08 25.89 16.17 26.77 16.25 27.69 C16.19 38.24 11.26 46.9 5 55 C4.5 55.99 4.5 55.99 4 57 C6.64 58.32 9.28 59.64 12 61 C11.34 62.32 10.68 63.64 10 65 C8.91 64.95 7.83 64.91 6.71 64.86 C5.27 64.82 3.82 64.79 2.38 64.75 C1.66 64.72 0.95 64.68 0.21 64.65 C-5.1 64.55 -7.64 65.77 -12 69 C-21.06 72.91 -33.44 72.49 -42.56 69 C-53.02 63.84 -59.76 55.94 -64.14 45.21 C-66.41 36.74 -66.57 25.65 -62.26 17.86 C-61.84 17.24 -61.43 16.63 -61 16 C-60.56 15.36 -60.13 14.71 -59.68 14.05 C-55.47 8.57 -49.82 5.23 -43 4 C-39.47 3.97 -35.94 4.07 -32.41 4.16 C-29.06 4 -27.02 3.37 -24 2 C-16.84 0.62 -16.84 0.62 -13 2 C-13.33 2.99 -13.66 3.98 -14 5 C-14.66 5 -15.32 5 -16 5 C-15.55 9.7 -13.92 11.43 -10.38 14.44 C-9.47 15.21 -8.57 15.98 -7.64 16.78 C-6.77 17.51 -5.9 18.24 -5 19 C-4.3 19.62 -3.61 20.24 -2.89 20.88 C-0.29 23.19 1.67 24.89 5 26 C4.58 23.19 4.01 22.02 2.06 19.88 C-1.1 15.46 -2.48 10.23 -1.67 4.8 C-1.13 2.88 -1.13 2.88 0 0 Z"
      fill={color || '#526CFD'}
      transform="translate(65,14)"
    />
  </svg>
);

const PerplexityIcon = ({ className = 'w-3.5 h-3.5', color = '#20B8CD' }: { className?: string; color?: string }) => (
  <svg viewBox="0 0 24 24" fill={color} className={className}>
    <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z" />
  </svg>
);

const OpenRouterNemotronIcon = ({
  className = 'w-[18px] h-3.5',
  useColor = true,
}: {
  className?: string;
  useColor?: boolean;
}) => (
  <img
    src={nvidiaIconUrl}
    alt="NVIDIA"
    draggable={false}
    className={`${className} object-contain select-none${useColor ? '' : ' brightness-0 invert'}`}
  />
);

const ModelProviderIcon = ({
  modelId,
  className = 'w-3.5 h-3.5',
  useColor = true,
}: {
  modelId: string;
  className?: string;
  useColor?: boolean;
}) => {
  switch (modelId) {
    case NEMOTRON_MODEL_ID:
    case 'openrouter': {
      const wideClass = className
        .replace(/\bw-3\.5\b/, 'w-[18px]')
        .replace(/\bw-4\b/, 'w-[21px]');
      return <OpenRouterNemotronIcon className={wideClass} useColor={useColor} />;
    }
    case 'claude-3-5-sonnet':
    case 'claude-3-opus':
      return <AnthropicClaudeIcon className={className} color={useColor ? '#ccccc7' : 'currentColor'} />;
    case 'gpt-6-astra':
    case 'gpt-6-1-sol':
    case 'gpt-4o':
      return <OpenAIIcon className={className} color={useColor ? '#10A37F' : 'currentColor'} />;
    case 'gemini-1-5-pro':
      return <GoogleGeminiIcon className={className} />;
    case 'deepseek-r1':
      return <DeepSeekIcon className={className} color={useColor ? '#526CFD' : 'currentColor'} />;
    case 'perplexity':
      return <PerplexityIcon className={className} color={useColor ? '#20B8CD' : 'currentColor'} />;
    default:
      return <Key className={className} />;
  }
};

// ---------------------------------------------------------------------------
// Modals: ApiKeyModal & EditNameModal
// ---------------------------------------------------------------------------
const ApiKeyModal = ({
  isOpen,
  onClose,
  agentTitle,
  onNotify,
  initialModelId = NEMOTRON_MODEL_ID,
  serverAiStatus,
}: {
  isOpen: boolean;
  onClose: () => void;
  agentTitle: string;
  onNotify: (msg: string) => void;
  initialModelId?: string;
  serverAiStatus?: ServerAiStatus | null;
}) => {
  const [selectedModelId, setSelectedModelId] = useState<string>(initialModelId);
  const [keysMap, setKeysMap] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('aeon_byok_keys');
      if (saved) return JSON.parse(saved);
    } catch { }
    return {};
  });
  const [activeModelId, setActiveModelId] = useState<string>(() => {
    try {
      return localStorage.getItem('aeon_active_byok_model') || NEMOTRON_MODEL_ID;
    } catch {
      return NEMOTRON_MODEL_ID;
    }
  });
  const [currentInputKey, setCurrentInputKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [isSavedRecently, setIsSavedRecently] = useState<boolean>(false);

  const selectedModel = useMemo(
    () => BYOK_MODELS.find(m => m.id === selectedModelId) || BYOK_MODELS[0],
    [selectedModelId]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (initialModelId) setSelectedModelId(initialModelId);
    try {
      const saved = localStorage.getItem('aeon_byok_keys');
      if (saved) setKeysMap(JSON.parse(saved));
      const active = localStorage.getItem('aeon_active_byok_model');
      if (active) setActiveModelId(active);
    } catch { }
  }, [initialModelId, isOpen]);

  useEffect(() => {
    setCurrentInputKey(keysMap[selectedModelId] || '');
    setShowKey(false);
    setIsSavedRecently(false);
  }, [selectedModelId, keysMap]);

  if (!isOpen) return null;

  const emitModelUpdated = () => {
    try {
      window.dispatchEvent(new Event('aeon_agent_model_updated'));
    } catch { }
  };

  const handleSaveKey = () => {
    const trimmed = currentInputKey.trim();
    const updated = { ...keysMap, [selectedModelId]: trimmed };
    if (!trimmed) delete updated[selectedModelId];
    setKeysMap(updated);
    try {
      localStorage.setItem('aeon_byok_keys', JSON.stringify(updated));
      if (trimmed) {
        localStorage.setItem('aeon_active_byok_model', selectedModelId);
        setActiveModelId(selectedModelId);
      }
    } catch { }
    emitModelUpdated();
    setIsSavedRecently(true);
    setTimeout(() => setIsSavedRecently(false), 2000);
    onNotify(
      trimmed
        ? `Saved API key and activated ${selectedModel.name}`
        : `Removed API key for ${selectedModel.name}`
    );
  };

  const handleRemoveKey = () => {
    const updated = { ...keysMap };
    delete updated[selectedModelId];
    setKeysMap(updated);
    setCurrentInputKey('');
    try {
      localStorage.setItem('aeon_byok_keys', JSON.stringify(updated));
    } catch { }
    emitModelUpdated();
    onNotify(`Removed API key for ${selectedModel.name}`);
  };

  const handleSetActiveModel = (modelId: string) => {
    setActiveModelId(modelId);
    try {
      localStorage.setItem('aeon_active_byok_model', modelId);
    } catch { }
    emitModelUpdated();
    const model = BYOK_MODELS.find(m => m.id === modelId);
    onNotify(`Primary agent model set to ${model?.name || modelId}`);
  };

  const selectedHasServerEnv = selectedModelId === NEMOTRON_MODEL_ID && Boolean(serverAiStatus?.configured);
  const selectedCanActivate = Boolean(keysMap[selectedModelId]) || selectedHasServerEnv;

  return (
    <div
      className="absolute inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-[#18181b] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/[0.08] bg-[#1a1a1e]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0da1b2]/15 text-[#0da1b2] flex items-center justify-center border border-[#0da1b2]/20">
              <ApiKeyCustomIcon className="w-[16.8px] h-[16.8px]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white text-[15px] font-semibold tracking-tight">AI Model & OpenRouter Key</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                  {serverAiStatus?.configured ? 'Server Env Ready' : 'Encrypted Locally'}
                </span>
              </div>
              <p className="text-[12px] text-neutral-400 mt-0.5">
                Configure NVIDIA Nemotron 3 Ultra (OpenRouter) or switch model credentials for{' '}
                <span className="text-neutral-200 font-medium">{agentTitle}</span>.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close API Key dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <div>
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2.5">
              Select Model
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {BYOK_MODELS.map(model => {
                const isSelected = selectedModelId === model.id;
                const hasBrowserKey = Boolean(keysMap[model.id]);
                const hasServerKey = model.id === NEMOTRON_MODEL_ID && Boolean(serverAiStatus?.configured);
                const hasKey = hasBrowserKey || hasServerKey;
                const isActive = activeModelId === model.id;

                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModelId(model.id)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 relative ${isSelected
                        ? 'bg-[#0da1b2]/10 border-[#0da1b2]/50 text-white shadow-sm'
                        : 'bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.05] text-neutral-300'
                      }`}
                  >
                    <div className="flex items-start justify-between w-full">
                      <div>
                        <div className="font-semibold text-[13px] leading-tight text-white flex items-center gap-2">
                          <ModelProviderIcon modelId={model.id} className="w-4 h-4 shrink-0" />
                          <span>{model.name}</span>
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">{model.tag}</div>
                      </div>
                      {isActive && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-medium bg-[#0da1b2]/25 text-[#0da1b2] border border-[#0da1b2]/30">
                          Active
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[10.5px] pt-1 border-t border-white/[0.06] mt-1">
                      <span className="text-neutral-400">Status:</span>
                      {hasBrowserKey ? (
                        <span className="flex items-center gap-1 text-emerald-400 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Key Configured
                        </span>
                      ) : hasServerKey ? (
                        <span className="flex items-center gap-1 text-emerald-400 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Server .env Connected
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-neutral-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                          Not set
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-3 mt-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-[13px] font-semibold text-white flex items-center gap-2">
                  <span>{selectedModel.name}</span>
                  {selectedModelId === NEMOTRON_MODEL_ID && (
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-neutral-300">
                      {NEMOTRON_MODEL_ID}
                    </span>
                  )}
                </h4>
                <p className="text-[11.5px] text-neutral-400 mt-0.5 leading-relaxed">{selectedModel.description}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                <a
                  href={selectedModel.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-[#0da1b2] hover:underline flex items-center gap-1"
                >
                  <span>Get API Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                {selectedModelId === NEMOTRON_MODEL_ID && (
                  <a
                    href={NEMOTRON_MODEL_PAGE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10.5px] text-neutral-400 hover:text-neutral-200 hover:underline flex items-center gap-1"
                  >
                    <span>Model Docs</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>

            {selectedHasServerEnv && !keysMap[selectedModelId] && (
              <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 leading-relaxed">
                <span className="font-semibold">Connected via server environment:</span> Local Vite proxy <code className="font-mono">/api/chat</code> already has <code className="font-mono">$OPENROUTER_API_KEY</code> configured. Adding a browser key below is optional and overrides it.
              </div>
            )}

            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-medium text-neutral-300 flex items-center justify-between">
                <span>API Key ({selectedModel.keyPrefixNotice})</span>
                {keysMap[selectedModelId] && (
                  <span className="text-[10.5px] text-emerald-400">Configured in browser</span>
                )}
              </label>
              <div className="relative flex items-center">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={currentInputKey}
                  onChange={e => setCurrentInputKey(e.target.value)}
                  placeholder={selectedModel.placeholder}
                  className="w-full bg-[#121214] border border-white/10 rounded-lg px-3 py-2 pr-10 text-[12.5px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#0da1b2] font-mono transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 text-neutral-400 hover:text-white p-1 transition-colors"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                {keysMap[selectedModelId] && (
                  <button
                    type="button"
                    onClick={handleRemoveKey}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Remove Key</span>
                  </button>
                )}
                {activeModelId !== selectedModelId && selectedCanActivate && (
                  <button
                    type="button"
                    onClick={() => handleSetActiveModel(selectedModelId)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-[#0da1b2] hover:bg-[#0da1b2]/10 border border-[#0da1b2]/25 transition-colors cursor-pointer"
                  >
                    <ShieldCheck className="w-3 h-3" />
                    <span>Set as Active Engine</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {isSavedRecently ? (
                  <button
                    type="button"
                    onClick={handleSaveKey}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all cursor-pointer bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Saved!</span>
                  </button>
                ) : (
                  <SpecularButton
                    type="button"
                    size="sm"
                    radius={999}
                    tint="#ffffff"
                    tintOpacity={0.12}
                    blur={12}
                    textColor="#ffffff"
                    lineColor="#ffffff"
                    baseColor="#d4d4d8"
                    intensity={1.05}
                    idleIntensity={0.45}
                    shineSize={12}
                    shineFade={36}
                    thickness={1.3}
                    glow={1}
                    followMouse
                    proximity={250}
                    onClick={handleSaveKey}
                    className="luna-chat-specular"
                  >
                    <span>Save Key</span>
                  </SpecularButton>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 bg-[#141416] border-t border-white/[0.06] flex items-center justify-between text-[11px] text-neutral-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/80" />
            <span>Browser keys stay in localStorage; server $OPENROUTER_API_KEY stays in .env.local.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md text-neutral-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const EditNameModal = ({
  isOpen,
  onClose,
  currentName,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentName: string;
  onSave: (newName: string) => void;
}) => {
  const [nameInput, setNameInput] = useState(currentName);

  useEffect(() => {
    setNameInput(currentName);
  }, [currentName, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) onSave(nameInput.trim());
  };

  return (
    <div
      className="absolute inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#18181b] border border-white/10 shadow-2xl p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0da1b2]/15 text-[#0da1b2] flex items-center justify-center border border-[#0da1b2]/20">
              <Pencil className="w-4 h-4 stroke-[2]" />
            </div>
            <h3 className="text-white text-[15px] font-semibold tracking-tight">Rename Agent</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <label className="text-[11.5px] font-medium text-neutral-400">Agent Name</label>
            <input
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              placeholder="e.g. Outbound Sales Rep"
              autoFocus
              className="w-full bg-[#121214] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#0da1b2] transition-colors"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <SpecularButton
              type="submit"
              size="sm"
              radius={999}
              tint="#ffffff"
              tintOpacity={!nameInput.trim() || nameInput.trim() === currentName ? 0.05 : 0.12}
              blur={12}
              textColor={!nameInput.trim() || nameInput.trim() === currentName ? '#a3a3a3' : '#ffffff'}
              lineColor="#ffffff"
              baseColor="#d4d4d8"
              intensity={!nameInput.trim() || nameInput.trim() === currentName ? 0.35 : 1.05}
              idleIntensity={0.45}
              shineSize={12}
              shineFade={36}
              thickness={1.3}
              glow={1}
              followMouse
              proximity={250}
              disabled={!nameInput.trim() || nameInput.trim() === currentName}
              className="luna-chat-specular"
            >
              <span>Save Name</span>
            </SpecularButton>
          </div>
        </form>
      </div>
    </div>
  );
};

interface GreetingRowSlice {
  start: number;
  end: number;
  hasTrailingSpace: boolean;
}

const LUNA_GREETING_TEXT =
  "Hi I'm Luna, your mission planner guide. I help you evaluate landing sites, launch dates, power margins, and direct to Earth communication. Select an option below to continue.";

const LunaGreetingText: React.FC<{
  content: string;
  fullText: string;
  shimmerActive: boolean;
  onShimmerComplete: () => void;
}> = ({ content, fullText, shimmerActive, onShimmerComplete }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLParagraphElement | null>(null);
  const [rows, setRows] = useState<GreetingRowSlice[]>([]);

  const wordRanges = useMemo(() => {
    const parts = fullText.split(' ');
    const out: { word: string; start: number; end: number; hasTrailingSpace: boolean }[] = [];
    let offset = 0;
    parts.forEach((word, idx) => {
      const start = offset;
      const end = start + word.length;
      const hasTrailingSpace = idx < parts.length - 1;
      out.push({ word, start, end, hasTrailingSpace });
      offset = end + (hasTrailingSpace ? 1 : 0);
    });
    return out;
  }, [fullText]);

  useLayoutEffect(() => {
    if (!shimmerActive) return;

    const computeRows = () => {
      const el = measureRef.current;
      if (!el || el.clientWidth <= 0) return;

      const spans = Array.from(el.querySelectorAll<HTMLSpanElement>('[data-word-idx]'));
      const nextRows: GreetingRowSlice[] = [];
      let currentTop: number | null = null;
      let rowStart = 0;
      let rowEnd = 0;
      let rowHasSpace = false;

      spans.forEach((span, idx) => {
        const range = wordRanges[idx];
        if (!range) return;
        const top = span.getBoundingClientRect().top;
        if (currentTop === null || Math.abs(top - currentTop) > 4) {
          if (currentTop !== null) {
            nextRows.push({ start: rowStart, end: rowEnd, hasTrailingSpace: rowHasSpace });
          }
          currentTop = top;
          rowStart = range.start;
          rowEnd = range.end;
          rowHasSpace = range.hasTrailingSpace;
        } else {
          rowEnd = range.end;
          rowHasSpace = range.hasTrailingSpace;
        }
      });

      if (currentTop !== null) {
        nextRows.push({ start: rowStart, end: rowEnd, hasTrailingSpace: rowHasSpace });
      }

      setRows(prev => {
        if (
          prev.length === nextRows.length &&
          prev.every((r, i) => r.start === nextRows[i].start && r.end === nextRows[i].end)
        ) {
          return prev;
        }
        return nextRows;
      });
    };

    computeRows();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && wrapperRef.current) {
      ro = new ResizeObserver(() => computeRows());
      ro.observe(wrapperRef.current);
    }
    document.fonts?.ready?.then(() => computeRows()).catch(() => { });

    return () => {
      ro?.disconnect();
    };
  }, [shimmerActive, wordRanges]);

  if (!shimmerActive) {
    return <p className="mb-2 last:mb-0 leading-relaxed font-sans">{content}</p>;
  }

  const rowCount = Math.max(1, rows.length);
  const stepRatio = 0.65;
  const rowDurationSec = rowCount === 1 ? 4 : 4 / (1 + (rowCount - 1) * stepRatio);
  const stepDelaySec = rowDurationSec * stepRatio;

  return (
    <div ref={wrapperRef} className="relative">
      <p
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none select-none opacity-0 absolute inset-x-0 top-0 mb-0 leading-relaxed font-sans"
        style={{ visibility: 'hidden' }}
      >
        {wordRanges.map((item, idx) => (
          <span key={item.start} data-word-idx={idx}>
            {item.word}
            {item.hasTrailingSpace ? ' ' : ''}
          </span>
        ))}
      </p>

      <p className="mb-2 last:mb-0 leading-relaxed font-sans">
        {rows.length === 0
          ? content
          : rows.map((row, idx) => {
            const visibleText = content.slice(row.start, row.end);
            if (!visibleText) return null;
            const hasTrailingSpace = row.hasTrailingSpace && content.length > row.end;
            const isLastRow = idx === rows.length - 1;
            return (
              <span key={`${row.start}-${row.end}`} className="block">
                <span
                  className="luna-greeting-row-shimmer"
                  style={{
                    animationDuration: `${rowDurationSec.toFixed(3)}s`,
                    animationDelay: `${(idx * stepDelaySec).toFixed(3)}s`,
                  }}
                  onAnimationEnd={isLastRow ? onShimmerComplete : undefined}
                >
                  {visibleText}
                </span>
                {hasTrailingSpace ? ' ' : null}
              </span>
            );
          })}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Standalone AgentBuilderPage Component
// ---------------------------------------------------------------------------
export interface AgentBuilderPageProps {
  agent?: AgentBuilderData;
  onClose?: () => void;
  onUpdateAgent?: (updated: AgentBuilderData) => void;
  onDuplicateAgent?: (agent: AgentBuilderData) => void;
  onDeleteAgent?: (agent: AgentBuilderData) => void;
  onAssignTask?: (task: { title: string; agentValue: string; agentLabel: string; priority: 'High' | 'Med' | 'Low' }) => void;
  chatEndpoint?: string;
  sceneActive?: boolean;
  isRevealComplete?: boolean;
  onAssetsLoaded?: () => void;
  onOpenManualPlanner?: () => void;
}

export const AgentBuilderPage: React.FC<AgentBuilderPageProps> = ({
  agent: initialAgent = DEFAULT_AGENT_BUILDER_DATA,
  onClose,
  onUpdateAgent,
  onDuplicateAgent,
  onDeleteAgent,
  onAssignTask,
  chatEndpoint = '/api/chat',
  sceneActive = true,
  isRevealComplete: isRevealCompleteProp,
  onAssetsLoaded,
  onOpenManualPlanner,
}) => {
  const [agent, setAgent] = useState<AgentBuilderData>(initialAgent);

  useEffect(() => {
    setAgent(initialAgent);
  }, [initialAgent]);

  const [selectedModelForInput, setSelectedModelForInput] = useState<string | null>(null);
  const [serverAiStatus, setServerAiStatus] = useState<ServerAiStatus | null>(null);
  const [configuredKeysVersion, setConfiguredKeysVersion] = useState(0);

  const [agentActiveModel, setAgentActiveModel] = useState<string>(() => {
    try {
      const globalActive = localStorage.getItem('aeon_active_byok_model');
      if (globalActive) return globalActive;
      const saved = localStorage.getItem('aeon_agent_active_models');
      const slug = (initialAgent.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (saved) {
        const parsed = JSON.parse(saved);
        const found =
          parsed[initialAgent.title] ||
          (initialAgent.id ? parsed[initialAgent.id] : null) ||
          (slug ? parsed[slug] : null);
        if (found) return found;
      }
      const savedKeys = localStorage.getItem('aeon_byok_keys');
      if (savedKeys) {
        const parsedKeys = JSON.parse(savedKeys);
        const firstConfigured = BYOK_MODELS.find(m => Boolean(parsedKeys[m.id]));
        if (firstConfigured) return firstConfigured.id;
      }
    } catch { }
    return NEMOTRON_MODEL_ID;
  });

  useEffect(() => {
    const controller = new AbortController();
    const syncServerStatus = () => {
      fetchServerAiStatus(controller.signal).then(status => {
        if (!controller.signal.aborted) setServerAiStatus(status);
      });
    };
    syncServerStatus();

    const refreshModelState = () => {
      setConfiguredKeysVersion(v => v + 1);
      syncServerStatus();
      try {
        const active = localStorage.getItem('aeon_active_byok_model');
        if (active) setAgentActiveModel(active);
      } catch { }
    };
    window.addEventListener('aeon_agent_model_updated', refreshModelState);
    window.addEventListener('storage', refreshModelState);
    window.addEventListener('focus', syncServerStatus);
    return () => {
      controller.abort();
      window.removeEventListener('aeon_agent_model_updated', refreshModelState);
      window.removeEventListener('storage', refreshModelState);
      window.removeEventListener('focus', syncServerStatus);
    };
  }, []);

  const effectiveModelId = useMemo(() => {
    void configuredKeysVersion;
    try {
      const active = localStorage.getItem('aeon_active_byok_model');
      if (active) return active;
    } catch { }
    return agentActiveModel || NEMOTRON_MODEL_ID;
  }, [agentActiveModel, configuredKeysVersion]);

  const effectiveModelMeta = useMemo(
    () => BYOK_MODELS.find(m => m.id === effectiveModelId) || BYOK_MODELS[0],
    [effectiveModelId]
  );

  const setModelForAgent = (modelId: string) => {
    setAgentActiveModel(modelId);
    try {
      const saved = localStorage.getItem('aeon_agent_active_models');
      const currentMap = saved ? JSON.parse(saved) : {};
      currentMap[agent.title] = modelId;
      if (agent.id) currentMap[agent.id] = modelId;
      const slug = agent.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      currentMap[slug] = modelId;
      localStorage.setItem('aeon_agent_active_models', JSON.stringify(currentMap));
      window.dispatchEvent(new Event('aeon_agent_model_updated'));
      window.dispatchEvent(new Event('storage'));
    } catch { }
  };

  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isEditNameModalOpen, setIsEditNameModalOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteUnderstandText, setDeleteUnderstandText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => (prev === msg ? null : prev));
    }, 2600);
  };

  const handleSaveNewName = (newName: string) => {
    if (!newName.trim()) return;
    const updated = { ...agent, title: newName.trim() };
    setAgent(updated);
    onUpdateAgent?.(updated);
    setIsEditNameModalOpen(false);
    showToast(`Agent renamed to "${newName.trim()}"`);
  };

  const handleConfirmDelete = () => {
    setShowDeleteConfirm(false);
    setDeleteUnderstandText('');
    onDeleteAgent?.(agent);
  };

  const agentKey = (agent.id || agent.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const [inputText, setInputText] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(true);

  const [isListening, setIsListening] = useState(false);
  const [isHoveringWave, setIsHoveringWave] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isIntentionallyStopped = useRef<boolean>(false);
  const finalTranscriptRef = useRef<string>('');

  const toggleListening = () => {
    if (isListening) {
      isIntentionallyStopped.current = true;
      try { recognitionRef.current?.stop(); } catch { }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        isIntentionallyStopped.current = false;
        setInputText(prev => {
          finalTranscriptRef.current = prev.trim();
          return prev;
        });
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalSegment = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) finalSegment += event.results[i][0].transcript;
          else interimTranscript += event.results[i][0].transcript;
        }
        if (finalSegment) {
          finalTranscriptRef.current = (finalTranscriptRef.current + ' ' + finalSegment.trim()).trim();
        }
        setInputText((finalTranscriptRef.current + ' ' + interimTranscript.trim()).trim());
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          isIntentionallyStopped.current = true;
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        if (!isIntentionallyStopped.current) {
          try { recognition.start(); } catch { setIsListening(false); }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch { }
    };
  }, []);

  const [selectedQuestionOption, setSelectedQuestionOption] = useState<string | null>(null);
  const [customOptionText, setCustomOptionText] = useState('');
  const [isCustomEditing, setIsCustomEditing] = useState(false);
  const [isQuestionCardDismissed, setIsQuestionCardDismissed] = useState(false);
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Record<string, boolean>>({});
  const [expandedTasksIds, setExpandedTasksIds] = useState<Record<string, boolean>>({});

  const toggleReasoning = (msgId: string) =>
    setExpandedReasoningIds(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  const toggleTasks = (msgId: string) =>
    setExpandedTasksIds(prev => ({ ...prev, [msgId]: !prev[msgId] }));

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGreetingShimmerActive, setIsGreetingShimmerActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAgentSetupComplete, setIsAgentSetupComplete] = useState(false);
  const [isSetupCompleteHold, setIsSetupCompleteHold] = useState(false);
  const setupHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEmailMarketingAgent = agentKey === 'email-marketing' || agent.title.toLowerCase().includes('email marketing');
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const hasInitialGreeted = useRef<string | null>(null);

  const missionStore = useMissionPlannerStore();
  const [lunaDraft, setLunaDraft] = useState<LunaDraftState>(() => createInitialLunaDraft());
  const lunaDraftRef = useRef<LunaDraftState>(lunaDraft);
  lunaDraftRef.current = lunaDraft;
  const lastManualRevisionRef = useRef<number>(missionStore.revision);

  const activeQuestionMsg = useMemo(() => {
    if (isLoading || isQuestionCardDismissed) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].questionCard) return messages[i];
    }
    return null;
  }, [messages, isLoading, isQuestionCardDismissed]);

  const isSpecularChatAction = useCallback(
    (act: LunaActionButton) =>
      act.variant === 'primary' ||
      act.kind === 'check_plan' ||
      act.kind === 'search_alternatives' ||
      act.kind === 'adopt_preview',
    []
  );

  // Cap live WebGL2 <SpecularButton /> contexts in scrollback to protect the 3D scene's GPU budget
  const liveSpecularActionKeys = useMemo(() => {
    const keys = new Set<string>();
    const MAX_LIVE_SPECULAR = 5;
    for (let i = messages.length - 1; i >= 0 && keys.size < MAX_LIVE_SPECULAR; i--) {
      const m = messages[i];
      if (!m.actions?.length) continue;
      for (const act of m.actions) {
        if (isSpecularChatAction(act)) {
          keys.add(`${m.id}:${act.id}`);
          if (keys.size >= MAX_LIVE_SPECULAR) break;
        }
      }
    }
    return keys;
  }, [messages, isSpecularChatAction]);

  const triggerSetupCompletion = () => {
    if (isAgentSetupComplete) return;
    setIsSetupCompleteHold(true);
    if (setupHoldTimerRef.current) clearTimeout(setupHoldTimerRef.current);
    setupHoldTimerRef.current = setTimeout(() => {
      setIsSetupCompleteHold(false);
      setIsAgentSetupComplete(true);
      setupHoldTimerRef.current = null;
    }, 450);
  };

  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleCopyText = (text: string, id?: string) => {
    navigator.clipboard.writeText(text);
    if (id) {
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  };

  const hasExternalOverlay = isRevealCompleteProp !== undefined || onAssetsLoaded !== undefined;
  const [isSceneAssetsLoaded, setIsSceneAssetsLoaded] = useState(false);
  const [isLocalRevealComplete, setIsLocalRevealComplete] = useState(false);
  const [showLoadOverlay, setShowLoadOverlay] = useState(!hasExternalOverlay);
  const effectiveRevealComplete = isRevealCompleteProp ?? isLocalRevealComplete;

  useEffect(() => {
    if (hasExternalOverlay || !isSceneAssetsLoaded) return;
    const hideTimer = window.setTimeout(() => {
      setShowLoadOverlay(false);
      setIsLocalRevealComplete(true);
    }, 360);
    return () => window.clearTimeout(hideTimer);
  }, [hasExternalOverlay, isSceneAssetsLoaded]);

  const handleGreetingShimmerComplete = useCallback(() => {
    setIsGreetingShimmerActive(false);
  }, []);

  useEffect(() => {
    if (!isGreetingShimmerActive) return;
    const timer = window.setTimeout(() => {
      setIsGreetingShimmerActive(false);
    }, 4400);
    return () => window.clearTimeout(timer);
  }, [isGreetingShimmerActive]);

  useEffect(() => {
    if (!sceneActive || !effectiveRevealComplete) return;
    const agentIdentity = agent.id || agent.title;
    if (hasInitialGreeted.current === agentIdentity) return;
    hasInitialGreeted.current = agentIdentity;
    lastManualRevisionRef.current = missionPlannerStore.getSnapshot().revision;
    const initialDraft = createInitialLunaDraft();
    lunaDraftRef.current = initialDraft;
    setLunaDraft(initialDraft);

    const initialAssistantMsgId = (Date.now() + 1).toString();
    setIsLoading(true);
    setIsAgentSetupComplete(false);
    setIsSetupCompleteHold(false);
    if (setupHoldTimerRef.current) {
      clearTimeout(setupHoldTimerRef.current);
      setupHoldTimerRef.current = null;
    }
    setIsQuestionCardDismissed(false);
    setMessages([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    (async () => {
      try {
        await new Promise(r => setTimeout(r, 80));
        if (controller.signal.aborted) return;

        const targetMessageText = LUNA_GREETING_TEXT;

        const questionCardToActivate: QuestionCardData = {
          title: 'How would you like to start with this mission?',
          options: [
            { id: 'opt-1', label: 'Find a better site or landing date' },
            { id: 'opt-2', label: 'Set up my own mission' },
            { id: 'opt-3', label: 'Explain why a plan fails & read the views' },
            { id: 'opt-4', label: 'Walk me through the sample mission' },
          ],
          allowCustom: true,
        };

        setIsGreetingShimmerActive(true);
        setMessages([
          {
            id: initialAssistantMsgId,
            role: 'assistant',
            content: '',
            isInitialGreeting: true,
            questionPendingText: 'Question pending - answer below',
            questionCard: questionCardToActivate,
            timestamp: Date.now(),
          },
        ]);

        let currentText = '';
        const words = targetMessageText.split(' ');
        for (let i = 0; i < words.length; i += 2) {
          if (controller.signal.aborted) break;
          const chunk = words.slice(i, i + 2).join(' ');
          currentText += (i === 0 ? '' : ' ') + chunk;
          setMessages(prev =>
            prev.map(m => (m.id === initialAssistantMsgId ? { ...m, content: currentText } : m))
          );
          await new Promise(r => setTimeout(r, 14));
        }
      } finally {
        setIsLoading(false);
        if (!controller.signal.aborted) {
          triggerSetupCompletion();
        }
      }
    })();

    return () => {
      if (hasInitialGreeted.current === agentIdentity) {
        hasInitialGreeted.current = null;
      }
      if (setupHoldTimerRef.current) {
        clearTimeout(setupHoldTimerRef.current);
        setupHoldTimerRef.current = null;
      }
      controller.abort();
    };
  }, [agent.id, agent.title, sceneActive, effectiveRevealComplete]);

  // Warm up NASA terrain/ephemeris data bundle & Web Worker when Luna Planner opens
  useEffect(() => {
    if (!sceneActive || !effectiveRevealComplete) return;
    missionPlannerStore.ensureLoaded().catch(() => {});
  }, [sceneActive, effectiveRevealComplete]);

  // Sync changes made inside Manual Mode back into Luna's conversational context
  useEffect(() => {
    if (!sceneActive || !hasInitialGreeted.current) return;
    if (
      missionStore.hasCheckedPlan &&
      missionStore.lastUpdatedBy === 'manual' &&
      missionStore.revision !== lastManualRevisionRef.current
    ) {
      lastManualRevisionRef.current = missionStore.revision;
      const syncedResult = missionStore.preview || missionStore.baseline;
      if (!syncedResult) return;

      const updatedDraft: LunaDraftState = {
        ...lunaDraftRef.current,
        phase: 'checked',
        draftSettings: syncedResult.settings,
      };
      lunaDraftRef.current = updatedDraft;
      setLunaDraft(updatedDraft);
      setIsQuestionCardDismissed(true);

      const summaryTurn = buildCheckResultTurn(syncedResult, {
        isPreview: Boolean(missionStore.preview),
        intent: updatedDraft.intent,
      });
      setMessages(prev => [
        ...prev,
        {
          id: `${Date.now()}-manual-sync`,
          role: 'assistant',
          content: `**Synced from Manual Planner Mode**\n\n${summaryTurn.content}`,
          reasoning: summaryTurn.reasoning,
          actions: summaryTurn.actions,
          timestamp: Date.now(),
        },
      ]);
    }
  }, [sceneActive, missionStore.revision, missionStore.lastUpdatedBy, missionStore.hasCheckedPlan, missionStore.preview, missionStore.baseline]);

  const streamBrainTurn = async (turn: LunaBrainTurnResult, signal?: AbortSignal) => {
    const assistantMsgId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    lunaDraftRef.current = turn.draft;
    setLunaDraft(turn.draft);
    setSelectedQuestionOption(null);
    setCustomOptionText('');
    setIsCustomEditing(false);
    setIsQuestionCardDismissed(!turn.questionCard);

    setMessages(prev => [
      ...prev,
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        reasoning: turn.reasoning,
        planStatus: turn.planStatus,
        tasksCount: turn.tasksCount,
        tasks: turn.tasks,
        questionPendingText: turn.questionPendingText,
        questionCard: turn.questionCard || undefined,
        actions: turn.actions,
        timestamp: Date.now(),
      },
    ]);

    let currentText = '';
    const words = turn.content.split(' ');
    for (let i = 0; i < words.length; i += 2) {
      if (signal?.aborted) break;
      const chunk = words.slice(i, i + 2).join(' ');
      currentText += (i === 0 ? '' : ' ') + chunk;
      setMessages(prev => prev.map(m => (m.id === assistantMsgId ? { ...m, content: currentText } : m)));
      await new Promise(r => setTimeout(r, 12));
    }

    if (!signal?.aborted && currentText !== turn.content) {
      setMessages(prev => prev.map(m => (m.id === assistantMsgId ? { ...m, content: turn.content } : m)));
    }
  };

  const finalizeStreamedTurn = (streamMsgId: string, turn: LunaBrainTurnResult, hasBubble: boolean) => {
    lunaDraftRef.current = turn.draft;
    setLunaDraft(turn.draft);
    setSelectedQuestionOption(null);
    setCustomOptionText('');
    setIsCustomEditing(false);
    setIsQuestionCardDismissed(!turn.questionCard);

    if (hasBubble) {
      setMessages(prev =>
        prev.map(m =>
          m.id === streamMsgId
            ? {
                ...m,
                content: turn.content,
                reasoning: turn.reasoning ?? m.reasoning,
                modelLabel: turn.modelLabel,
                planStatus: turn.planStatus,
                tasksCount: turn.tasksCount,
                tasks: turn.tasks,
                questionPendingText: turn.questionPendingText,
                questionCard: turn.questionCard || undefined,
                actions: turn.actions,
              }
            : m
        )
      );
      return;
    }

    setMessages(prev => [
      ...prev,
      {
        id: streamMsgId,
        role: 'assistant',
        content: turn.content,
        reasoning: turn.reasoning,
        modelLabel: turn.modelLabel,
        planStatus: turn.planStatus,
        tasksCount: turn.tasksCount,
        tasks: turn.tasks,
        questionPendingText: turn.questionPendingText,
        questionCard: turn.questionCard || undefined,
        actions: turn.actions,
        timestamp: Date.now(),
      },
    ]);
  };

  const runFreeformLunaTurn = async (text: string, signal: AbortSignal) => {
    const snap = missionPlannerStore.getSnapshot();
    const history = messages
      .filter(m => !m.isInitialGreeting && m.content.trim().length > 0)
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content }));

    const streamMsgId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let hasCreatedStreamBubble = false;

    const turn = await processFreeformLunaMessage({
      userText: text,
      draft: lunaDraftRef.current,
      storeSnapshot: snap,
      history,
      chatEndpoint,
      signal,
      onDelta: (delta) => {
        if (signal.aborted) return;
        if (!delta.content && !delta.reasoning) return;
        if (!hasCreatedStreamBubble) {
          hasCreatedStreamBubble = true;
          setMessages(prev => [
            ...prev,
            {
              id: streamMsgId,
              role: 'assistant',
              content: delta.content,
              reasoning: delta.reasoning || undefined,
              timestamp: Date.now(),
            },
          ]);
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.id === streamMsgId
                ? {
                    ...m,
                    content: delta.content || m.content,
                    reasoning: delta.reasoning || m.reasoning,
                  }
                : m
            )
          );
        }
      },
    });

    if (signal.aborted) return;

    if (turn.alreadyStreamed) {
      finalizeStreamedTurn(streamMsgId, turn, hasCreatedStreamBubble);
      return;
    }

    if (hasCreatedStreamBubble) {
      setMessages(prev => prev.filter(m => m.id !== streamMsgId));
    }
    await streamBrainTurn(turn, signal);
  };

  const handleQuestionAnswerSubmit = (answerText: string) => {
    const trimmed = answerText.trim();
    if (!trimmed || isLoading || missionStore.busy) return;
    const wasCustomAnswer = isCustomEditing;
    setIsQuestionCardDismissed(true);
    if (!isAgentSetupComplete && !isSetupCompleteHold) {
      triggerSetupCompletion();
    }

    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: trimmed, timestamp: Date.now() }]);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    (async () => {
      try {
        if (lunaDraftRef.current.phase === 'checked' || wasCustomAnswer) {
          await runFreeformLunaTurn(trimmed, controller.signal);
          return;
        }
        const snap = missionPlannerStore.getSnapshot();
        const turn: LunaBrainTurnResult = advanceDiscoveryConversation(trimmed, lunaDraftRef.current, snap);
        if (controller.signal.aborted) return;
        await streamBrainTurn(turn, controller.signal);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setMessages(prev => [
            ...prev,
            {
              id: `${Date.now()}-qerr`,
              role: 'assistant',
              content: err?.message || 'Could not evaluate that option. Please try another selection or type a custom value.',
              timestamp: Date.now(),
            },
          ]);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  };

  const handleSendMessage = async (overrideText?: string) => {
    const text = (typeof overrideText === 'string' ? overrideText : inputText).trim();
    if (!text || isLoading || missionStore.busy) return;

    if (typeof overrideText !== 'string') setInputText('');
    setIsQuestionCardDismissed(true);
    if (!isAgentSetupComplete && !isSetupCompleteHold) {
      triggerSetupCompletion();
    }

    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: text, timestamp: Date.now() }]);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await runFreeformLunaTurn(text, controller.signal);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages(prev => [
          ...prev,
          {
            id: `${Date.now()}-cerr`,
            role: 'assistant',
            content: err?.message || 'I encountered an issue processing that mission instruction. Try specifying a 2026–2027 UTC date, Connecting Ridge site, or ask "why did this fail?".',
            timestamp: Date.now(),
          },
        ]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLunaAction = async (act: LunaActionButton) => {
    if (isLoading || missionStore.busy) return;

    if (act.kind === 'open_manual') {
      onOpenManualPlanner?.();
      return;
    }

    if (act.kind === 'open_api_key') {
      setSelectedModelForInput(NEMOTRON_MODEL_ID);
      setIsApiKeyModalOpen(true);
      return;
    }

    if (act.kind === 'camera') {
      missionPlannerStore.setCameraFocus(act.payload || 'default');
      return;
    }

    if (act.kind === 'adopt_preview') {
      missionPlannerStore.adoptPreview('auto');
      const adopted = missionPlannerStore.getSnapshot().baseline;
      if (adopted) {
        const nextTurn = buildCheckResultTurn(adopted, {
          isPreview: false,
          intent: lunaDraftRef.current.intent,
          focusTopic: lunaDraftRef.current.focusTopic,
        });
        setMessages(prev => [
          ...prev,
          {
            id: `${Date.now()}-adopt`,
            role: 'assistant',
            content: `Revised plan adopted as your **Current Plan** and synced across the HUD & Manual Planner.\n\n${nextTurn.content}`,
            actions: nextTurn.actions,
            timestamp: Date.now(),
          },
        ]);
      }
      return;
    }

    if (act.kind === 'discard_preview') {
      missionPlannerStore.discardPreview();
      setMessages(prev => [
        ...prev,
        {
          id: `${Date.now()}-discard`,
          role: 'assistant',
          content: 'Kept your original current plan and cleared the preview in the left HUD.',
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsLoading(true);
    setIsQuestionCardDismissed(true);

    try {
      if (act.kind === 'hardware_q') {
        const turn = advanceDiscoveryConversation('__hardware_q__', lunaDraftRef.current, missionPlannerStore.getSnapshot());
        await streamBrainTurn(turn, controller.signal);
        return;
      }

      if (act.kind === 'start_over') {
        const turn = await processPostCheckMessage('start over', lunaDraftRef.current, missionPlannerStore.getSnapshot(), controller.signal);
        await streamBrainTurn(turn, controller.signal);
        return;
      }

      if (act.kind === 'check_plan') {
        const settingsToRun = act.payload?.settings || lunaDraftRef.current.draftSettings;
        const result = await missionPlannerStore.checkPlan(settingsToRun, {
          asPreview: false,
          markChecked: true,
          source: 'auto',
        });
        if (controller.signal.aborted) return;

        onAssignTask?.({
          title: `Check lunar plan: ${result.site.name}`,
          agentValue: agentKey,
          agentLabel: agent.title,
          priority: 'High',
        });

        const checkedDraft: LunaDraftState = {
          ...lunaDraftRef.current,
          phase: 'checked',
          draftSettings: result.settings,
        };
        const turnBody = buildCheckResultTurn(result, {
          isPreview: false,
          intent: checkedDraft.intent,
          focusTopic: checkedDraft.focusTopic,
        });
        await streamBrainTurn({ ...turnBody, draft: checkedDraft }, controller.signal);
        return;
      }

      if (act.kind === 'search_alternatives') {
        const activeRes = missionPlannerStore.getActiveResult();
        if (!activeRes) return;
        const mode = act.payload || lunaDraftRef.current.searchMode || 'both';
        const choices = await missionPlannerStore.searchAlternatives(mode);
        if (controller.signal.aborted) return;
        const turn = formatAlternativesResponse(choices, activeRes, lunaDraftRef.current);
        await streamBrainTurn(turn, controller.signal);
        return;
      }

      if (act.kind === 'preview_alternative') {
        const res = await missionPlannerStore.checkPlan(act.payload, {
          asPreview: true,
          markChecked: true,
          source: 'auto',
        });
        if (controller.signal.aborted) return;
        const turnBody = buildCheckResultTurn(res, { isPreview: true, intent: lunaDraftRef.current.intent });
        await streamBrainTurn({ ...turnBody, draft: { ...lunaDraftRef.current, phase: 'checked' } }, controller.signal);
        return;
      }

      if (act.kind === 'test_delay') {
        const activeRes = missionPlannerStore.getActiveResult();
        if (!activeRes) return;
        const days = act.payload?.days ?? 1;
        const shiftedStart = new Date(Date.parse(activeRes.settings.startUTC) + days * 86400000).toISOString();
        const res = await missionPlannerStore.checkPlan({ startUTC: shiftedStart }, { asPreview: true, markChecked: true, source: 'auto' });
        if (controller.signal.aborted) return;
        const turnBody = buildCheckResultTurn(res, { isPreview: true, intent: lunaDraftRef.current.intent });
        await streamBrainTurn({ ...turnBody, draft: { ...lunaDraftRef.current, phase: 'checked' } }, controller.signal);
        return;
      }

      if (act.kind === 'latest_start') {
        const turn = await processPostCheckMessage('latest safe start', lunaDraftRef.current, missionPlannerStore.getSnapshot(), controller.signal);
        if (controller.signal.aborted) return;
        await streamBrainTurn(turn, controller.signal);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages(prev => [
          ...prev,
          {
            id: `${Date.now()}-aerr`,
            role: 'assistant',
            content: err?.message || 'Unable to execute that planner action.',
            timestamp: Date.now(),
          },
        ]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="relative w-full h-screen min-h-full flex flex-col lg:flex-row overflow-hidden bg-[#141414] select-none font-sans">
      <style dangerouslySetInnerHTML={{ __html: STANDALONE_STYLES }} />

      {/* Fallback Fullscreen Black Preload Overlay when used standalone */}
      {!hasExternalOverlay && showLoadOverlay && (
        <div
          aria-busy="true"
          aria-label="Loading Mission Planner"
          className={`fixed inset-0 z-[90] bg-black flex flex-col items-center justify-center gap-6 transition-opacity duration-[350ms] ease-out ${isSceneAssetsLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
            }`}
        >
          <div className="relative flex items-center justify-center w-36 h-36">
            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
            <div className="absolute inset-0 rounded-full luna-tricolor-ring animate-spin" />
            <div className="relative z-10 w-24 h-24 rounded-full overflow-hidden flex items-center justify-center">
              <img
                src="/assets/aistudio/Luna_Shift__3__4181c459.png"
                alt="LunaShift Logo"
                decoding="sync"
                loading="eager"
                className="w-full h-full object-contain scale-[1.08]"
              />
            </div>
          </div>
          <div className="text-[12.65px] font-mono tracking-[0.26em] uppercase">
            <span className="planner-silver-shimmer">Loading Mission Planner</span>
          </div>
        </div>
      )}

      {/* Left Box (Canvas Workspace) */}
      <div className="flex-1 min-w-0 h-full p-2.5 sm:p-3 flex flex-col">
        <div
          className="w-full h-full rounded-[22px] flex flex-col relative overflow-hidden border border-white/[0.08]"
          style={{ backgroundColor: '#222222' }}
        >
          {/* Top Header */}
          <div className="h-20 px-4 flex items-center justify-between border-b border-white/5 shrink-0 relative z-30">
            <div className="flex items-center gap-3 z-10 min-w-0 max-w-[35%]">
              <div className="w-[58px] h-[58px] rounded-full overflow-hidden shrink-0 flex items-center justify-center">
                <img
                  src="/assets/aistudio/Luna_Shift__3__4181c459.png"
                  alt="LunaShift Logo"
                  className="w-full h-full object-contain scale-[1.08]"
                />
              </div>
            </div>

            {/* Centered Decrypted Header Title */}
            <div className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center justify-center">
              {effectiveRevealComplete && (
                <DecryptedText
                  text="Luna Planner"
                  animateOn="inViewHover"
                  effect="fade"
                  sequential={true}
                  revealDirection="start"
                  speed={50}
                  maxIterations={11}
                  hoverRadius={100}
                  scrambleColor="#2bb673"
                  loop={false}
                  loopDelay={2000}
                  useOriginalCharsOnly={false}
                  characters="01"
                  parentClassName="text-[15px] sm:text-base font-mono font-medium tracking-[0.22em] uppercase text-white/95 cursor-default select-none"
                  className="text-white/95"
                  encryptedClassName="text-white/70"
                />
              )}
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2.5 z-10">
              {/* Toggle Side Chat Button */}
              <button
                type="button"
                onClick={() => setIsChatOpen(!isChatOpen)}
                className={`w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors cursor-pointer ${isChatOpen ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                aria-label="Toggle side chat"
                title={isChatOpen ? 'Collapse chat' : 'Expand chat'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                  <path d="M500-640v320l160-160-160-160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm120-80v-560H200v560h120Zm80 0h360v-560H400v560Zm-80 0H200h120Z" />
                </svg>
              </button>

              <div className="w-px h-4 bg-white/10 mx-0.5" />

              {/* Controls Button */}
              <button
                type="button"
                onClick={() => onOpenManualPlanner?.()}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="manual"
                title="manual"
              >
                <IconSlidersVertical size="20px" />
              </button>

              {/* Close button */}
              <button
                type="button"
                onClick={() => onClose?.()}
                className="w-7 h-7 flex items-center justify-center text-neutral-400 hover:text-[#ff0064] transition-colors cursor-pointer"
                aria-label="Close builder"
                title="Close"
              >
                <X className="w-[15px] h-[15px]" />
              </button>
            </div>
          </div>

          {/* Canvas Main Center Body (3D Lunar Surface View + Reflected Plan HUD) */}
          <div ref={canvasRef} className="flex-1 relative z-0 overflow-hidden bg-black">
            <LunarRoverScene
              embedded
              syncToMissionStore
              initialOverview={false}
              active={sceneActive}
              pauseDescent={!effectiveRevealComplete}
              hideLoadingScreen
              onAssetsLoaded={() => {
                setIsSceneAssetsLoaded(true);
                onAssetsLoaded?.();
              }}
            />
            <PlannerHudOverlay active={sceneActive} onOpenManualPlanner={onOpenManualPlanner} />
          </div>
        </div>
      </div>

      {/* Right Chat Side Panel */}
      <AnimatePresence initial={false}>
        {isChatOpen && (
          <motion.div
            initial={{ maxWidth: 0, opacity: 0 }}
            animate={{ maxWidth: 500, opacity: 1 }}
            exit={{ maxWidth: 0, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
            className="h-full flex flex-col shrink-0 overflow-hidden"
            style={{ backgroundColor: '#141414' }}
          >
            <div className="w-[100vw] lg:w-[381px] xl:w-[418px] flex flex-col h-full shrink-0 px-2.5 pb-2.5 pt-3 sm:pr-3 sm:pb-3 lg:pl-0.5">
              <div className="relative z-20 flex justify-center shrink-0 pointer-events-none -mb-[13px]">
                <LunaMascot responding={isLoading || missionStore.busy} active={sceneActive && isChatOpen} />
              </div>
              <div
                className="relative z-10 flex-1 min-h-0 flex flex-col rounded-[22px] border border-white/[0.08] overflow-hidden"
                style={{ backgroundColor: '#171717' }}
              >
                <div className="flex-1 overflow-y-auto px-4 pt-5 pb-4 space-y-4 chat-scrollbar-hidden">

                {/* Conversation Messages */}
                {messages.map(msg => (
                  <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {msg.role === 'user' ? (
                      <div
                        className="max-w-[90%] rounded-[22px] px-3.5 py-2.5 text-[11.8px] text-white border border-white/[0.08]"
                        style={{ backgroundColor: '#222222' }}
                      >
                        <p className="select-text whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      </div>
                    ) : (
                      <div className="w-full space-y-2.5">
                        {msg.planStatus && (
                          <div className="space-y-1.5 pt-1">
                            <div className="flex items-center justify-between text-[13px] text-[#8e9196] font-normal">
                              <span className="flex items-center gap-1.5">
                                <StatusMark status="done" size={13} strokeWidth={2.2} />
                                <span>{msg.planStatus}</span>
                              </span>
                              {msg.tasksCount && (
                                <button
                                  type="button"
                                  onClick={() => toggleTasks(msg.id)}
                                  className="flex items-center gap-1 cursor-pointer hover:text-neutral-300 transition-colors bg-transparent border-0 p-0 text-[13px] text-[#8e9196]"
                                >
                                  <span>{msg.tasksCount}</span>
                                  <ChevronRight
                                    className={`w-3.5 h-3.5 opacity-60 transition-transform ${expandedTasksIds[msg.id] ? 'rotate-90' : ''
                                      }`}
                                  />
                                </button>
                              )}
                            </div>

                            <AnimatePresence>
                              {expandedTasksIds[msg.id] && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden rounded-xl p-2.5 bg-white/[0.02] border border-white/[0.06] space-y-2 mt-1"
                                >
                                  {(msg.tasks || []).map((task, tIdx) => (
                                    <div key={task.id || tIdx} className="flex items-center py-0.5">
                                      <StatusMark
                                        status={task.status}
                                        progress={task.progress}
                                        label={<span className="text-[11.5px] text-neutral-300 font-sans">{task.label}</span>}
                                        size={15}
                                        strokeWidth={2}
                                        fontSize={11.5}
                                        strike
                                      />
                                    </div>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}

                        {msg.reasoning && (
                          <div className="space-y-1.5">
                            <button
                              type="button"
                              onClick={() => toggleReasoning(msg.id)}
                              className="flex items-center gap-1 text-[13px] text-[#8e9196] hover:text-neutral-200 transition-colors cursor-pointer group"
                            >
                              <span>Reasoning</span>
                              <ChevronRight
                                className={`w-3.5 h-3.5 transition-transform duration-200 opacity-60 group-hover:opacity-100 ${expandedReasoningIds[msg.id] ? 'rotate-90' : ''
                                  }`}
                              />
                            </button>

                            <AnimatePresence>
                              {expandedReasoningIds[msg.id] && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="rounded-xl p-2.5 bg-transparent border-0 text-[10.5px] text-neutral-300/90 leading-relaxed font-mono whitespace-pre-wrap select-text">
                                    {msg.reasoning}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}

                        {msg.content ? (
                          <div className="text-[13.6px] text-[#e3e3e3] leading-[1.65] select-text font-normal max-w-[68ch]">
                            {msg.isInitialGreeting ? (
                              <LunaGreetingText
                                content={msg.content}
                                fullText={LUNA_GREETING_TEXT}
                                shimmerActive={isGreetingShimmerActive}
                                onShimmerComplete={handleGreetingShimmerComplete}
                              />
                            ) : (
                              <ReactMarkdown
                                components={{
                                  h3: ({ children }) => (
                                    <h3 className="text-[14.5px] font-semibold text-white mt-0.5 mb-1.5 tracking-tight">
                                      {children}
                                    </h3>
                                  ),
                                  strong: ({ children }) => (
                                    <strong className="font-semibold text-white">{children}</strong>
                                  ),
                                  ol: ({ children }) => (
                                    <ol className="ml-4 mb-2 space-y-1 list-decimal text-neutral-200">{children}</ol>
                                  ),
                                  p: ({ children }) => {
                                    const text = extractNodeText(children).trim();
                                    const parsed = parseStatusMarkLine(text);
                                    if (parsed && text.startsWith('[STATUS:')) {
                                      return (
                                        <div className="my-1.5 py-0.5 flex items-center">
                                          <StatusMark
                                            status={parsed.status}
                                            progress={parsed.progress}
                                            label={<span className="text-[13.6px] text-[#e3e3e3]">{parsed.label}</span>}
                                            size={16}
                                            strokeWidth={2}
                                            fontSize={13.6}
                                            strike
                                          />
                                        </div>
                                      );
                                    }
                                    return <p className="mb-2 last:mb-0 leading-relaxed font-sans">{children}</p>;
                                  },
                                  ul: ({ children }) => <ul className="ml-1 mb-2 space-y-1 list-none">{children}</ul>,
                                  li: ({ children }) => {
                                    const text = extractNodeText(children).trim();
                                    const parsed = parseStatusMarkLine(text);
                                    if (parsed) {
                                      return (
                                        <li className="list-none my-1 flex items-center">
                                          <StatusMark
                                            status={parsed.status}
                                            progress={parsed.progress}
                                            label={<span className="text-[13.6px] text-[#e3e3e3]">{parsed.label}</span>}
                                            size={16}
                                            strokeWidth={2}
                                            fontSize={13.6}
                                            strike
                                          />
                                        </li>
                                      );
                                    }
                                    return <li className="leading-relaxed font-sans pl-1">{children}</li>;
                                  },
                                }}
                              >
                                {msg.content}
                              </ReactMarkdown>
                            )}
                          </div>
                        ) : null}

                        {msg.actions && msg.actions.length > 0 && (!isLoading || msg.id !== messages[messages.length - 1]?.id) && (
                          <div className="flex flex-wrap items-center gap-2.5 pt-2 pb-0.5">
                            {msg.actions.map((act) => {
                              const isPrimary = act.variant === 'primary';
                              const isSubtle = act.variant === 'subtle';
                              const isDisabled = isLoading || missionStore.busy;
                              const isSpecularCta = isSpecularChatAction(act);
                              const actionKey = `${msg.id}:${act.id}`;
                              const useLiveSpecular = isSpecularCta && liveSpecularActionKeys.has(actionKey);

                              if (useLiveSpecular) {
                                return (
                                  <SpecularButton
                                    key={act.id}
                                    type="button"
                                    size="sm"
                                    radius={999}
                                    tint="#ffffff"
                                    tintOpacity={isDisabled ? 0.05 : isPrimary ? 0.13 : 0.09}
                                    blur={12}
                                    textColor={isDisabled ? '#a3a3a3' : '#ffffff'}
                                    lineColor="#ffffff"
                                    baseColor="#d4d4d8"
                                    intensity={isDisabled ? 0.35 : 1.05}
                                    idleIntensity={0.45}
                                    shineSize={12}
                                    shineFade={36}
                                    thickness={1.3}
                                    glow={1}
                                    followMouse
                                    proximity={250}
                                    autoAnimate={
                                      !isDisabled && (act.kind === 'check_plan' || isPrimary)
                                    }
                                    disabled={isDisabled}
                                    onClick={() => handleLunaAction(act)}
                                    className="luna-chat-specular"
                                  >
                                    {act.kind === 'check_plan' && (
                                      <Check className="w-3.5 h-3.5 stroke-[2.5] text-white" />
                                    )}
                                    <span>{act.label}</span>
                                  </SpecularButton>
                                );
                              }

                              if (isSpecularCta) {
                                return (
                                  <button
                                    key={act.id}
                                    type="button"
                                    disabled={isDisabled}
                                    onClick={() => handleLunaAction(act)}
                                    className="specular-button luna-chat-specular specular-button--fallback-white rounded-full"
                                  >
                                    {act.kind === 'check_plan' && (
                                      <Check className="w-3.5 h-3.5 stroke-[2.5] text-white" />
                                    )}
                                    <span>{act.label}</span>
                                  </button>
                                );
                              }

                              return (
                                <button
                                  key={act.id}
                                  type="button"
                                  disabled={isDisabled}
                                  onClick={() => handleLunaAction(act)}
                                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-all ${
                                    isDisabled
                                      ? 'opacity-50 cursor-not-allowed bg-white/5 text-neutral-400 border border-white/10'
                                      : isSubtle
                                      ? 'cursor-pointer bg-white/[0.03] hover:bg-white/[0.09] text-neutral-300 hover:text-white border border-white/10'
                                      : 'cursor-pointer bg-white/[0.08] hover:bg-white/[0.15] text-white border border-white/15'
                                  }`}
                                >
                                  <span>{act.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {msg.questionPendingText && activeQuestionMsg?.id === msg.id && (
                          <div className="pt-1">
                            <div className="w-full rounded-[14px] px-4 py-3 text-[10.5px] text-[#8e9196] bg-transparent border-0 select-none">
                              {msg.questionPendingText}
                            </div>
                          </div>
                        )}

                        {msg.content && (
                          <div className="flex items-center gap-1.5 text-neutral-500 pt-0.5">
                            <button
                              type="button"
                              onClick={() => handleCopyText(msg.content, msg.id)}
                              className="p-1 rounded-md hover:bg-white/5 hover:text-neutral-300 transition-colors cursor-pointer"
                              aria-label="Copy response"
                            >
                              {copiedMessageId === msg.id ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Thinking Indicator (hidden once tokens stream into the current assistant message) */}
                {isLoading && !(messages[messages.length - 1]?.role === 'assistant' && Boolean(messages[messages.length - 1]?.content)) && (
                  <div className="flex flex-col gap-1 py-1 select-none">
                    <div className="flex items-center gap-2 pl-1">
                      <span className="shimmer-text font-medium text-[14px] tracking-tight">Thinking</span>
                      <StatusMark
                        status="running"
                        color="#ffffff"
                        size={14}
                        strokeWidth={2}
                      />
                    </div>

                    <div className="pl-1">
                      <button
                        type="button"
                        onClick={() => toggleReasoning('thinking-reasoning')}
                        className="flex items-center gap-1 text-[13px] text-[#8e9196] hover:text-neutral-200 transition-colors cursor-pointer group"
                      >
                        <span>Reasoning</span>
                        <ChevronRight
                          className={`w-3.5 h-3.5 transition-transform duration-200 opacity-60 group-hover:opacity-100 ${expandedReasoningIds['thinking-reasoning'] ? 'rotate-90' : ''
                            }`}
                        />
                      </button>

                      <AnimatePresence>
                        {expandedReasoningIds['thinking-reasoning'] && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="rounded-xl p-2.5 bg-transparent border-0 text-[10.5px] text-neutral-300/90 leading-relaxed font-mono whitespace-pre-wrap select-text mt-1">
                              {`1. Parsing lunar landing site, UTC window, and mission budget...\n2. Evaluating LOLA 5m/80m terrain horizons & DE421 illumination...\n3. Dispatching battery reserve & DSN link margin simulation.`}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Bottom Control Area */}
              <div className="p-4 pt-1 bg-transparent">
                {activeQuestionMsg?.questionCard ? (
                  (() => {
                    const activeCard = activeQuestionMsg.questionCard;
                    if (!activeCard) return null;

                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ duration: 0.2 }}
                        className="w-full rounded-[22px] p-3.5 border border-white/[0.08] shadow-xl space-y-2.5 select-none"
                        style={{ backgroundColor: '#222222' }}
                      >
                        <h4 className="text-[13.5px] font-semibold text-white tracking-tight leading-snug">
                          {activeCard.title}
                        </h4>

                        <div className="space-y-1.5">
                          {activeCard.options.map((opt, optIdx) => {
                            const isSelected = selectedQuestionOption === opt.label;
                            return (
                              <button
                                key={opt.id || optIdx}
                                type="button"
                                onClick={() => {
                                  setSelectedQuestionOption(opt.label);
                                  setIsCustomEditing(false);
                                }}
                                className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-colors text-left cursor-pointer ${isSelected
                                    ? 'bg-[#0da1b2]/15 text-[#0da1b2] font-semibold'
                                    : 'text-[#d1d5db] hover:bg-[#0da1b2]/15 hover:text-[#0da1b2]'
                                  }`}
                              >
                                <div
                                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${isSelected
                                      ? 'bg-[#0da1b2] text-white font-semibold'
                                      : 'bg-white/10 text-neutral-400 font-medium'
                                    }`}
                                >
                                  {optIdx + 1}
                                </div>
                                <span className="text-[12.5px] font-normal leading-tight">{opt.label}</span>
                              </button>
                            );
                          })}

                          <div className="pt-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setIsCustomEditing(true);
                                setSelectedQuestionOption(customOptionText || 'Something else...');
                              }}
                              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-colors text-left cursor-pointer ${isCustomEditing
                                  ? 'bg-[#0da1b2]/15 text-[#0da1b2] font-semibold'
                                  : 'text-[#9ca3af] hover:bg-[#0da1b2]/15 hover:text-[#0da1b2]'
                                }`}
                            >
                              <div
                                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 ${isCustomEditing ? 'bg-[#0da1b2] text-white' : 'bg-white/10 text-neutral-400'
                                  }`}
                              >
                                <Pencil className="w-2.5 h-2.5" />
                              </div>
                              <span className="text-[12.5px] font-normal leading-tight">Something else...</span>
                            </button>

                            {isCustomEditing && (
                              <div className="mt-1.5 pl-6.5 pr-1">
                                <input
                                  type="text"
                                  value={customOptionText}
                                  onChange={e => {
                                    setCustomOptionText(e.target.value);
                                    setSelectedQuestionOption(e.target.value);
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && customOptionText.trim()) {
                                      e.preventDefault();
                                      handleQuestionAnswerSubmit(customOptionText);
                                    }
                                  }}
                                  placeholder="Specify your custom preference..."
                                  autoFocus
                                  className="w-full bg-[#1e1f20] border border-white/10 rounded-md px-2.5 py-1 text-[12px] text-white placeholder:text-neutral-500 outline-none focus:border-white/25 transition-all"
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/5">
                          <button
                            type="button"
                            onClick={() => setIsQuestionCardDismissed(true)}
                            className="text-[12px] font-medium text-[#d1d5db] hover:text-white px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            disabled={!selectedQuestionOption || (isCustomEditing && !customOptionText.trim())}
                            onClick={() => {
                              if (selectedQuestionOption) handleQuestionAnswerSubmit(selectedQuestionOption);
                            }}
                            className={`px-3 py-1 rounded-lg text-[12px] font-medium transition-all cursor-pointer ${selectedQuestionOption && (!isCustomEditing || customOptionText.trim())
                                ? 'bg-[#3c3e42] hover:bg-[#4a4c52] text-white shadow-sm'
                                : 'bg-[#333538] text-neutral-500 cursor-not-allowed'
                              }`}
                          >
                            Submit answer
                          </button>
                        </div>
                      </motion.div>
                    );
                  })()
                ) : (
                  <div
                    className="rounded-[20px] p-3 border border-white/[0.08] flex flex-col gap-2.5 focus-within:border-white/20 transition-all"
                    style={{ backgroundColor: '#222222' }}
                  >
                    <textarea
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask Luna about sites, UTC dates, delays, power margins, or type custom parameters..."
                      rows={2}
                      className="w-full bg-transparent text-[13px] text-neutral-200 placeholder:text-[#8e8e93] resize-none outline-none leading-relaxed"
                    />

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={toggleListening}
                          onMouseEnter={() => setIsHoveringWave(true)}
                          onMouseLeave={() => setIsHoveringWave(false)}
                          title={isListening ? 'Listening... Click to stop' : 'Click to speak via microphone'}
                          className="w-8 h-8 rounded-full flex items-center justify-center gap-[2.5px] transition-colors cursor-pointer bg-transparent border-0 shadow-none hover:opacity-80 active:scale-95"
                        >
                          {isListening ? (
                            <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#d4d4d8">
                              <path d="M520-200v-560h240v560H520Zm-320 0v-560h240v560H200Zm400-80h80v-400h-80v400Zm-320 0h80v-400h-80v400Zm0-400v400-400Zm320 0v400-400Z" />
                            </svg>
                          ) : (
                            [
                              { h: '6px', d: 0 },
                              { h: '11px', d: 0.08 },
                              { h: '16px', d: 0.16 },
                              { h: '21px', d: 0.24 },
                              { h: '16px', d: 0.32 },
                              { h: '11px', d: 0.4 },
                              { h: '6px', d: 0.48 },
                            ].map((bar, idx) => (
                              <motion.span
                                key={idx}
                                className="w-[1.8px] rounded-full block transition-colors bg-neutral-300"
                                style={{ height: bar.h }}
                                animate={isHoveringWave ? { scaleY: [1, 1.5, 1] } : { scaleY: 1 }}
                                transition={
                                  isHoveringWave ? { duration: 0.9, ease: 'easeInOut', delay: bar.d } : { duration: 0.2 }
                                }
                              />
                            ))
                          )}
                        </button>
                      </div>

                      {isLoading ? (
                        <button
                          type="button"
                          onClick={handleStop}
                          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium bg-[#3c3e42] hover:bg-[#4a4c52] text-neutral-300 hover:text-white transition-colors cursor-pointer"
                          aria-label="Stop generation"
                          title="Stop generation"
                        >
                          <Square className="w-2.5 h-2.5 fill-current" />
                          <span>Stop</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSendMessage()}
                          disabled={!inputText.trim()}
                          title="Send"
                          className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium border transition-colors cursor-pointer ${inputText.trim()
                              ? 'bg-white/[0.06] hover:bg-white/[0.12] text-white border-white/[0.08]'
                              : 'bg-white/[0.02] text-neutral-500 border-white/[0.04] cursor-not-allowed opacity-60'
                            }`}
                        >
                          <span className="size-3.5 flex items-center justify-center">
                            <PaperPlaneTiltIcon weight="fill" />
                          </span>
                          <span>Send</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        agentTitle={agent.title}
        onNotify={showToast}
        initialModelId={selectedModelForInput || effectiveModelMeta.id}
        serverAiStatus={serverAiStatus}
      />

      <EditNameModal
        isOpen={isEditNameModalOpen}
        onClose={() => setIsEditNameModalOpen(false)}
        currentName={agent.title}
        onSave={handleSaveNewName}
      />

      {showDeleteConfirm && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-[#1e1e1e] border border-white/5 rounded-[22px] p-6 max-w-[420px] w-full shadow-2xl flex flex-col gap-4 text-left">
            <div className="flex items-center justify-between">
              <h3 className="text-white text-[17px] font-medium tracking-tight">Delete agent request</h3>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteUnderstandText('');
                }}
                className="text-neutral-400 hover:text-white transition-colors cursor-pointer p-1"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[#d0d0d0] text-[14px] leading-snug">
              Are you sure you want to delete <span className="text-white font-medium">"{agent.title}"</span>? This action
              can not be undone. You will lose the agent data forever.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <label className="text-neutral-300 text-[13px] font-medium">Do you understand?</label>
              <input
                type="text"
                value={deleteUnderstandText}
                onChange={e => setDeleteUnderstandText(e.target.value)}
                placeholder='Type "I understand"'
                className="w-full bg-[#2a2a2a] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30 transition-all"
                autoFocus
              />
            </div>
            <div className="flex justify-end items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteUnderstandText('');
                }}
                className="px-4 py-2.5 text-neutral-300 hover:text-white text-[14px] font-medium transition-colors cursor-pointer"
              >
                Disallow
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteUnderstandText.trim().toLowerCase() !== 'i understand'}
                className={`px-5 py-2.5 rounded-full text-[14px] font-medium transition-all ${deleteUnderstandText.trim().toLowerCase() === 'i understand'
                    ? 'bg-[#ff0064] hover:bg-[#ff0064]/90 text-white cursor-pointer shadow-lg shadow-[#ff0064]/20'
                    : 'bg-[#323232] text-neutral-500 cursor-not-allowed opacity-60'
                  }`}
              >
                Delete agent
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="fixed top-5 left-[32%] -translate-x-1/2 z-[130] px-4 py-2 rounded-xl bg-[#1e1e24] border border-white/15 text-white shadow-2xl text-xs font-medium flex items-center gap-2 select-none"
          >
            <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AgentBuilderPage;
