import React from "react";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
}

export function CommanderButton({ children, className = "", ...props }: Props) {
  return (
    <button
      {...props}
      className={`commander-button font-semibold px-4 py-2 text-sm rounded bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50 ${className}`}
      data-design-semantic="human-decision"
    >
      {children}
    </button>
  );
}
