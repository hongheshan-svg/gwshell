#!/usr/bin/env node
// Tests for src/lib/inputLineTracker.ts: the typed-line tracker behind command
// completion and history capture. A tiny fake screen plays the shell: keys go
// through applyInput first (like xterm onData, before the echo), then the test
// echoes whatever the shell would draw.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
function loadTs(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', js)(module.exports, () => ({}), module);
  return module.exports;
}

const lt = loadTs('src/lib/inputLineTracker.ts');

class Screen {
  constructor(cols = 40, prompt = '$ ') {
    this.cols = cols;
    this.rows = [{ cells: [], isWrapped: false }];
    this.cursor = { row: 0, col: 0 };
    this.write(prompt);
  }
  write(text) {
    for (const ch of text) {
      if (this.cursor.col >= this.cols) {
        this.cursor = { row: this.cursor.row + 1, col: 0 };
        this.rows[this.cursor.row] = { cells: [], isWrapped: true };
      }
      this.rows[this.cursor.row].cells[this.cursor.col] = ch;
      this.cursor = { row: this.cursor.row, col: this.cursor.col + 1 };
    }
  }
  newline(prompt = '$ ') {
    this.cursor = { row: this.cursor.row + 1, col: 0 };
    this.rows[this.cursor.row] = { cells: [], isWrapped: false };
    this.write(prompt);
  }
  /** Replace the current row from `col` on (the shell redrawing the line). */
  redraw(col, text) {
    this.rows[this.cursor.row].cells.length = col;
    this.cursor = { row: this.cursor.row, col };
    this.write(text);
  }
  getLine(y) {
    const r = this.rows[y];
    if (!r) return undefined;
    const cols = this.cols;
    return {
      isWrapped: r.isWrapped,
      translateToString(_trim, start = 0, end = cols) {
        let s = '';
        for (let i = start; i < end; i++) s += r.cells[i] ?? ' ';
        return s;
      },
    };
  }
}

function session({ cols, caseInsensitive = false } = {}) {
  const screen = new Screen(cols);
  const tracker = lt.createLineTracker();
  const env = {
    cursor: () => ({ ...screen.cursor }),
    readLine: (from, to) => lt.readBufferRange(screen, from, to),
    caseInsensitive,
    alternateScreen: false,
  };
  const s = {
    screen,
    tracker,
    env,
    /** Send keys; printable ones are echoed like a shell would. */
    key(data, echo = data) {
      const r = lt.applyInput(tracker, data, env);
      if (echo && !/[\x00-\x1f\x7f]/.test(echo)) screen.write(echo);
      return r;
    },
    type(text) {
      let r;
      for (const ch of text) r = s.key(ch);
      return r;
    },
    enter() {
      const r = lt.applyInput(tracker, '\r', env);
      screen.newline();
      return r.submitted;
    },
  };
  return s;
}

// Plain typing is tracked and submitted.
{
  const s = session();
  assert.equal(s.type('ls -al').effect, 'show');
  assert.equal(s.tracker.buf, 'ls -al');
  assert.deepEqual(s.tracker.anchor, { row: 0, col: 2 }, 'anchor is where the line started');
  assert.equal(s.enter(), 'ls -al');
}

// Ctrl+C aborts the line: "foo", Ctrl+C, "ls" must not become "fools".
{
  const s = session();
  s.type('foo');
  s.key('\x03', '');
  s.screen.newline();
  s.type('ls');
  assert.equal(s.enter(), 'ls');
}

// After ← the cursor is no longer at the end: nothing is suggested or recorded.
{
  const s = session();
  s.type('ls -a');
  assert.equal(s.key('\x1b[D', '').effect, 'hide');
  assert.equal(s.tracker.state, 'unknown');
  assert.equal(s.key('l', '').effect, 'hide', 'no suggestions on an unknown line');
  assert.equal(s.enter(), undefined, 'a fragment is never recorded');
  assert.equal(s.tracker.state, 'tracked', 'the next line starts fresh');
}

// Shell Tab completion: the line is re-read from the screen.
{
  const s = session();
  s.type('cd Doc');
  s.key('\t', '');
  s.screen.write('uments/'); // the shell completes the word
  assert.equal(s.enter(), 'cd Documents/');
}

// ...and typing continues on top of the completed text.
{
  const s = session();
  s.type('cat /etc/ho');
  s.key('\t', '');
  s.screen.write('sts');
  assert.equal(s.type(' ').effect, 'show');
  assert.equal(s.tracker.buf, 'cat /etc/hosts ');
}

// If the screen no longer shows what was typed, give up rather than guess.
{
  const s = session();
  s.type('git com');
  s.key('\t', '');
  s.screen.redraw(0, 'something else entirely');
  assert.equal(s.enter(), undefined);
}

