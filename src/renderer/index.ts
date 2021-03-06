import * as Fs from 'fs-extra';
import * as Handlebars from 'handlebars';
import * as Path from 'path';
import { Git} from '../git';
import { Paths} from '../paths';
import { Release} from '../release';
import { Utils} from '../utils';

/**
  A wrapper for Handlebars with several additions which are essential for Tortilla
 */

// Creating a new instance of handlebars which will then be merged with the module
const handlebars = Handlebars.create();
// Keep original handlers since these methods are gonna be overriden
const superRegisterHelper = handlebars.registerHelper.bind(handlebars);
const superRegisterPartial = handlebars.registerPartial.bind(handlebars);
// Used to store registered transformations
const transformations = {};
// Cache for templates which were already compiled
const cache = {};

// Read the provided file, render it, and overwrite it. Use with caution!
function overwriteTemplateFile(templatePath, scope) {
  templatePath = resolveTemplatePath(templatePath);
  const view = renderTemplateFile(templatePath, scope);

  return Fs.writeFileSync(templatePath, view);
}

// Read provided file and render its template. Note that the default path would
// be tortilla's template dir, so specifying a file name would be ok as well
function renderTemplateFile(templatePath, scope) {
  templatePath = resolveTemplatePath(templatePath);

  if (process.env.TORTILLA_CACHE_DISABLED || !cache[templatePath]) {
    const templateContent = Fs.readFileSync(templatePath, 'utf8');
    cache[templatePath] = handlebars.compile(templateContent);
  }

  const template = cache[templatePath];

  return renderTemplate(template, scope);
}

// Render provided template
function renderTemplate(template, scope: any = {}) {
  // Template can either be a string or a compiled template object
  if (typeof template === 'string') {
    template = handlebars.compile(template);
  }

  let viewDir;

  if (scope.viewPath) {
    // Relative path of view dir
    // e.g. manuals/views
    viewDir = Path.dirname(scope.viewPath);
  }

  const oldResolve = (handlebars as any).resolve;

  try {
    // Set the view file for the resolve utility. If no view path was provided, the
    // resolve function below still won't work
    (handlebars as any).resolve = resolvePath.bind(null, viewDir);

    // Remove trailing white-space
    return template(scope).replace(/ *\n/g, '\n');
  } finally {
    // Either if an error was thrown or not, unbind it
    (handlebars as any).resolve = oldResolve;
  }
}

// Returns a template path relative to tortilla with an '.tmpl' extension
function resolveTemplatePath(templatePath) {
  if (templatePath.indexOf('.tmpl') === -1) {
    templatePath += '.tmpl';
  }

  // User defined templates
  const relativeTemplatePath = Path.resolve(Paths.manuals.templates, templatePath);
  if (Utils.exists(relativeTemplatePath)) {
    return relativeTemplatePath;
  }

  // Tortilla defined templates
  return Path.resolve(Paths.tortilla.renderer.templates, templatePath);
}

// Register a new helper. Registered helpers will be wrapped with a
// [{]: <helper> (name ...args) [}]: #
function registerHelper(name, helper, options?) {
  options = options || {};

  const wrappedHelper = function() {
    const oldCall = (handlebars as any).call;
    let out;

    try {
      // Bind the call method to the current context
      (handlebars as any).call = callHelper.bind(this);
      out = helper.apply(this, arguments);
    } finally { // Fallback
      // Restore method to its original
      (handlebars as any).call = oldCall;
    }

    if (typeof out !== 'string' &&
        !(out instanceof String)) {
      throw Error([
        'Template helper', name, 'must return a string!',
        'Instead it returned', out,
      ].join(' '));
    }

    const target = process.env.TORTILLA_RENDER_TARGET;
    const args = [].slice.call(arguments);

    // Transform helper output
    const transformation = transformations[target] && transformations[target][name];
    if (transformation) {
      out = transformation(...[out].concat(args));
    }

    // Wrap helper output
    if (options.mdWrap) {
      out = mdWrapComponent('helper', name, args, out);
    }

    return out;
  };

  superRegisterHelper(name, wrappedHelper);
}

// Register a new partial. Registered partials will be wrapped with a
// [{]: <partial> (name) [}]: #
function registerPartial(name, partial, options) {
  options = options || {};

  // Wrap partial template
  if (options.mdWrap) {
    partial = mdWrapComponent('partial', name, partial);
  }

  return superRegisterPartial(name, partial);
}

// Register a new transformation which will take effect on rendered helpers. This is
// useful when setting the TORTILLA_RENDER_TARGET variable, so we can make additional
// adjustments for custom targets. For now this is NOT part of the official API and
// is used only for development purposes
function registerTransformation(targetName, helperName, transformation) {
  if (!transformations[targetName]) {
    transformations[targetName] = {};
  }
  transformations[targetName][helperName] = transformation;
}

