import * as Fs from 'fs-extra';
import * as Minimist from 'minimist';
import * as Path from 'path';
import { Git } from './git';
import { localStorage as LocalStorage } from './local-storage';
import { Paths } from './paths';
import { prompt } from './prompt';
import * as Rebase from './rebase';
import { Utils } from './utils';

// Get recent commit by specified arguments
function getRecentCommit(offset, format, grep) {
  if (typeof offset === 'string') {
    if (!grep) { grep = format; }
    format = offset;
    offset = 0;
  }

  const argv = [];

  if (format) {
    argv.push(`--format=${format}`);
  }

  if (grep) {
    argv.push(`--grep=${grep}`);
  }

  return Git.recentCommit(offset, argv);
}

// Get the recent step commit
function getRecentStepCommit(offset, format?) {
  return getRecentCommit(offset, format, '^Step [0-9]\\+');
}

// Get the recent super step commit
function getRecentSuperStepCommit(offset, format?) {
  return getRecentCommit(offset, format, '^Step [0-9]\\+:');
}

// Get the recent sub step commit
function getRecentSubStepCommit(offset, format?) {
  return getRecentCommit(offset, format, '^Step [0-9]\\+\\.[0-9]\\+:');
}

// Extract step json from message
function getStepDescriptor(message): { number: string, message: string, type: string } {
  if (message == null) {
    throw TypeError('A message must be provided');
  }

  const match = message.match(/^Step (\d+(?:\.\d+)?)\: ((?:.|\n)*)$/);

  return match && {
    number: match[1],
    message: match[2],
    type: match[1].split('.')[1] ? 'sub' : 'super',
  };
}

// Extract super step json from message
function getSuperStepDescriptor(message) {
  if (message == null) {
    throw TypeError('A message must be provided');
  }

  const match = message.match(/^Step (\d+)\: ((?:.|\n)*)$/);

  return match && {
    number: Number(match[1]),
    message: match[2],
  };
}

// Extract sub step json from message
function getSubStepDescriptor(message) {
  if (message == null) {
    throw TypeError('A message must be provided');
  }

  const match = message.match(/^Step ((\d+)\.(\d+))\: ((?:.|\n)*)$/);

  return match && {
    number: match[1],
    superNumber: Number(match[2]),
    subNumber: Number(match[3]),
    message: match[4],
  };
}

// Push a new step with the provided message
function pushStep(message, options) {
  const step = getNextStep();
  commitStep(step, message, options);
  // Meta-data for step editing
  LocalStorage.setItem('REBASE_NEW_STEP', step);
}

// Pop the last step
function popStep() {
  const headHash = Git(['rev-parse', 'HEAD']);
  const rootHash = Git.rootHash();

  if (headHash === rootHash) {
    throw Error("Can't remove root");
  }

  const removedCommitMessage = Git.recentCommit(['--format=%s']);
  const stepDescriptor = getStepDescriptor(removedCommitMessage);

  Git.print(['reset', '--hard', 'HEAD~1']);

  // Meta-data for step editing
  if (stepDescriptor) {
    LocalStorage.setItem('REBASE_NEW_STEP', getCurrentStep());

    // This will be used later on to update the manuals
    if (ensureStepMap()) {
      updateStepMap('remove', { step: stepDescriptor.number });
    }

    // Delete branch referencing the super step unless we're rebasing, in which case the
    // branches will be reset automatically at the end of the rebase
    if (stepDescriptor.type === 'super' && !Git.rebasing()) {
      const branch = Git.activeBranchName();

      Git(['branch', '-D', `${branch}-step${stepDescriptor.number}`]);
    }
  } else {
    console.warn('Removed commit was not a step');

    return;
  }
}

