import React, { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parseMarkdownBlocks, tokenizeInlineMarkdown } from '../../lib/aiMarkdown';
import { writeClipboardText } from '../../lib/terminalClipboard';
import type { CommandRiskLevel } from '../../types/agent';
import { AiCommandCard } from './AiCommandCard';

interface AiMarkdownViewProps {
  content: string;
  hasActiveTerminal: boolean;
  canExecSsh: boolean;
  isBusy: boolean;
  runningCommand: string | null;
  onRunCommand: (command: string, risk: CommandRiskLevel) => void;
  onInsertCommand: (command: string) => void;
  onRunAndAnalyze: (command: string, risk: CommandRiskLevel) => void;
}

const InlineText: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, lineIdx) => (
        <React.Fragment key={lineIdx}>
          {lineIdx > 0 && <br />}
          {tokenizeInlineMarkdown(line).map((tok, i) => {
            if (tok.type === 'code') {
              return (
                <code className="ai-inline-code" key={i}>
                  {tok.value}
                </code>
              );
            }
            if (tok.type === 'bold') {
              return <strong key={i}>{tok.value}</strong>;
            }
            if (tok.type === 'italic') {
              return <em key={i}>{tok.value}</em>;
            }
            return <React.Fragment key={i}>{tok.value}</React.Fragment>;
          })}
        </React.Fragment>
      ))}
    </>
  );
};

const PlainCodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void writeClipboardText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="ai-code-block">
      <div className="ai-code-header">
        <span>{lang || 'text'}</span>
        <button type="button" className="ai-cmd-btn" onClick={handleCopy}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? t('terminal_ai_copied') : t('terminal_ai_copy')}</span>
        </button>
      </div>
      <pre className="ai-cmd-code">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const AiMarkdownView: React.FC<AiMarkdownViewProps> = ({
  content,
  hasActiveTerminal,
  canExecSsh,
  isBusy,
  runningCommand,
  onRunCommand,
  onInsertCommand,
  onRunAndAnalyze,
}) => {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  return (
    <div className="ai-md">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5';
          return (
            <Tag className={`ai-md-h ai-md-h${block.level}`} key={idx}>
              <InlineText text={block.text} />
            </Tag>
          );
        }
        if (block.type === 'paragraph') {
          return (
            <p className="ai-md-p" key={idx}>
              <InlineText text={block.text} />
            </p>
          );
        }
        if (block.type === 'blockquote') {
          return (
            <blockquote className="ai-md-quote" key={idx}>
              <InlineText text={block.text} />
            </blockquote>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag className="ai-md-list" key={idx}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <InlineText text={item} />
                </li>
              ))}
            </ListTag>
          );
        }
        if (block.isShell) {
          return (
            <AiCommandCard
              key={idx}
              command={block.runnableCommand}
              rawCode={block.code}
              lang={block.lang}
              risk={block.risk}
              hasActiveTerminal={hasActiveTerminal}
              canExecSsh={canExecSsh}
              isBusy={isBusy}
              runningCommand={runningCommand}
              onRun={onRunCommand}
              onInsert={onInsertCommand}
              onRunAndAnalyze={onRunAndAnalyze}
            />
          );
        }
        return <PlainCodeBlock key={idx} lang={block.lang} code={block.code} />;
      })}
    </div>
  );
};
