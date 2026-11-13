'use client';

import { useState } from 'react';

/** Copies the current text of the message field (including unsaved edits) to the clipboard. */
export function CopyButton({ fieldId }: { fieldId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        const field = document.getElementById(fieldId) as HTMLTextAreaElement | null;
        if (!field) return;
        try {
          await navigator.clipboard.writeText(field.value);
        } catch {
          field.select();
          document.execCommand('copy');
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied' : 'Copy text'}
    </button>
  );
}
