import * as ChildProcess from 'child_process';
import { EventEmitter } from 'events';
import * as Fs from 'fs-extra';
import { resolve } from 'path';

/**
 Contains general utilities.
 */

let cwdReturnValue: string;
let git;
let npm;
let node;

function init() {
  // Defaults to process's current working dir
  cwdReturnValue = process.env.TORTILLA_CWD || process.cwd();

  try {
    cwdReturnValue = ChildProcess.execFileSync('git', [
      'rev-parse', '--show-toplevel',
    ], {
      cwd: cwdReturnValue,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).toString()
      .trim();
  } catch (err) {
    // If no git-exists nor git-failed use default value instead
  }

  // Setting all relative utils
  (exec as any).print = spawn;
  git = exec.bind(null, 'git');
  git.print = spawn.bind(null, 'git');
  npm = exec.bind(null, 'npm');
  npm.print = spawn.bind(null, 'npm');
  node = exec.bind(null, 'node');
  node.print = spawn.bind(null, 'node');
}

init();

function cwd () {
  return cwdReturnValue;
}

// Checks if one of the parent processes launched by the provided file and has
// the provided arguments
function isChildProcessOf(file, argv, offset?) {
  // There might be nested processes of the same file so we wanna go through all of them,
  // This variable represents how much skips will be done anytime the file is found.
  let trial = offset = offset || 0;

  // The current process would be the node's
  const currProcess = {
    file: process.title,
    pid: process.pid,
    argv: process.argv,
  };

  // Will abort once the file is found and there are no more skips left to be done
  while (currProcess.file !== file || trial--) {
    // Get the parent process id
    currProcess.pid = Number(getProcessData(currProcess.pid, 'ppid'));
    // The root process'es id is 0 which means we've reached the limit
    if (!currProcess.pid) {
      return false;
    }

    currProcess.argv = getProcessData(currProcess.pid, 'command')
      .split(' ')
      .filter(Boolean);

    // The first word in the command would be the file name
    currProcess.file = currProcess.argv[0];
    // The rest would be the arguments vector
    currProcess.argv = currProcess.argv.slice(1);
  }

  // Make sure it has the provided arguments
  const result = argv.every((arg) => currProcess.argv.indexOf(arg) !== -1);

  // If this is not the file we're looking for keep going up in the processes tree
  return result || isChildProcessOf(file, argv, ++offset);
}

// Gets process data using 'ps' formatting
function getProcessData(pid, format) {
  if (arguments.length === 1) {
    format = pid;
    pid = process.pid;
  }

  const result = exec('ps', ['-p', pid, '-o', format]).split('\n');
  result.shift();

  return result.join('\n');
}

// Spawn new process and print result to the terminal
function spawn(file: string, argv?: string[], options?) {
  argv = argv || [];

  options = extend({
    cwd: process.env.TORTILLA_CWD || cwd(),
    stdio: process.env.TORTILLA_STDIO || 'inherit',
    env: {},
    maxBuffer: 10 * 1024 * 1024,
  }, options);

  const envRedundantKeys = Object.keys(options.env).filter((key) => {
    return options.env[key] == null;
  });

  options.env = extend({
    TORTILLA_CHILD_PROCESS: true,
  }, process.env, options.env);

  envRedundantKeys.forEach((key) => {
    delete options.env[key];
  });

  return ChildProcess.spawnSync(file, argv, options);
}

// Execute file
function exec(file: string, argv?: string[], options?) {
  argv = argv || [];

  options = extend({
    cwd: process.env.TORTILLA_CWD || cwd(),
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024,
    env: {},
  }, options);

  const envRedundantKeys = Object.keys(options.env).filter((key) => {
    return options.env[key] == null;
  });

  options.env = {
    TORTILLA_CHILD_PROCESS: true,
    ...process.env,
    ...options.env,
  };

  envRedundantKeys.forEach((key) => {
    delete options.env[key];
  });

  debug(`Executing (execFileSync) command "${file} ${argv.join(' ')}" (${options.cwd})`);

  const out = ChildProcess.execFileSync(file, argv, options);

  // In case of stdio inherit
  if (!out) {
    return '';
  }

  return out.toString().trim();
}

function inspect(str: string, argv: string[] = []) {
  return spawn('less', argv, {
    input: str,
    stdio: ['pipe', 'inherit', 'inherit']
  });
}

// Tells if entity exists or not by an optional document type
function exists(path, type?) {
  try {
    const stats = Fs.lstatSync(path);

    switch (type) {
      case 'dir':
        return stats.isDirectory();
      case 'file':
        return stats.isFile();
      case 'symlink':
        return stats.isSymbolicLink();
      default:
        return true;
    }
  } catch (err) {
    return false;
  }
}

// Create a temporary scope which will define provided variables on the environment
function scopeEnv(fn, env) {
  const keys = Object.keys(env);
  const originalEnv = pluck(process.env, keys);
  const nullKeys = keys.filter((key) => process.env[key] == null);

  extend(process.env, env);

  try {
    return fn();
  } finally {
    extend(process.env, originalEnv);
    contract(process.env, nullKeys);
  }
}

// Filter all strings matching the provided pattern in an array
function filterMatches(arr, pattern) {
  pattern = pattern || '';

  return arr.filter((str) => str.match(pattern));
}

// Deeply merges destination object with source object
function merge(destination, source) {
  if (!(destination instanceof Object) ||
    !(source instanceof Object)) {
    return source;
  }

  Object.keys(source).forEach((k) => {
    destination[k] = merge(destination[k], source[k]);
  });

  return destination;
}

// Extend destination object with provided sources
function extend(destination, ...sources) {
  sources.forEach((source) => {
    if (!(source instanceof Object)) {
      return;
    }

    Object.keys(source).forEach((k) => {
      destination[k] = source[k];
    });
  });

  return destination;
}

// Deletes all keys in the provided object
function contract(destination, keys) {
  keys.forEach((key) => {
    delete destination[key];
  });

  return destination;
}

// Plucks all keys from object
function pluck(obj, keys) {
  return keys.reduce((result, key) => {
    result[key] = obj[key];

    return result;
  }, {});
}

// Pad the provided string with the provided pad params from the left
// '1' -> '00001'
function pad(str, length, char?) {
  str = str.toString();
  char = char || ' ';
  const chars = Array(length + 1).join(char);

  return chars.substr(0, chars.length - str.length) + str;
}

// Like pad() only from the right
// '1' -> '10000'
function padRight(str, length, char?) {
  str = str.toString();
  char = char || ' ';
  const chars = Array(length + 1).join(char);

  return str + chars.substr(0, chars.length - str.length);
}

// foo_barBaz -> foo-bar-baz
function toKebabCase(str) {
  return splitWords(str)
    .map(lowerFirst)
    .join('-');
}

// foo_barBaz -> Foo Bar Baz
function toStartCase(str) {
  return splitWords(str)
    .map(upperFirst)
    .join(' ');
}

// Lower -> lower
function lowerFirst(str) {
  return str.substr(0, 1).toLowerCase() + str.substr(1);
}

// upper -> Upper
function upperFirst(str) {
  return str.substr(0, 1).toUpperCase() + str.substr(1);
}

// foo_barBaz -> ['foo', 'bar', 'Baz']
function splitWords(str) {
  return str
    .replace(/[A-Z]/, ' $&')
    .split(/[^a-zA-Z0-9]+/);
}

// Wraps source descriptors and defines them on destination. The modifiers object
// contains the wrappers for the new descriptors, and has 3 properties:
// - value - A value wrapper, if function
// - get - A getter wrapper
// - set - A setter wrapper
// All 3 wrappers are called with 3 arguments: handler, propertyName, args
function delegateProperties(destination, source, modifiers) {
  Object.getOwnPropertyNames(source).forEach((propertyName) => {
    const propertyDescriptor = Object.getOwnPropertyDescriptor(source, propertyName);

    if (typeof propertyDescriptor.value === 'function' && modifiers.value) {
      const superValue = propertyDescriptor.value;

      propertyDescriptor.value = function() {
        const args = [].slice.call(arguments);

        return modifiers.value.call(this, superValue, propertyName, args);
      };
    } else {
      if (propertyDescriptor.get && modifiers.get) {
        const superGetter = propertyDescriptor.get;

        propertyDescriptor.get = function() {
          return modifiers.get.call(this, superGetter, propertyName);
        };
      }

      if (propertyDescriptor.set && modifiers.set) {
        const superGetter = propertyDescriptor.set;

        propertyDescriptor.set = function(value) {
          return modifiers.value.call(this, superGetter, propertyName, value);
        };
      }
    }

    Object.defineProperty(destination, propertyName, propertyDescriptor);
  });

  return destination;
}

function isEqual(objA, objB) {
  if (objA === objB) {
    return true;
  }
  if (typeof objA !== typeof objB) {
    return false;
  }
  if (!(objA instanceof Object) || !(objB instanceof Object)) {
    return false;
  }
  if ((objA as any).__proto__ !== (objB as any).__proto__) {
    return false;
  }

  const objAKeys = Object.keys(objA);
  const objBKeys = Object.keys(objB);

  if (objAKeys.length !== objBKeys.length) {
    return;
  }

  objAKeys.sort();
  objBKeys.sort();

  return objAKeys.every((keyA, index) => {
    const keyB = objBKeys[index];

    if (keyA !== keyB) {
      return false;
    }

    const valueA = objA[keyA];
    const valueB = objB[keyB];

    return isEqual(valueA, valueB);
  });
}

function escapeBrackets(str) {
  return str
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\</g, '\\<')
    .replace(/\>/g, '\\>');
}

