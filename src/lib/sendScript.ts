import { expandSnippet } from './snippetExpand';

// Runs a script string (honoring \xNN control bytes, \sNNN delays, \n/\r/\t/\\)
// by dispatching its text segments through `send`, scheduling delayed segments
// at their cumulative offset via setTimeout.
export function runScript(send: (data: string) => void, script: string): void {
  let delay = 0;
  for (const seg of expandSnippet(script)) {
    if (seg.kind === 'delay') {
      delay += seg.delayMs;
    } else {
      const text = seg.text;
      if (delay === 0) send(text);
      else setTimeout(() => send(text), delay);
    }
  }
}
