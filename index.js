#!/usr/bin/env node
'use strict';

const Listr = require('listr');
const readPkg = require('read-pkg-up');
const execa = require('execa');
const fs = require('fs');

const argv = require('yargs').usage('$0 <package> -- npm arguments')
    .boolean('yolo')
    .describe('yolo', 'Omits running tests after bumping the dependency.')
    .boolean('push')
    .describe('push', 'Commits and pushes the update after installing.')
    .demand(1, 'You must provide a package to bump!')
    .argv
const npmArgs = argv._.slice(1);

let modulePkg;
let projectPkgPath;
let targetVersion;

const name = argv._[0];
const tasks = new Listr([]);

if (argv.push) {
    tasks.add([
        {
            title: 'Running prerequisite check',
            task: () => {
                return execa.stdout('git', ['status', '--porcelain']).then(status => {
                    if (!status) return;
                    throw new Error('Cannot use --push with an unclean working tree.');
                });
            },
        },
    ]);
}

tasks.add([
    {
        title: `Bumping package.json to latest version`,
        task: () => {
            return readPkg({ normalize: false }).then(result => {
                let parent;
                if (result.pkg.dependencies && result.pkg.dependencies.hasOwnProperty(name)) {
                    parent = result.pkg.dependencies;
                }
                if (result.pkg.devDependencies && result.pkg.devDependencies.hasOwnProperty(name)) {
                    parent = result.pkg.devDependencies;
                }
                if (!parent) {
                    throw new Error(`${name} is not installed!`);
                }

                projectPkgPath = result.path;

                return execa.stdout('npm', ['show', name, 'version'].concat(npmArgs)).then(version => {
                    targetVersion = parent[name].replace(/^([\^=><~]*).+$/, `$1${version}`);
                    if (targetVersion === parent[name]) {
                        console.log(`\n${name} is already up-to-date`);
                        process.exit(0);
                    }

                    parent[name] = targetVersion;
                    fs.writeFileSync(result.path, JSON.stringify(result.pkg, null, 2));
                });
            });
        },
    },
    {
        title: 'Installing new version',
        task: () => execa('npm', ['install', name].concat(npmArgs)),
    },
]);

if (!argv.yolo) {
    tasks.add({
        title: 'Running tests',
        task: () => execa('npm', ['test'])
    });
}

if (argv.push) {
    tasks.add([
        {
            title: 'Committing and pushing changes',
            task: () => {
                return execa.stdout('git', ['add', projectPkgPath])
                .then(() => execa.stdout('git', ['commit', '-m', `Bump ${name} to ${targetVersion}`]))
                .then(() => execa.stdout('git', ['rev-parse', '--abbrev-ref', 'HEAD']))
                .then(branch => execa.stdout('git', ['push', 'origin', branch]));
            },
        },
    ]);
}

tasks.run()
.then(() => {
    console.error(`\nBumped to ${name}@${targetVersion}`);
    process.exit(0);
})
.catch(err => {
    console.error(`\n${err.message}`);
    process.exit(1);
});