// Returns content wrapped by component notations. Mostly useful if we want to detect
// components in the view later on using external softwares later on.
// e.g. https://github.com/Urigo/angular-meteor-docs/blob/master/src/app/tutorials/
// improve-code-resolver.ts#L24
function mdWrapComponent(type, name, args, content?) {
  let hash = {};

  if (typeof content !== 'string') {
    content = args;
    args = [];
  }

  if (args[args.length - 1] instanceof Object) {
    hash = args.pop().hash;
  }

  // Stringify arguments
  const params = args.map((param) => typeof param === 'string' ? `"${param}"` : param).join(' ');

  hash = stringifyHash(hash);

  // Concat all stringified arguments
  args = [name, params, hash]
    // Get rid of empty strings
    .filter(Boolean)
    .join(' ');

  return `[{]: <${type}> (${Utils.escapeBrackets(args)})\n\n${content}\n\n[}]: #`;
}

// Takes a helper hash and stringifying it
// e.g. { foo: '1', bar: 2 } -> foo="1" bar=2
function stringifyHash(hash) {
  return Object.keys(hash).map((key) => {
    let value = hash[key];

    if (typeof value === 'string') {
      value = `"${value}"`;
    }

    return `${key}=${value}`;
  }).join(' ');
}

// Calls a template helper with the provided context and arguments
function callHelper(methodName) {
  const args = [].slice.call(arguments, 1);
  let options = args.pop();

  // Simulate call from template
  if (options instanceof Object) {
    options = { hash: options };
  }

  args.push(options);

  return handlebars.helpers[methodName].apply(this, args);
}

// Takes a bunch of paths and resolved them relatively to the current rendered view
function resolvePath(/* reserved path, user defined path */) {
  const paths = [].slice.call(arguments);

  // A default path that the host's markdown renderer will know how to resolve by its own
  let defaultPath = paths.slice(1).join('/');
  /* tslint:disable-next-line */
  defaultPath = new String(defaultPath);
  // The 'isRelative' flag can be used later on to determine if this is an absolute path
  // or a relative path
  defaultPath.isRelative = true;

  const cwd = paths.shift();

  // If function is unbound, return default path
  if (typeof cwd !== 'string') {
    return defaultPath;
  }

  const repository = Fs.readJsonSync(Paths.npm.package).repository;
  let repositoryUrl = typeof repository === 'object' ? repository.url : repository;

  // If no repository was defined, or
  // repository type is not git, or
  // no repository url is defined, return default path
  if (!repositoryUrl) {
    return defaultPath;
  }

  repositoryUrl = repositoryUrl
    // Remove .git postfix
    .replace(/.git$/, '')
    // Remove USERNAME@githost.com prefix
    .replace(/[\w]+@/g, '');

  let releaseTag
  // First try to see if HEAD is referencing a release tag already. This is necessary
  // if we're running executing the current template helper for a submodule
  try {
    releaseTag = Git(['describe', '--tags', '--exact-match', 'HEAD']);
  // If not, manually compose it. Necessary for the main git-module
  } catch (e) {
    const currentRelease = Release.format(Release.current());

    // Any release is yet to exist
    if (currentRelease === '0.0.0') {
      return defaultPath;
    }

    releaseTag = `${Git.activeBranchName()}@${currentRelease}`;
  }

  // Compose branch path for current release tree
  // e.g. github.com/Urigo/Ionic2CLI-Meteor-Whatsapp/tree/master@0.0.1
  const branchUrl = [repositoryUrl, 'tree', releaseTag].join('\/');
  const protocol = (branchUrl.match(/^.+\:\/\//) || [''])[0];
  // Using a / so we can use it with the 'path' module
  const branchPath = `/${branchUrl.substr(protocol.length)}`;

  // If we use tilde (~) at the beginning of the path, we will be referenced to the
  // repo's root URL. This is useful when we want to compose links which are
  // completely disconnected from the current state, like commits, issues and PRs
  let resolved = paths.map((path) => path.replace(/\~/g, Path.resolve(branchPath, '../..')));
  // The view dir URL
  // e.g. github.com/DAB0mB/radial-snake/tree/master@0.1.5/.tortilla/manuals/views
  resolved.unshift(Path.join(branchPath, Path.relative(Utils.cwd(), Path.resolve(Utils.cwd(), cwd))));
  resolved = Path.resolve(...resolved);
  // Concatenating the protocol back after final path has been formed
  resolved = protocol + resolved.substr(1);

  return resolved;
}

export const Renderer = Utils.extend(handlebars, {
  overwriteTemplateFile,
  renderTemplateFile,
  renderTemplate,
  registerHelper,
  registerPartial,
  registerTransformation,
  // This should be set whenever we're in a helper scope
  call: callHelper,
  // Should be bound by the `renderTemplate` method
  resolve: resolvePath.bind(null, null),
});

// Built-in helpers and partials
import './helpers/comment';
import './helpers/diff-step';
import './helpers/nav-step';
import './helpers/resolve-path';
import './helpers/step-message';
import './helpers/toc';
import './helpers/translate';
