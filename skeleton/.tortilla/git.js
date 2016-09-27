var Path = require('path');
var Paths = require('./paths');
var Utils = require('./utils');

/*
  Contains general git utilities.
 */

var git = Utils.git;

commit.print = commitPrint;


// Tells if rebasing or not
function isRebasing() {
  return Utils.exists(Paths.git.rebaseMerge) || Utils.exists(Paths.git.rebaseApply);
}

// Tells if cherry-picking or not
function isCherryPicking() {
  return Utils.exists(Paths.git.heads.cherryPick) || Utils.exists(Paths.git.heads.revert);
}

// Tells if amending or not
function isAmending() {
  return Utils.runBy('git', ['--amend']);
}

// Tells if a tag exists or not
function tagExists(tag) {
  return Utils.exists(Path.resolve(Paths.git.refs.tags, tag));
}

// Get the recent commit by the provided arguments. An offset can be specified which
// means that the recent commit from several times back can be fetched as well
function getRecentCommit(offset, argv) {
  if (offset instanceof Array) {
    argv = offset;
    offset = 0;
  }
  else {
    argv = argv || [];
    offset = offset || 0;
  }

  var hash = typeof offset == 'string' ? offset : ('HEAD~' + offset);

  argv = ['log', hash, '-1'].concat(argv);
  return git(argv);
}

// Gets a list of the modified files reported by git matching the provided pattern.
// This includes untracked files, changed files and deleted files
function getStagedFiles(pattern) {
  var stagedFiles = git(['diff', '--name-only', '--cached'])
    .split('\n')
    .filter(Boolean);

  return Utils.filterMatches(stagedFiles, pattern);
}

// Commit changes and print to the terminal
function commitPrint(argv) {
  argv = argv || [];
  return git.print(['commit'].concat(argv).concat(['--allow-empty', '--no-verify']));
}

// Commit changes
function commit(argv) {
  argv = argv || [];
  return git(['commit'].concat(argv).concat(['--allow-empty', '--no-verify']));
}


module.exports = Utils.extend(git.bind(null), git, {
  rebasing: isRebasing,
  cherryPicking: isCherryPicking,
  amending: isAmending,
  tagExists: tagExists,
  recentCommit: getRecentCommit,
  stagedFiles: getStagedFiles,
  commit: commit
});