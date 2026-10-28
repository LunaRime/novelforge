/**
 * 文本质量硬闸门：字数区间 + 重复/循环检测。
 *
 * 背景（2026-10-22 实例测试）：第 26 章被模型循环生成成 28,658 字，
 * 同一段落重复 55 次；原 content_audit 是非关键后处理，不阻断定稿。
 * 本模块提供确定性判断，供整本流水线与定稿入口在写库前拦截。
 */
import { computeTextStats } from './text-stats';

export interface RepetitionReport {
  runaway: boolean;
  maxRepeat: number;
  repeatedChars: number;
  totalChars: number;
  ratio: number;
  sample: string;
}

export interface DraftQualityReport {
  severity: 'ok' | 'warn' | 'block';
  words: number;
  minWords: number;
  maxWords: number;
  repetition: RepetitionReport;
  reason: string;
}

const PUNCT_RE = /[\s，。！？；：、“”‘’（）…—\-,.!?;:'"(){}]/g;

function normalizeBlock(value: string): string {
  return value.replace(PUNCT_RE, '');
}

/** 检测长句/长行被重复输出（模型循环的典型形态） */
export function detectRunawayRepetition(text: string): RepetitionReport {
  const blocks = text
    .split(/\n+/)
    .map(normalizeBlock)
    .filter((s) => s.length >= 12);
  const counts = new Map<string, number>();
  let totalChars = 0;
  for (const block of blocks) {
    totalChars += block.length;
    counts.set(block, (counts.get(block) ?? 0) + 1);
  }
  let maxRepeat = 0;
  let repeatedChars = 0;
  let sample = '';
  for (const [block, count] of counts) {
    if (count > maxRepeat) {
      maxRepeat = count;
      sample = block.slice(0, 60);
    }
    if (count >= 3) repeatedChars += block.length * count;
  }
  const ratio = totalChars > 0 ? repeatedChars / totalChars : 0;
  return {
    runaway: maxRepeat >= 5 && ratio >= 0.2,
    maxRepeat,
    repeatedChars,
    totalChars,
    ratio,
    sample,
  };
}

export function assessDraftQuality(text: string, targetWords: number): DraftQualityReport {
  const words = computeTextStats(text).novelWordCount;
  const target = targetWords > 0 ? targetWords : 2000;
  const minWords = Math.round(target * 0.9);
  const maxWords = Math.round(target * 1.1);
  const repetition = detectRunawayRepetition(text);
  const hardMax = Math.max(5000, Math.round(maxWords * 2.5));

  if (repetition.runaway) {
    return {
      severity: 'block',
      words,
      minWords,
      maxWords,
      repetition,
      reason: `检测到循环重复：最长重复块 ${repetition.maxRepeat} 次，重复占比 ${(repetition.ratio * 100).toFixed(1)}%`,
    };
  }
  if (words > hardMax) {
    return {
      severity: 'block',
      words,
      minWords,
      maxWords,
      repetition,
      reason: `字数异常膨胀：${words} 字，超过硬上限 ${hardMax} 字`,
    };
  }
  if (words < minWords || words > maxWords) {
    return {
      severity: 'warn',
      words,
      minWords,
      maxWords,
      repetition,
      reason: `字数 ${words} 不在目标区间 ${minWords}–${maxWords}`,
    };
  }
  return {
    severity: 'ok',
    words,
    minWords,
    maxWords,
    repetition,
    reason: `字数 ${words} 在目标区间 ${minWords}–${maxWords}`,
  };
}