// Finish the current with the provided message and tag it
function tagStep(message) {
  const step = getNextSuperStep();
  const tag = `step${step}`;
  const manualFile = `${tag}.tmpl`;
  const manualTemplatePath = Path.resolve(Paths.manuals.templates, manualFile);

  Fs.ensureDirSync(Paths.manuals.templates);
  Fs.ensureDirSync(Paths.manuals.views);

  // If file exists, use it instead of overriding it
  if (!Fs.existsSync(manualTemplatePath)) {
    Fs.writeFileSync(manualTemplatePath, '');
  }

  Git(['add', manualTemplatePath]);

  commitStep(step, message);

  // If we're in edit mode all the branches will be set after the rebase
  if (!Git.rebasing()) {
    const branch = Git.activeBranchName();
    // This branch will be used to run integration testing
    Git(['branch', `${branch}-step${step}`]);
  }

  // Meta-data for step editing
  LocalStorage.setItem('REBASE_NEW_STEP', step);
}

// The opposite of git rebase --continue: Will step back to the previously edited step
async function stepBack(targetStep: string, options = { interactive: false }) {
  if (!Git.rebasing()) {
    throw Error('fatal: No rebase in progress?');
  }

  // If prior to that we did `edit 1.1..1.3` and we're in 1.3 this will result in [1.1, 1.2]
  const previousSteps = Rebase.getPreviousEditedSteps();

  if (!previousSteps.length) {
    throw Error('No previous steps found');
  }

  if (targetStep) {
    // Multiplier e.g. x3
    if (/x\d+/.test(targetStep)) {
      const times = Number(targetStep.match(/x(\d+)/)![1]);
      targetStep = previousSteps[times - 1];
    }
    // Step e.g. 1.1
    else if (!/\d+(\.\d+)?/.test(targetStep)) {
      throw TypeError('Provided argument is neither a step or a multiplier');
    }
  }
  // Prompt
  else if (options.interactive) {
    targetStep = await prompt([
      {
        type: 'list',
        name: 'stepback',
        message: 'Which step would you like to go back to?',
        choices: previousSteps,
      }
    ]);
  }
  // Target step was provided
  else {
    targetStep = previousSteps[0];
  }

  if (!targetStep) {
    throw TypeError('targetStep must be provided');
  }

  // Make sure it's actually relevant
  if (previousSteps.every(s => s !== targetStep)) {
    throw TypeError(`Provided target step ${targetStep} was not edited`);
  }

  // After retrieving target step, this is where the magic happens
  // Message will be printed over here
  Rebase.hardResetRebaseState(targetStep);
}

// Get the hash of the step followed by ~1, mostly useful for a rebase
function getStepBase(step) {
  if (!step) {
    const message = getRecentStepCommit('%s');
    if (!message) {
      return '--root';
    }

    step = getStepDescriptor(message).number;
  }

  if (step === 'root') {
    return '--root';
  }

  const hash = Git.recentCommit([
    `--grep=^Step ${step}:`,
    '--format=%h',
  ]);

  if (!hash) {
    throw Error('Step not found');
  }

  return `${hash}~1`;
}

