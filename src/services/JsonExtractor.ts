/**
 * 智能 JSON 提取工具
 * 处理 LLM 返回的各种格式，提取有效的 JSON
 */
export class JsonExtractor {
  /**
   * 从文本中提取 JSON
   * 支持多种格式：纯 JSON、代码块、混合文本等
   */
  static extract(text: string): any {
    if (!text || text.trim().length === 0) {
      throw new Error('Empty response from LLM');
    }

    // 尝试1: 直接解析（最快）
    try {
      return JSON.parse(text.trim());
    } catch (e) {
      // 继续尝试其他方法
    }

    // 尝试2: 提取代码块中的 JSON
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch (e) {
        // 继续尝试
      }
    }

    // 尝试3: 查找第一个 { 到最后一个 }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonCandidate = text.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(jsonCandidate);
      } catch (e) {
        // 继续尝试
      }
    }

    // 尝试4: 查找第一个 [ 到最后一个 ]（数组格式）
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');

    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      const jsonCandidate = text.substring(firstBracket, lastBracket + 1);
      try {
        return JSON.parse(jsonCandidate);
      } catch (e) {
        // 继续尝试
      }
    }

    // 尝试5: 移除常见的前缀/后缀文本
    const cleanedText = this.removeCommonPrefixes(text);
    try {
      return JSON.parse(cleanedText);
    } catch (e) {
      // 继续尝试
    }

    // 尝试6: 修复常见的 JSON 错误
    const fixedText = this.fixCommonJsonErrors(text);
    try {
      return JSON.parse(fixedText);
    } catch (e) {
      // 所有尝试都失败
    }

    // 如果所有方法都失败，抛出详细错误
    throw new Error(
      `Failed to extract valid JSON from LLM response.\n` +
      `Response preview: ${text.substring(0, 200)}...\n` +
      `Please check the LLM prompt and response format.`
    );
  }

  /**
   * 移除常见的前缀和后缀
   */
  private static removeCommonPrefixes(text: string): string {
    let cleaned = text.trim();

    // 移除常见的前缀
    const prefixes = [
      'Here is the JSON:',
      'Here\'s the JSON:',
      'The JSON is:',
      'JSON:',
      'Result:',
      'Output:',
      '```json',
      '```'
    ];

    for (const prefix of prefixes) {
      if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
        cleaned = cleaned.substring(prefix.length).trim();
      }
    }

    // 移除常见的后缀
    const suffixes = [
      '```',
      'Hope this helps!',
      'Let me know if you need anything else.',
      'Is there anything else I can help with?'
    ];

    for (const suffix of suffixes) {
      if (cleaned.toLowerCase().endsWith(suffix.toLowerCase())) {
        cleaned = cleaned.substring(0, cleaned.length - suffix.length).trim();
      }
    }

    return cleaned;
  }

  /**
   * 修复常见的 JSON 错误
   */
  private static fixCommonJsonErrors(text: string): string {
    let fixed = text;

    // 修复单引号（应该是双引号）
    fixed = fixed.replace(/'/g, '"');

    // 修复尾随逗号
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

    // 修复缺少引号的键
    fixed = fixed.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    // 移除注释
    fixed = fixed.replace(/\/\/.*$/gm, '');
    fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

    return fixed;
  }

  /**
   * 验证提取的 JSON 是否符合预期结构
   */
  static validate(json: any, expectedKeys: string[]): boolean {
    if (!json || typeof json !== 'object') {
      return false;
    }

    for (const key of expectedKeys) {
      if (!(key in json)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 提取并验证
   */
  static extractAndValidate(text: string, expectedKeys: string[]): any {
    const json = this.extract(text);

    if (!this.validate(json, expectedKeys)) {
      throw new Error(
        `Extracted JSON is missing required keys. ` +
        `Expected: ${expectedKeys.join(', ')}. ` +
        `Got: ${Object.keys(json).join(', ')}`
      );
    }

    return json;
  }

  /**
   * 安全提取（返回默认值而不是抛出错误）
   */
  static extractSafe(text: string, defaultValue: any = null): any {
    try {
      return this.extract(text);
    } catch (error) {
      console.error('JSON extraction failed:', error);
      return defaultValue;
    }
  }
}
