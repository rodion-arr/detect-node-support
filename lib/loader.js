'use strict';

const Debug = require('debug');
const Fs = require('fs');
const GitUrlParse = require('git-url-parse');
const Package = require('../package.json');
const Pacote = require('pacote');
const Path = require('path');
const Wreck = require('@hapi/wreck');

const Utils = require('./utils');

const internals = {
    cache: new Map(),
    log: Debug('detect-node-support:loader'),
    error: Debug('detect-node-support:error')
};


internals.parseRepository = (packument) => {

    if (typeof packument.repository === 'string') {
        return packument.repository;
    }

    if (!packument.repository || !packument.repository.url) {
        throw new Error(`Unable to determine the git repository for ${packument.name}`);
    }

    return packument.repository.url;
};


internals.createPackageLoader = async (packageName) => {

    try {
        const packument = await Pacote.packument(packageName + '@latest', {
            'fullMetadata': true,
            'user-agent': `${Package.name}@${Package.version}, see ${Package.homepage}`
        });

        const repository = internals.parseRepository(packument);

        const repositoryLoader = internals.createRepositoryLoader(repository);

        return {
            ...repositoryLoader,
            loadFile: async (filename, options) => {

                const result = await repositoryLoader.loadFile(filename, options);

                if (filename === 'package.json' && result.name !== packageName) {
                    throw new Error(`${repository} does not contain ${packageName}. Monorepo not supported: https://github.com/pkgjs/detect-node-support/issues/6`);
                }

                return result;
            }
        };
    }
    catch (err) {

        if (err.statusCode === 404) {
            throw new Error(`Package ${packageName} does not exist`);
        }

        throw err;

    }
};


internals.createRepositoryLoader = (repository) => {

    if (repository.split('/').length === 2) {
        repository = `https://github.com/${repository}`;
    }

    const parsedRepository = GitUrlParse(repository);

    return {
        getCommit: async () => {

            const simpleGit = Utils.simpleGit();
            const httpRepository = GitUrlParse.stringify(parsedRepository, 'http');
            const result = await simpleGit.listRemote([httpRepository, 'HEAD']);
            const [head] = result.split(/\s+/);

            return head;
        },
        loadFile: async (filename, options) => {

            if (parsedRepository.source !== 'github.com') {
                throw new Error('Only github.com paths supported, feel free to PR at https://github.com/pkgjs/detect-node-support');
            }

            const url = `https://raw.githubusercontent.com/${parsedRepository.full_name}/HEAD/${filename}`;
            internals.log('Loading: %s', url);

            if (options === undefined && internals.cache.has(url)) {
                internals.log('From cache: %s', url);
                return internals.cache.get(url);
            }

            try {
                const { payload } = await Wreck.get(url, options);

                if (options === undefined) {
                    internals.cache.set(url, payload);
                }

                internals.log('Loaded: %s', url);
                return payload;
            }
            catch (err) {

                if (err.data && err.data.res.statusCode === 404) {
                    internals.log('Not found: %s', url);
                    const error = new Error(`${repository} does not contain a ${filename}`);
                    error.code = 'ENOENT';
                    throw error;
                }

                internals.error('Failed to load: %s', url);
                throw err;
            }
        }
    };
};


internals.createPathLoader = async (path) => {

    const simpleGit = Utils.simpleGit(path);
    const isRepo = await simpleGit.checkIsRepo();

    if (!isRepo) {
        throw new Error(`${path} is not a git repository`);
    }

    if (!Fs.existsSync(Path.join(path, 'package.json'))) {
        throw new Error(`${path} does not contain a package.json`);
    }

    return {
        getCommit: () => {

            return simpleGit.revparse(['HEAD']);
        },
        loadFile: (filename, options = {}) => {

            const fullPath = Path.join(path, filename);

            const buffer = Fs.readFileSync(fullPath);

            if (options.json) {
                return JSON.parse(buffer.toString());
            }

            return buffer;
        }
    };
};


exports.create = ({ path, repository, packageName }) => {

    if (repository) {
        return internals.createRepositoryLoader(repository);
    }

    if (packageName) {
        return internals.createPackageLoader(packageName);
    }

    return internals.createPathLoader(path);
};


exports.clearCache = () => {

    internals.cache = new Map();
};