// Takes a shell script string and transforms it into a one liner
function shCmd(cmd) {
  return cmd
    .trim()
    .replace(/\n+/g, ';')
    .replace(/\s+/g, ' ')
    .replace(/then\s*;/g, 'then')
    .replace(/else\s*;/g, 'else')
    .replace(/;\s*;/g, ';')
    .trim();
}

function naturalSort(as, bs) {
  let a1;
  let b1;
  let i = 0;
  let n;
  const rx = /(\.\d+)|(\d+(\.\d+)?)|([^\d.]+)|(\.\D+)|(\.$)/g;

  if (as === bs) {
    return 0;
  }

  const a = as.toLowerCase().match(rx);
  const b = bs.toLowerCase().match(rx);
  const L = a.length;

  while (i < L) {
    if (!b[i]) {
      return 1;
    }

    a1 = a[i];
    b1 = b[i++];

    if (a1 !== b1) {
      n = a1 - b1;

      if (!isNaN(n)) {
        return n;
      }

      return a1 > b1 ? 1 : -1;
    }
  }

  return b[i] ? -1 : 0;
}

// Temporarily changes CWD for child_process and then restores it at the end
// of the execution. Useful for submodules. Will emit a 'cwdChange' event once
// it happens to do so
function setTempCwd(callback, tempCwd) {
  tempCwd = resolve(cwd(), tempCwd);

  const result = scopeEnv(() => {
    init();
    Utils.emit('cwdChange', tempCwd);

    return callback();
  }, {
    TORTILLA_CWD: tempCwd
  });

  init();
  Utils.emit('cwdChange', cwdReturnValue);

  return result;
}