// Edit the provided step
function editStep(steps, options: any = {}) {
  const rootSha1 = Git.rootHash();
  const allSteps = getAllSteps();

  steps = [].concat(steps).filter(Boolean);

  // Unwrap ranges, e.g.
  // 1...3.1 may become 1 2.1 2.2 2.3 2 3.1
  steps = steps.reduce((flattened, step) => {
    const range = step.match(/(\d+(?:\.\d+)?)?\.\.(?:\.+)?(\d+(?:\.\d+)?)?/);

    if (!range) { return flattened.concat(step); }

    const start = range[1] || 'root';
    const end = range[2] || allSteps[allSteps.length - 1];
    let startIndex = allSteps.findIndex(s => s === start);
    const endIndex = allSteps.findIndex(s => s === end);
    if (startIndex === -1) { startIndex = 0; }
    if (endIndex === -1) { startIndex = Infinity; }

    return flattened.concat(allSteps.slice(startIndex, endIndex + 1));
  }, []);

  // Map git-refs to step indexes
  steps = steps.map((step) => {
    // If an index was provided, return it; otherwise try to find the index by SHA1
    if (/^\d{1,5}(\.\d+)?$/.test(step) || step === 'root') { return step; }
    if (step === rootSha1) { return 'root'; }

    const commitMessage = Git(['log', step, '-1', '--format=%s'])
    const descriptor = getStepDescriptor(commitMessage);

    return descriptor && descriptor.number;
  }).filter(Boolean);

  steps = steps.slice().sort((a, b) => {
    const [superA, subA] = a.split('.').concat('Infinity');
    const [superB, subB] = b.split('.').concat('Infinity');

    // Always put the root on top
    if (a === 'root') {
      return -1;
    }

    if (b === 'root') {
      return 1;
    }

    // Put first steps first
    return (
      (superA - superB) ||
      (subA - subB)
    );
  });

  // The would always have to start from the first step
  const base = getStepBase(steps[0]);

  // '--root' might be fetched in case no steps where provided. We need to fill up
  // this missing information in the steps array
  if (!steps.length && base === '--root') {
    steps[0] = 'root';
  }

  const argv = [Paths.tortilla.editor, 'edit', ...steps];

  // Update diffSteps
  if (options.udiff != null) {
    argv.push('--udiff');
  }

  // Update diffSteps in another repo
  if (options.udiff) {
    argv.push(options.udiff.toString());
  }

  // Storing locally so it can be used in further processes
  // Indicates that this operation is hooked into a submodule
  if (process.env.TORTILLA_SUBMODULE_CWD) {
    LocalStorage.setItem('SUBMODULE_CWD', process.env.TORTILLA_SUBMODULE_CWD);
  }

  // Initialize rebase_states git project
  Fs.removeSync(Paths.rebaseStates);
  Git(['init', Paths.rebaseStates]);

  Git.print(['rebase', '-i', base, '--keep-empty'], {
    env: {
      GIT_SEQUENCE_EDITOR: `node ${argv.join(' ')}`,
    },
  });
}

// Adjust all the step indexes from the provided step
function sortStep(step) {
  // If no step was provided, take the most recent one
  if (!step) {
    step = getRecentStepCommit('%s');
    step = getStepDescriptor(step);
    step = step ? step.number : 'root';
  }

  let newStep;
  let oldStep;
  let base;

  // If root, make sure to sort all step indexes since the beginning of history
  if (step === 'root') {
    newStep = '1';
    oldStep = 'root';
    base = '--root';
  } else { // Else, adjust only the steps in the given super step
    newStep = step.split('.').map(Number)[0];
    oldStep = newStep - 1 || 'root';
    newStep = `${newStep}.${1}`;
    base = getStepBase(newStep);
  }

  // Setting local storage variables so re-sortment could be done properly
  LocalStorage.setItem('REBASE_NEW_STEP', newStep);
  LocalStorage.setItem('REBASE_OLD_STEP', oldStep);

  Git.print(['rebase', '-i', base, '--keep-empty'], {
    env: {
      GIT_SEQUENCE_EDITOR: `node ${Paths.tortilla.editor} sort`,
    },
  });
}

// Reword the provided step with the provided message
function rewordStep(step, message) {
  const base = getStepBase(step);
  const argv = [Paths.tortilla.editor, 'reword'];
  if (message) {
    argv.push('-m', `"${message}"`);
  }

  Git.print(['rebase', '-i', base, '--keep-empty'], {
    env: {
      GIT_SEQUENCE_EDITOR: `node ${argv.join(' ')}`,
    },
  });
}

// Run git-show for given step index
function showStep(step, ...args) {
  assertStep(step)

  step = step.split('.').join('\\.')

  const hash = Git(['log', `--grep=^Step ${step}`, '--format=%H'])

  if (!hash) {
    throw Error('Step not found')
  }

  Git.print(['show', hash, ...args])
}

