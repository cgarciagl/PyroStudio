import React, { useMemo } from "react";
import { renderSafeMarkdown } from "../utils/safeMarkdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = "",
}) => {
  const htmlContent = useMemo(() => {
    return renderSafeMarkdown(content);
  }, [content]);

  return (
    <div
      className={`agent-markdown select-text text-fg dark:text-fg ${className}`}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};