// Will use the shortest indention as an axis
export const freeText = (text) => {
  if (text instanceof Array) {
    text = text.join('')
  }

  // This will allow inline text generation with external functions, same as ctrl+shift+c
  // As long as we surround the inline text with ==>text<==
  text = text.replace(
    /( *)==>((?:.|\n)*?)<==/g,
    (match, baseIndent, content) =>
  {
    return content
      .split('\n')
      .map(line => `${baseIndent}${line}`)
      .join('\n')
  })

  const lines = text.split('\n')

  const minIndent = lines.filter(line => line.trim()).reduce((soFar, line) => {
    const currIndent = line.match(/^ */)[0].length

    return currIndent < soFar ? currIndent : soFar
  }, Infinity)

  return lines
    .map(line => line.slice(minIndent))
    .join('\n')
    .trim()
    .replace(/\n +\n/g, '\n\n')
}

export function pluckRemoteData(remoteUrl) {
  // git@github.com:Urigo/WhatsApp-Clone-Client-React.git
  const match = (
    remoteUrl.match(/^git@([^\n:]+):([^\n\/]+)\/([^\n\.]+)(\.git)?$/) ||
    remoteUrl.match(/^https?:\/\/([^\n\/]+)\/([^\n\/]+)\/([^\n\.]+)(\.git)?$/)
  )

  if (!match) { return null }

  return {
    host: match[1],
    owner: match[2],
    repo: match[3],
  }
}

function log(...args) {
  console.log(...args);
}

function debug(...args) {
  if (process.env.DEBUG) {
    console.log(...args);
  }
}

export const Utils = Object.assign(new EventEmitter(), {
  cwd,
  exec,
  inspect,
  git,
  npm,
  childProcessOf: isChildProcessOf,
  exists,
  scopeEnv,
  filterMatches,
  merge,
  extend,
  contract,
  pluck,
  pad,
  padRight,
  kebabCase: toKebabCase,
  startCase: toStartCase,
  lowerFirst,
  upperFirst,
  words: splitWords,
  delegateProperties,
  isEqual,
  escapeBrackets,
  shCmd,
  naturalSort,
  tempCwd: setTempCwd,
  freeText,
  pluckRemoteData,
  log,
  debug,
});
