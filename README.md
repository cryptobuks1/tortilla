# Tortilla

![tortilla](https://cloud.githubusercontent.com/assets/7648874/20839550/3c0d4f14-b894-11e6-8998-a63107385344.png)

A tutorials framework based on git and NodeJS for JavaScript tutorials. This framework contains some handy git-helpers which will help us maintain our commits history nice and clean and will make sure that our project is suitable for deployment. If you're not familiar with the basic rules that you should follow when working with Tortilla, be sure to go through the following guidelines.

[![intro](https://img.youtube.com/vi/dHfmN1NtcUk/0.jpg)](https://www.youtube.com/watch?v=dHfmN1NtcUk)

### Commits

The project should have a very specific form of commits list history. Let's first observe how a valid commits list history should look like and then we will go through it (Tags are preceded by #):

    Step 2: Add todo-list # step2
    Step 2.3: Add todo-list controller
    Step 2.2: Add todo-list view
    Step 2.1: Add todo-list model
    Step 1: Bundling # step1
    Step 1.3: Install the necessary packages for webpack's build
    Step 1.2: Add webpack build to gulp tasks
    Step 1.1: Create a basic webpack config
    Create a new tortilla project # root

As you can see, each commit should present a single step in the tutorial, it means that its message should have the following template:

    Step (step index): (step description)

Some of the commits represent a [sub-step](#sub-step) (e.g. step 1.1, 1.2 etc) and some of the represent a [super-step](#super-step) (e.g. step 1, 2 etc), together they form a whole step. Note that the only exception is the initial commit whose message can be whatever you'd like, the rest of the commits **must** follow these rules, otherwise you will encounter some unexpected behaviors.

> Credit goes to **[@stubailo](http://www.github.com/stubailo)** who originally came up with the commit templates' concept

#### Sub Step

A sub-step is a small portion of the whole step, each sub-step should usually represent a small change which should be followed by an explanation in the tutorial. Sub-steps should be sorted by their chronological order, sub-steps which assemble the same step should have the same super index, and an consecutive sub index separated by a period (e.g. 1.1, 1.2 etc).

#### Super Step

A super-step should **always** come at the end of each step, it should contain a single index and it should be tagged by its step name (e.g. super-step 1 should be tagged "step1", super-step 2 should be tagged "step2" etc). The super-step should add a manual file on how to create the current step. The manual file is a simple markdown file which should be located under the `steps` directory and its name should be `step(index).md`. For more information about manual files, see the [manuals](#manuals) section.

### Manuals

A manual is a simple markdown file which contain some instructions about a specific step, and can be found in the `manuals` dir. Manuals come in two forms - templates, and views. The templates are user-written and can be found in the `manuals/templates` dir and the views are auto-generated by Tortilla using the [render command](#render-manual) command and can be found in the `manuals/views` dir. The manual templates are provided with some handy template helpers which will ease the process of manuals writing, as listed in the following:

#### Diff Step

`{{{diff_step (index) (file)}}}`

Will show us the changes of the specified step in a pretty markdown layout. `index` represents the index of the step and `file` is an optional param for a specific file of which we'd like to show the code diff (Will show diff for all files by default).

### How Do I Start

First you will need to install Tortilla's CLI tool:

    $ sudo npm install tortilla -g

Once you have it installed you can go ahead and create a new Tortilla project:

    $ tortilla create "project name" --message="commit message" --output="output path"

This command will initialize a new Tortilla project in the provided path (Defaults to the current path). The project will be initialized with the provided project name (Defaults to `tortilla-project`) and the provided message as the initial commit message (Will open an editor if no message is provided). If the output path already exists a prompt verifying your decision will show up. To automatically skip it you can provide an optional `--override` option.

Anytime you clone a Tortilla project from a git-host you will need to re-initialize it so Tortilla can work properly:

    $ tortilla init "project path"

An optional project path can be provided when initializing Tortilla (Defaults to current dir). As for now this command has no restrictions and can be used on any project, but is not guaranteed to work as expected, so use with caution.

A manual page for the usage of Tortilla's CLI tool can be brought any time by typing the following:

    $ tortilla --help

### Git Helpers

You've probably noticed that the rules for a valid tutorial project are very strict. This is where the git-helpers kicks in. Instead of having a rough time managing the steps list, here are some kick-ass helpers which will make your life way easier:

#### Push Step

    $ tortilla step push --message="step message"

Push a new step to the top of the stack with the provided message (Will open an editor if no message is provided). If you would like to add a new step in the middle of the stack, first use the [step editing](#edit-step) helper, and then push a new step to the top of the stack.

#### Pop Step

    $ tortilla step pop

Pop the last step from the top of the stack. If you would like to remove a step from the middle of the stack, first use the [step editing](#edit-step) helper, and then pop the step from the top of the stack.

#### Tag Step

    $ tortilla step tag --message="step message"

Add a new super-step and finish the current step with the provided message (Will open an editor if no message is provided). This will add a new step tag to your commits list and it will initialize an empty manual markdown file. If you would like to edit the manual file, simply use the [step editing](#edit-step) helper and amend your changes to the recent commit.

#### Edit Step

    $ tortilla step edit "step index"

Edit the provided step. This will get you into rebase mode, so once you've finished editing your step, just type `git rebase --continue` and let git do its magic. You can add, remove and tag new steps during editing without worrying about the upcoming commits, this helper is smart enough to adjust their content and messages based on your actions. An optional `--root` option can be provided if you would like to edit the root. If no step is specified, the last step will be edited by default.

#### Reword Step

    $ tortilla step reword "step index" --message="step message"

Replace the provided step's message with the provided message (Will open an editor if no message is provided). An optional `--root` option can be provided if you would like to reword the root. If no step is specified, the last step will be reworded by default.

#### Render Manual

    $ tortilla manual render "step index"

Renders and rebases specified step's manual. If you would like to render the root manual you can provide a `--root`. If you would like to render all manuals since the beginning of history you can provide a `--all` option. If no step is specified, the last manual will be rendered by default.

#### Bump Release

    $ tortilla release bump "release type" --message="release message"

Whenever making changes in the tutorial using Tortilla, the commits are being overridden, a behavior we're not always interested in, since sometimes we would like to reference or view previous releases of the tutorial. The `release` command solves this problem by creating tags which are used as snap shot for the current tutorial state. The new tags will be consisted of a `root` and `steps`, each one is proceeded by `@` and its release signature, e.g. `root@1.0.0` or `step@0.2.1`. The first argument of this command is the release type and must be one of `major`, `minor` or `patch`. The `message` argument is optional, and should provide a short description message for the release. If no message is provided, a text editor will be opened, where you can type the change-log of the release. The change-log will be attached to the `root` tag. Before using this command, make sure to pull **all** tags, otherwise you might encounter some unexpected behaviors.

#### Get Release

    $ tortilla release current

Gets the current tutorial release based on the stashed `root` tags; e.g. if we have the tags `root@0.2.1`, `root@1.0.1` and `root@1.0.0`, the printed result would be `1.0.1`.

#### Diff Release

    $ tortilla release diff "source release" "destination release"

Runs `git diff` between `source release` and `destination release`. An additional arguments vector might be appended which will be invoked as is when running `git diff`.

#### Get Strict Mode

    $ tortilla strict get

Gets the current status of strict mode. By default, a newly initialized Tortilla project will be set to be in strict mode, which will restrict you doing from running git operations out side git's scope.

#### Set Strict Mode

    $ tortilla strict set "mode status"

Sets the status of strict mode. Any falsy or truthy value will do. Once strict mode is set, an approval message will be printed to terminal.