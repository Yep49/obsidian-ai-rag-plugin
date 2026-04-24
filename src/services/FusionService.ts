// 融合服务 - 合并多路召回结果

export interface RecallResult {
  id: string;
  score: number;
  source: string; // 'dense', 'sparse', 'feedback', 'meta'
}

export class FusionService {
  // Reciprocal Rank Fusion (RRF)
  reciprocalRankFusion(
    resultLists: Array<RecallResult[]>,
    k = 60
  ): RecallResult[] {
    const scoreMap = new Map<string, { score: number; sources: Set<string> }>();

    for (const results of resultLists) {
      results.forEach((result, rank) => {
        const rrfScore = 1 / (k + rank + 1);

        const existing = scoreMap.get(result.id);
        if (existing) {
          existing.score += rrfScore;
          existing.sources.add(result.source);
        } else {
          scoreMap.set(result.id, {
            score: rrfScore,
            sources: new Set([result.source])
          });
        }
      });
    }

    const merged = Array.from(scoreMap.entries()).map(([id, data]) => ({
      id,
      score: data.score,
      source: Array.from(data.sources).join('+'),
      sourceCount: data.sources.size
    }));

    // 按分数降序排序
    merged.sort((a, b) => b.score - a.score);

    return merged;
  }

  // Weighted Fusion（加权融合）
  weightedFusion(
    resultLists: Array<{ results: RecallResult[]; weight: number }>,
    normalize = true
  ): RecallResult[] {
    const scoreMap = new Map<string, { score: number; sources: Set<string> }>();

    for (const { results, weight } of resultLists) {
      // 归一化分数
      const maxScore = results.length > 0 ? Math.max(...results.map(r => r.score)) : 1;
      const minScore = results.length > 0 ? Math.min(...results.map(r => r.score)) : 0;
      const range = maxScore - minScore || 1;

      results.forEach(result => {
        const normalizedScore = normalize
          ? (result.score - minScore) / range
          : result.score;

        const weightedScore = normalizedScore * weight;

        const existing = scoreMap.get(result.id);
        if (existing) {
          existing.score += weightedScore;
          existing.sources.add(result.source);
        } else {
          scoreMap.set(result.id, {
            score: weightedScore,
            sources: new Set([result.source])
          });
        }
      });
    }

    const merged = Array.from(scoreMap.entries()).map(([id, data]) => ({
      id,
      score: data.score,
      source: Array.from(data.sources).join('+')
    }));

    merged.sort((a, b) => b.score - a.score);

    return merged;
  }

  // Distribution-based Fusion（基于分布的融合）
  distributionBasedFusion(
    resultLists: Array<RecallResult[]>,
    alpha = 0.5
  ): RecallResult[] {
    const scoreMap = new Map<string, number>();

    for (const results of resultLists) {
      if (results.length === 0) continue;

      // 计算分数的均值和标准差
      const scores = results.map(r => r.score);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
      const stdDev = Math.sqrt(variance);

      // Z-score 归一化
      results.forEach(result => {
        const zScore = stdDev > 0 ? (result.score - mean) / stdDev : 0;
        const normalizedScore = 1 / (1 + Math.exp(-zScore)); // Sigmoid

        scoreMap.set(
          result.id,
          (scoreMap.get(result.id) || 0) + normalizedScore
        );
      });
    }

    const merged = Array.from(scoreMap.entries()).map(([id, score]) => ({
      id,
      score,
      source: 'fused'
    }));

    merged.sort((a, b) => b.score - a.score);

    return merged;
  }

  // 去重并保留最高分
  deduplicate(results: RecallResult[]): RecallResult[] {
    const seen = new Map<string, RecallResult>();

    for (const result of results) {
      const existing = seen.get(result.id);
      if (!existing || result.score > existing.score) {
        seen.set(result.id, result);
      }
    }

    return Array.from(seen.values());
  }
}
