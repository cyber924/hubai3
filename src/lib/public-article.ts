/** Only expose articles whose body the hubai3 reader can actually render. */
export function hasReadableArticleBody(article: any): boolean {
  return Array.isArray(article?.sections) && article.sections.some((section: any) =>
    typeof section?.content === 'string' &&
    section.content
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ')
      .replace(/[\s\u200B-\u200D\uFEFF]/g, '').length > 0
  );
}

