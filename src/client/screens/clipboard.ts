/**
 * Checks if the browser clipboard API is supported in the current execution context.
 */
export const isClipboardSupported = (): boolean => {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.clipboard !== 'undefined' &&
      typeof navigator.clipboard.writeText === 'function'
    );
  } catch {
    return false;
  }
};

/**
 * Safely writes text to the clipboard if supported, returning boolean success without throwing.
 */
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (!isClipboardSupported()) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn('[Clipboard] Failed to write text to clipboard:', err);
    return false;
  }
};
