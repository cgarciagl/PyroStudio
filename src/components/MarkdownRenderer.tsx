import React, { useMemo } from "react";
import { marked } from "marked";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = "",
}) => {
  const htmlContent = useMemo(() => {
    if (!content) return "";
    return marked.parse(content, {
      async: false,
      breaks: true,
      gfm: true,
    }) as string;
  }, [content]);

  return (
    <div
      className={`agent-markdown select-text ${className}`}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};
