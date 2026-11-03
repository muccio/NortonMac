import React, { useState, useRef } from 'react';
import { ShellOutput } from '../types';

interface ShellPromptProps {
  currentPath: string;
  onExecute: (cmd: string) => Promise<ShellOutput>;
  onDirectoryChanged?: (newPath: string) => void;
}

export const ShellPrompt: React.FC<ShellPromptProps> = ({
  currentPath,
  onExecute,
}) => {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [outputDrawer, setOutputDrawer] = useState<ShellOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;

    setLoading(true);
    setHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);
    setCommand('');

    try {
      const res = await onExecute(cmd);
      setOutputDrawer(res);
    } catch (err: any) {
      setOutputDrawer({
        stdout: '',
        stderr: String(err),
        exit_code: 1,
        current_dir: currentPath,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(nextIdx);
        setCommand(history[nextIdx] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx !== -1) {
        const nextIdx = historyIdx + 1;
        if (nextIdx >= history.length) {
          setHistoryIdx(-1);
          setCommand('');
        } else {
          setHistoryIdx(nextIdx);
          setCommand(history[nextIdx] || '');
        }
      }
    } else if (e.key === 'Escape') {
      setOutputDrawer(null);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="bg-nc-black border-t border-nc-cyan px-2 py-1 text-xs font-mono relative">
      {/* Shell Output Drawer */}
      {outputDrawer && (
        <div className="absolute bottom-full left-0 right-0 max-h-60 bg-nc-darkblue border-2 border-nc-yellow text-nc-white p-2 overflow-y-auto font-mono text-[11px] shadow-2xl z-40">
          <div className="flex justify-between items-center border-b border-nc-cyan pb-1 mb-1 font-bold text-nc-yellow">
            <span>
              [TERMINAL OUTPUT] Exit Code: {outputDrawer.exit_code}
            </span>
            <button
              onClick={() => setOutputDrawer(null)}
              className="text-nc-brightred hover:text-nc-white px-1 font-black"
            >
              [ESC / CLOSE]
            </button>
          </div>
          {outputDrawer.stdout && (
            <pre className="text-nc-brightgreen whitespace-pre-wrap font-mono">
              {outputDrawer.stdout}
            </pre>
          )}
          {outputDrawer.stderr && (
            <pre className="text-nc-brightred whitespace-pre-wrap font-mono">
              {outputDrawer.stderr}
            </pre>
          )}
        </div>
      )}

      {/* Input line */}
      <form onSubmit={handleSubmit} className="flex items-center space-x-2">
        <span className="text-nc-brightcyan font-bold truncate max-w-xs" title={currentPath}>
          {currentPath}&gt;
        </span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={loading ? 'Executing command in shell...' : 'type shell command and press Enter (e.g. ls -la, git status)...'}
          disabled={loading}
          className="flex-1 bg-transparent text-nc-yellow placeholder-nc-gray/50 outline-none font-mono text-xs caret-nc-yellow font-bold"
        />
        {loading && <span className="text-nc-yellow animate-pulse text-xs">RUNNING...</span>}
      </form>
    </div>
  );
};