// ↑ history recall at an empty prompt.
{
  const s = session();
  s.key('\x1b[A', '');
  s.screen.write('git status');
  assert.equal(s.enter(), 'git status');
  // SS3 (application cursor mode) arrows behave the same.
  s.key('\x1bOA', '');
  s.screen.write('make test');
  assert.equal(s.enter(), 'make test');
}

// → / End may accept a shell autosuggestion (zsh-autosuggestions, fish, PSReadLine).
{
  const s = session();
  s.type('docker comp');
  s.key('\x1b[C', '');
  s.screen.write('ose up -d');
  assert.equal(s.enter(), 'docker compose up -d');
}

// PowerShell Tab completion rewrites the current word and its case.
{
  const s = session({ caseInsensitive: true });
  s.type('cd doc');
  s.key('\t', '');
  s.screen.redraw(2 + 3, '.\\Documents\\');
  assert.equal(s.enter(), 'cd .\\Documents\\');
  s.type('get-ch');
  s.key('\t', '');
  s.screen.redraw(2, 'Get-ChildItem');
  assert.equal(s.enter(), 'Get-ChildItem');
}

// A line that soft-wraps is read across rows.
{
  const s = session({ cols: 12 });
  s.type('echo abc');
  s.key('\t', '');
  s.screen.write('defghijkl');
  assert.equal(s.enter(), 'echo abcdefghijkl');
}

// A hard line break (continuation prompt, output) is not part of the line.
{
  const screen = new Screen(20);
  screen.write('ab');
  screen.newline('> ');
  screen.write('cd');
  assert.equal(lt.readBufferRange(screen, { row: 0, col: 2 }, { row: 1, col: 4 }), null);
  assert.equal(lt.readBufferRange(screen, { row: 0, col: 4 }, { row: 0, col: 2 }), null);
}

// Full-screen programs (vim, less, top): nothing is tracked or recorded.
{
  const s = session();
  s.env.alternateScreen = true;
  assert.equal(s.type(':wq').effect, 'hide');
  assert.equal(s.enter(), undefined);
}

// A leading space keeps the line out of history (bash/zsh ignorespace).
{
  const s = session();
  s.type(' export TOKEN=abc');
  assert.equal(s.enter(), undefined);
}

// Backspace and Ctrl+W edit the tracked text like readline.
{
  const s = session();
  s.type('git status ');
  s.key('\x17', '');
  assert.equal(s.tracker.buf, 'git ');
  s.type('lo');
  s.key('\x7f', '');
  assert.equal(s.tracker.buf, 'git l');
  s.type('og');
  assert.equal(s.enter(), 'git log');
}

// Ctrl+U clears; Ctrl+K at the end changes nothing; Ctrl+L keeps the text.
{
  const s = session();
  s.type('rm -rf build');
  s.key('\x15', '');
  assert.equal(s.tracker.buf, '');
  assert.equal(s.tracker.state, 'tracked');
  s.type('ls');
  assert.equal(s.key('\x0b', '').effect, 'none');
  assert.equal(s.tracker.buf, 'ls');
  s.key('\x0c', '');
  assert.equal(s.tracker.anchor, null, 'the screen was cleared, the start is unknown');
  s.type(' -l');
  assert.equal(s.enter(), 'ls -l');
}

// Bracketed paste: one line is appended, several lines make the line unknown.
{
  const s = session();
  s.type('cat ');
  assert.equal(s.key('\x1b[200~/var/log/syslog\x1b[201~', '').effect, 'hide');
  s.screen.write('/var/log/syslog');
  assert.equal(s.tracker.buf, 'cat /var/log/syslog');
  assert.equal(s.enter(), 'cat /var/log/syslog');

  s.key('\x1b[200~echo a', '');
  s.key('\necho b\x1b[201~', '');
  assert.equal(s.tracker.state, 'unknown');
  assert.equal(s.enter(), undefined);
}

// Ctrl+D on an empty line (exit) keeps the tracker fresh.
{
  const s = session();
  s.key('\x04', '');
  assert.equal(s.tracker.state, 'tracked');
  assert.equal(s.tracker.anchor, null);
}

// Dropdown column: the line start on the cursor's row, 0 once wrapped.
assert.equal(lt.dropdownColumn({ row: 3, col: 7 }, { row: 3, col: 15 }), 7);
assert.equal(lt.dropdownColumn({ row: 3, col: 7 }, { row: 4, col: 2 }), 0);
assert.equal(lt.dropdownColumn(null, { row: 4, col: 9 }), 9);

console.log('input line tracker tests passed');
