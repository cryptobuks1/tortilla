import * as Fs from 'fs-extra';
import * as Minimist from 'minimist';
import { Git } from './git';
import { localStorage as LocalStorage } from './local-storage';
import { Paths } from './paths';
import { Step } from './step';
import { Submodule } from './submodule';
import { freeText } from './utils';

/**
 The rebase module is responsible for performing tasks done by the editor using an
 interactive rebase.
 */

function init() {
  if (require.main !== module) {
    return;
  }

  const argv = Minimist(process.argv.slice(2), {
    string: ['_'],
  });

  const method = argv._[0];
  const arg1 = argv._[1];

  switch (method) {
    case 'reword':
      return rewordRecentStep(arg1);
    case 'super-pick':
      return superPickStep(arg1);
    case 'rebranch-super':
      return rebranchSuperSteps();
    case 'stash-rebase-state':
      return stashRebaseState(arg1);
  }
}

init();

// Responsible for editing the recent commit's message. It will also sort the step's
// number if needed
export function rewordRecentStep(message) {
  // Calculate next step based on the current commit's message
  const commitMessage = Git.recentCommit(['--format=%s']);
  const stepDescriptor = Step.descriptor(commitMessage);
  const nextStep = getNextStep(stepDescriptor);
  // Open the editor by default
  const args = ['commit', '--amend', '--allow-empty'];
  // If message provided skip editor
  if (message) {
    args.push('-m', message);
  }

  // Specified step is gonna be used for when forming the commit message
  LocalStorage.setItem('HOOK_STEP', nextStep);

  // This will be used later on to update the manuals
  if (stepDescriptor && Step.ensureStepMap()) {
    Step.updateStepMap('reset', { oldStep: stepDescriptor.number, newStep: nextStep });
  }

  // commit, let git hooks do the rest
  Git.print(args);
}

