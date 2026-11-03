import React from 'react';

interface FunctionBarProps {
  onF1: () => void;
  onF2: () => void;
  onF3: () => void;
  onF4: () => void;
  onF5: () => void;
  onF6: () => void;
  onF7: () => void;
  onF8: () => void;
  onF9: () => void;
  onF10: () => void;
}

export const FunctionBar: React.FC<FunctionBarProps> = ({
  onF1,
  onF2,
  onF3,
  onF4,
  onF5,
  onF6,
  onF7,
  onF8,
  onF9,
  onF10,
}) => {
  const buttons = [
    { key: '1', label: 'Help', fn: onF1 },
    { key: '2', label: 'Menu', fn: onF2 },
    { key: '3', label: 'View', fn: onF3 },
    { key: '4', label: 'Edit', fn: onF4 },
    { key: '5', label: 'Copy', fn: onF5 },
    { key: '6', label: 'RenMov', fn: onF6 },
    { key: '7', label: 'MkDir', fn: onF7 },
    { key: '8', label: 'Delete', fn: onF8 },
    { key: '9', label: 'Connect', fn: onF9 },
    { key: '10', label: 'Quit', fn: onF10 },
  ];

  return (
    <div className="bg-nc-black grid grid-cols-10 gap-0.5 px-0.5 py-1 text-xs font-mono font-bold select-none border-t border-nc-cyan">
      {buttons.map((btn) => (
        <button
          key={btn.key}
          onClick={btn.fn}
          className="flex items-center justify-center bg-nc-darkblue hover:bg-nc-cyan group transition-colors overflow-hidden border border-nc-cyan/50"
        >
          <span className="bg-nc-cyan text-nc-black px-1.5 py-0.5 text-[11px] group-hover:bg-nc-darkblue group-hover:text-nc-cyan font-black">
            {btn.key}
          </span>
          <span className="text-nc-white group-hover:text-nc-black px-1.5 py-0.5 text-[11px] truncate">
            {btn.label}
          </span>
        </button>
      ))}
    </div>
  );
};