// Asserts whether provided string is a step index or not
function assertStep(step: string | number, silent = false) {
  if (typeof step !== 'string' && typeof step !== 'number') {
    if (silent) { return false }

    throw TypeError('Provided argument is not of type string or number')
  }

  step = step.toString()

  if (!/\d+/.test(step) && !/\d+\.\d+/.test(step)) {
    if (silent) { return false }

    throw TypeError('Provided argument is not a step')
  }

  return true
}

// Add a new commit of the provided step with the provided message
function commitStep(step, message, options: any = {}) {
  const argv = ['commit'];
  if (message) {
    argv.push('-m', message);
  }
  if (options.allowEmpty) {
    argv.push('--allow-empty');
  }

  // Specified step is gonna be used for when forming the commit message
  LocalStorage.setItem('HOOK_STEP', step);

  try {
    // commit
    Git.print(argv);
  } catch (err) {
    // Clearing storage to prevent conflicts with upcoming commits
    LocalStorage.removeItem('HOOK_STEP');
    throw err;
  }
}

// Get the current step
function getCurrentStep() {
  // Probably root commit
  const recentStepCommit = getRecentStepCommit('%s');
  if (!recentStepCommit) {
    return 'root';
  }

  // Cover unexpected behavior
  const descriptor = getStepDescriptor(recentStepCommit);
  if (!descriptor) {
    return 'root';
  }

  return descriptor.number;
}

// Get the current super step
function getCurrentSuperStep() {
  // Probably root commit
  const recentStepCommit = getRecentSuperStepCommit('%s');
  if (!recentStepCommit) {
    return 'root';
  }

  // Cover unexpected behavior
  const descriptor = getSuperStepDescriptor(recentStepCommit);
  if (!descriptor) {
    return 'root';
  }

  return descriptor.number;
}

// Get the next step
function getNextStep(offset?) {
  // Fetch data about recent step commit
  const stepCommitMessage = getRecentStepCommit(offset, '%s');
  const followedByStep = !!stepCommitMessage;

  // If no previous steps found return the first one
  if (!followedByStep) {
    return '1.1';
  }

  // Fetch data about current step
  const stepDescriptor = getStepDescriptor(stepCommitMessage);
  const stepNumbers = stepDescriptor.number.split('.');
  const superStepNumber = Number(stepNumbers[0]);
  const subStepNumber = Number(stepNumbers[1]);
  const isSuperStep = !subStepNumber;

  if (!offset) {
    // If this is a super step return the first sub step of a new step
    if (isSuperStep) {
      return `${superStepNumber + 1}.${1}`;
    }

    // Else, return the next step as expected
    return `${superStepNumber}.${subStepNumber + 1}`;
  }

  // Fetch data about next step
  const nextStepCommitMessage = getRecentStepCommit(offset - 1, '%s');
  const nextStepDescriptor = getStepDescriptor(nextStepCommitMessage);
  const nextStepNumbers = nextStepDescriptor.number.split('.');
  const nextSubStepNumber = Number(nextStepNumbers[1]);
  const isNextSuperStep = !nextSubStepNumber;

  if (isNextSuperStep) {
    // If this is a super step return the next super step right away
    if (isSuperStep) {
      return (superStepNumber + 1).toString();
    }

    // Else, return the current super step
    return superStepNumber.toString();
  }

  // If this is a super step return the first sub step of the next step
  if (isSuperStep) {
    return `${superStepNumber + 1}.${1}`;
  }

  // Else, return the next step as expected
  return `${superStepNumber}.${subStepNumber + 1}`;
}

// Get the next super step
function getNextSuperStep(offset?) {
  return getNextStep(offset).split('.')[0];
}

// Pending flag indicates that this step map will be used in another tortilla repo
function initializeStepMap(pending) {
  const map = Git([
    'log', '--format=%s', '--grep=^Step [0-9]\\+',
  ])
    .split('\n')
    .filter(Boolean)
    .reduce((m, subject) => {
      const num = getStepDescriptor(subject).number;
      m[num] = num;

      return m;
    }, {});

  LocalStorage.setItem('STEP_MAP', JSON.stringify(map));

  if (pending) {
    LocalStorage.setItem('STEP_MAP_PENDING', true);
  } else {
    LocalStorage.removeItem('STEP_MAP_PENDING');
  }
}

