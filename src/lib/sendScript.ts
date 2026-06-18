import { expandSnippet } from './snippetExpand';

// Runs a script string (honoring \xNN control bytes, \sNNN delays, \n/\r/\t/\\)
// by dispatching its text segments through `send`, scheduling delayed segments
// at their cumulative offset via setTimeout.
//
// Returns a cancel function that clears every scheduled segment. Call it on
// terminal teardown so a delayed segment can't write to a closed/reused session.
export function runScript(send: (data: string) => void, script: string): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let delay = 0;
  for (const seg of expandSnippet(script)) {
    if (seg.kind === 'delay') {
      delay += seg.delayMs;
    } else {
      const text = seg.text;
      if (delay === 0) send(text);
      else timers.push(setTimeout(() => send(text), delay));
    }
  }
  return () => { timers.forEach(clearTimeout); };
}

// Like runScript, but ensures the script submits its final line: appends a
// trailing newline unless the script already ends with one (a real newline or
// the \n escape). Use for login scripts / init commands that run on connect.
export function runLoginScript(send: (data: string) => void, script: string): () => void {
  const withNewline =
    script.endsWith('\n') || script.endsWith('\\n') ? script : script + '\n';
  return runScript(send, withNewline);
}
