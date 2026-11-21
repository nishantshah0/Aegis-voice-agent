// Split the model's streamed text into whole sentences, so each one can go
// through guardSentence before anything is spoken.
//
// A sentence ends at . ! or ? followed by whitespace, or at a line break.
// "$4.10" and "36 mg." mid-stream stay whole because the split waits for the
// whitespace after the mark. Common titles ("Dr.", "St.") don't end a sentence.

const TITLES = new Set(["dr", "mr", "mrs", "ms", "st", "mt", "no", "vs", "e.g", "i.e"]);

function endsWithTitle(text: string): boolean {
  const last = text.trim().split(/\s+/).pop() ?? "";
  return TITLES.has(last.replace(/\.$/, "").toLowerCase());
}

export type SentenceSplitter = {
  /** Add streamed text; returns the sentences it completed, in order. */
  push(delta: string): string[];
  /** The text left over at the end of the turn, if any, as a last sentence. */
  flush(): string[];
};

export function createSentenceSplitter(): SentenceSplitter {
  let buffer = "";

  function take(): string[] {
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      const next = buffer[i + 1];
      const lineBreak = ch === "\n";
      const mark = (ch === "." || ch === "!" || ch === "?") && next !== undefined && /\s/.test(next);
      if (!lineBreak && !mark) continue;
      const sentence = buffer.slice(start, i + 1).trim();
      if (mark && ch === "." && endsWithTitle(sentence)) continue;
      if (sentence) out.push(sentence);
      start = i + 1;
    }
    buffer = buffer.slice(start);
    return out;
  }

  return {
    push(delta) {
      buffer += delta;
      return take();
    },
    flush() {
      const rest = buffer.trim();
      buffer = "";
      return rest ? [rest] : [];
    },
  };
}