// The super-picker is responsible for cherry-picking super steps and
// rename their manual files
export function superPickStep(hash) {
  const message = Git.recentCommit(hash, ['--format=%s']);
  const oldStep = Step.descriptor(message).number;
  const newStep = Step.nextSuper();

  // Fetch patch data
  const diff = (newStep as any) - (oldStep as any);
  const stepFilePattern = /step(\d+)\.(md|tmpl)/g;
  const patch = Git(['format-patch', '-1', hash, '--stdout']);

  // Replace references for old manual files with new manual files
  let fixedPatch = patch.replace(stepFilePattern, (file, step, extension) => {
    step = Number(step) + diff;

    return `step${step}.${extension}`;
  });

  const submoduleCwd = LocalStorage.getItem('SUBMODULE_CWD');
  const stepMap = Step.getStepMap(submoduleCwd, true);

  if (stepMap) {
    // The submodule cwd was given from another process of tortilla
    const submodule = Submodule.getLocalName(submoduleCwd);
    const diffStepPattern = /\{\{\s*diffStep\s+"?(\d+\.\d+)"?.*\}\}/g;

    // Replace indexes presented in diffStep() template helpers
    fixedPatch = fixedPatch.replace(diffStepPattern, (helper, oldStepId) => {
      let helperSubmodule = helper.match(/module\s?=\s?"?([^\s"]+)"?/);
      helperSubmodule = helperSubmodule ? helperSubmodule[1] : '';

      // Don't replace anything if submodules don't match
      if (helperSubmodule !== submodule) {
        return helper;
      }

      // In case step has been removed in the process, replace it with a meaningless placeholder
      const newStepId = stepMap[oldStepId] || 'XX.XX';

      return helper.replace(/(diffStep\s+"?)\d+\.\d+/, `$1${newStepId}`);
    });
  }

  // Apply patch
  Git(['am'], {
    input: fixedPatch,
  });
}

// Updates the branches referencing all super steps
export function rebranchSuperSteps() {
  const rootBranch = Git.activeBranchName();

  // Delete root
  try {
    Git(['branch', '-D', `${rootBranch}-root`]);
  } catch (e) {
    // Ignore
  }

  // Delete steps
  Git(['branch']).split('\n').filter((branch) => {
    return branch.match(new RegExp(`${rootBranch}-step\\d+`));
  })
    .forEach((branch) => {
      Git(['branch', '-D', branch.trim()]);
    });

  // Branch root
  Git(['branch', `${rootBranch}-root`, Git.rootHash()]);

  // Branch steps
  Git(['log', '--format=%H %s', '--grep=^Step [0-9]\\+:'])
    .split('\n')
    .filter(Boolean)
    .map((log) => {
      let message = log.split(' ');
      const hash = message.shift();
      message = message.join(' ');

      return {
        number: Step.descriptor(message).number,
        hash,
      };
    })
    .forEach((step) => {
      Git(['branch', `${rootBranch}-step${step.number}`, step.hash]);
    });
}

export function getPreviousEditedSteps() {
  return Git(['log', '--format=%s'], {
    cwd: Paths.rebaseStates,
  }).split('\n').slice(1);
}

// Given a step, it will look for its belonging rebase state and will restore everything
// to that point of time, including todo and tortilla local storage
export function hardResetRebaseState(step) {
  // HEAD on rebase state should now reference provided step
  const rebaseStateObject = Git(['log', `--grep=${step}`, '--format=%H'], {
    cwd: Paths.rebaseStates,
  });

  Git(['reset', '--hard', rebaseStateObject], {
    cwd: Paths.rebaseStates,
  });

  const rebaseStatesStorage = new LocalStorage.native(Paths.rebaseStates);
  const head = rebaseStatesStorage.getItem('HEAD');

  // Hard reset HEAD from rebase state
  Git(['reset', '--hard', head]);

  // Restore essential local storage items
  LocalStorage.setItem('REBASE_OLD_STEP', rebaseStatesStorage.getItem('REBASE_OLD_STEP'));
  LocalStorage.setItem('REBASE_NEW_STEP', rebaseStatesStorage.getItem('REBASE_NEW_STEP'));
  LocalStorage.removeItem('REBASE_HOOKS_DISABLED');

  // Restore todo from rebase state
  Git(['rebase', '--edit-todo'], {
    env: {
      GIT_SEQUENCE_EDITOR: `node ${Paths.tortilla.editor} reset-todo`
    }
  });

  const statusMessage = Git(['log', '-1', '--format=%h...  %s']);

  // Match git's native API log
  console.log(freeText(`
    Stopped at ${statusMessage}
    You can amend the commit now, with

      git commit --amend

    Once you are satisfied with your changes, run

      git rebase --continue
  `));
}

// Will create a new rebase state so we can go back to it during the editing process
export function stashRebaseState(todoFile: string) {
  let todo = Fs.readFileSync(todoFile).toString();
  const tasks = todo.split('\n');
  const [, head = '', step = ''] = tasks[0].trim().match(/edit +(\w+) +Step +(\d+(?:\.\d+)?)/) || [];

  if (!head || !step) { return; }

  const rebaseStatesStorage = new LocalStorage.native(Paths.rebaseStates);
  // Since the execution comes BEFORE the edit itself, we need to slice it out to get
  // a todo list which is right for the edit state
  todo = tasks.slice(1).join('\n');

  // Save essential local storage variables for step editing
  rebaseStatesStorage.setItem('REBASE_OLD_STEP', LocalStorage.getItem('REBASE_OLD_STEP') || step);
  rebaseStatesStorage.setItem('REBASE_NEW_STEP', LocalStorage.getItem('REBASE_NEW_STEP') || step);
  rebaseStatesStorage.setItem('HEAD', Git(['rev-parse', head]));
  rebaseStatesStorage.setItem('TODO', todo);

  // Edit on top of the rebase_states stack, using git commits
  Git(['add', '.'], {
    cwd: Paths.rebaseStates,
  });

  Git(['commit', '-m', step], {
    cwd: Paths.rebaseStates,
  });
}

// Calculate the next step dynamically based on its super flag
function getNextStep(stepDescriptor) {
  if (!stepDescriptor) {
    return '';
  }

  const isSubStep = !!stepDescriptor.number.split('.')[1];

  return isSubStep ? Step.next(1) : Step.nextSuper(1);
}