// First argument represents the module we would like to read the steps map from
function getStepMap(submoduleCwd?, checkPending?) {
  let localStorage;

  // In case this process was launched from a submodule
  if (submoduleCwd) {
    localStorage = LocalStorage.create(submoduleCwd);
  } else {
    localStorage = LocalStorage;
  }

  if (ensureStepMap(submoduleCwd, checkPending)) {
    return JSON.parse(localStorage.getItem('STEP_MAP'));
  }
}

// Provided argument will run an extra condition to check whether the pending flag
// exists or not
function ensureStepMap(submoduleCwd?, checkPending?) {
  // Step map shouldn't be used in this process
  if (checkPending && LocalStorage.getItem('STEP_MAP_PENDING')) {
    return false;
  }

  let paths;

  // In case this process was launched from a submodule
  if (submoduleCwd) {
    paths = Paths.resolveProject(submoduleCwd);
  } else {
    paths = Paths;
  }

  return Utils.exists(Path.resolve(paths.storage, 'STEP_MAP'), 'file');
}

function disposeStepMap() {
  LocalStorage.deleteItem('STEP_MAP');
  LocalStorage.deleteItem('STEP_MAP_PENDING');
}

function updateStepMap(type, payload) {
  const map = getStepMap();

  switch (type) {
    case 'remove':
      delete map[payload.step];

      break;

    case 'reset':
      map[payload.oldStep] = payload.newStep;

      break;
  }

  LocalStorage.setItem('STEP_MAP', JSON.stringify(map));
}

// Gets a list of all steps, from root to the most recent step
function getAllSteps() {
  const allSteps = Git(['log', '--grep=^Step [0-9]\\+.\\?[0-9]*:', '--format=%s'])
    .split('\n')
    .map(message => getStepDescriptor(message))
    .filter(Boolean)
    .map(descriptor => descriptor.number)
    .reverse();

  allSteps.unshift('root');

  return allSteps;
}

/**
 Contains step related utilities.
 */

(() => {
  if (require.main !== module) {
    return;
  }

  const argv = Minimist(process.argv.slice(2), {
    string: ['_', 'message', 'm'],
    boolean: ['root', 'udiff', 'allow-empty'],
  });

  const method = argv._[0];
  let step = argv._[1];
  const message = argv.message || argv.m;
  const root = argv.root;
  const allowEmpty = argv['allow-empty'];
  const udiff = argv.udiff;

  if (!step && root) {
    step = 'root';
  }

  const options = {
    allowEmpty,
    udiff,
  };

  switch (method) {
    case 'push':
      return pushStep(message, options);
    case 'pop':
      return popStep();
    case 'tag':
      return tagStep(message);
    case 'edit':
      return editStep(step, options);
    case 'sort':
      return sortStep(step);
    case 'reword':
      return rewordStep(step, message);
  }
})();

export const Step = {
  push: pushStep,
  pop: popStep,
  tag: tagStep,
  back: stepBack,
  edit: editStep,
  sort: sortStep,
  reword: rewordStep,
  show: showStep,
  assert: assertStep,
  commit: commitStep,
  current: getCurrentStep,
  currentSuper: getCurrentSuperStep,
  next: getNextStep,
  nextSuper: getNextSuperStep,
  base: getStepBase,
  recentCommit: getRecentStepCommit,
  recentSuperCommit: getRecentSuperStepCommit,
  recentSubCommit: getRecentSubStepCommit,
  descriptor: getStepDescriptor,
  superDescriptor: getSuperStepDescriptor,
  subDescriptor: getSubStepDescriptor,
  initializeStepMap,
  getStepMap,
  ensureStepMap,
  disposeStepMap,
  updateStepMap,
  all: getAllSteps,
};
