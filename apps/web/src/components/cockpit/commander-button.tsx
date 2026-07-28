import React from "react";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
}

export function CommanderButton({ children, className = "", ...props }: Props) {
  return (
    <button
      {...props}
      className={`commander-button rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${className}`}
      style={{ backgroundColor: "var(--ck-brass)", ...props.style }}
      data-design-semantic="human-decision"
    >
      {children}
    </button>
  );
}
