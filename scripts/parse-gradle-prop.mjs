#!/usr/bin/env node
/**
 * parse-gradle-prop.mjs — resolve a single key from a gradle.properties file.
 *
 * Implements the Java Properties spec (java.util.Properties) used by Gradle:
 *   - Line continuation: odd trailing backslash joins the next physical line
 *   - Unicode escapes: \uXXXX decoded before key/value evaluation
 *   - Backslash escapes: \n \r \t \f and \\ decoded in values
 *   - Comment lines: lines whose first non-whitespace char is # or !
 *   - Key/value separators: '=', ':', or whitespace (all valid)
 *   - Leading/surrounding whitespace around separators is ignored
 *   - Duplicate keys: last occurrence wins (Gradle behaviour)
 *
 * Usage : node parse-gradle-prop.mjs <properties-file> <key>
 * Stdout: the resolved value string, or empty string if not found
 * Exits : 0 on success, 2 if the file cannot be read
 */

import { readFileSync } from 'fs';

const [,, file, targetKey] = process.argv;
if (!file || !targetKey) {
  process.stderr.write('Usage: node parse-gradle-prop.mjs <file> <key>\n');
  process.exit(1);
}

let content;
try {
  content = readFileSync(file, 'utf8');
} catch (e) {
  process.stderr.write(`ERROR: cannot read ${file}: ${e.message}\n`);
  process.exit(2);
}

/**
 * Decode backslash escapes in a Java properties string fragment.
 * Handles \uXXXX, \n, \r, \t, \f, \\, and passthrough for anything else.
 */
function decodeEscapes(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (_, esc) => {
    if (esc[0] === 'u') return String.fromCharCode(parseInt(esc.slice(1), 16));
    switch (esc) {
      case 'n':  return '\n';
      case 'r':  return '\r';
      case 't':  return '\t';
      case 'f':  return '\f';
      default:   return esc; // \\→\, \=→=, \:→:, etc.
    }
  });
}

/**
 * Parse a Java .properties text and return a Map<string,string>.
 * Last occurrence of a key wins.
 */
function parseProperties(text) {
  const props = new Map();

  // Step 1: resolve line continuations.
  // A physical line ending with an odd number of backslashes continues on the next line;
  // the continuation backslash is dropped, AND any leading whitespace on the following
  // line is stripped before concatenation (per the Java Properties spec).
  const physical = text.split(/\r?\n/);
  const logical  = [];
  let pending = '';
  let inContinuation = false;

  for (const phys of physical) {
    // Strip leading whitespace from continuation lines (spec requirement).
    const line = inContinuation ? phys.replace(/^[ \t\f]+/, '') : phys;

    let bs = 0;
    let i = line.length - 1;
    while (i >= 0 && line[i] === '\\') { bs++; i--; }

    if (bs % 2 === 1) {
      // Continuation: remove the trailing backslash, accumulate.
      pending += line.slice(0, line.length - 1);
      inContinuation = true;
    } else {
      pending += line;
      logical.push(pending);
      pending = '';
      inContinuation = false;
    }
  }
  if (pending) logical.push(pending);

  // Step 2: parse each logical line.
  for (const line of logical) {
    // Strip leading whitespace (space, tab, form-feed per spec).
    const trimmed = line.replace(/^[ \t\f]+/, '');

    // Skip blank lines and comment lines.
    if (!trimmed || trimmed[0] === '#' || trimmed[0] === '!') continue;

    // Parse key: read until first unescaped =, :, or whitespace.
    let ki = 0;
    while (ki < trimmed.length) {
      const c = trimmed[ki];
      if (c === '\\') { ki += 2; continue; }                     // skip escaped char
      if (c === '=' || c === ':' || /[ \t\f]/.test(c)) break;
      ki++;
    }
    const key = decodeEscapes(trimmed.slice(0, ki));

    // Parse separator: optional whitespace, optional =/:, optional whitespace.
    let vi = ki;
    while (vi < trimmed.length && /[ \t\f]/.test(trimmed[vi])) vi++;
    if (vi < trimmed.length && (trimmed[vi] === '=' || trimmed[vi] === ':')) {
      vi++;
      while (vi < trimmed.length && /[ \t\f]/.test(trimmed[vi])) vi++;
    }

    const value = decodeEscapes(trimmed.slice(vi)).trim();
    props.set(key, value);
  }

  return props;
}

const props = parseProperties(content);
const value = props.get(targetKey) ?? '';
process.stdout.write(value);
